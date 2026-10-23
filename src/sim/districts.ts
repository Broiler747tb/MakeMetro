// What kind of place each grid cell is, judged from who lives and works around it.

export const DISTRICTS = ["none", "sleeper", "business", "industrial", "centre", "green"] as const;
export type District = (typeof DISTRICTS)[number];

export const DISTRICT_NAMES: Record<District, string> = {
  none: "Empty",
  sleeper: "Sleeper district",
  business: "Business district",
  industrial: "Industrial zone",
  centre: "City centre",
  green: "Parks and forest",
};

export const DISTRICT_COLOURS: Record<District, [number, number, number]> = {
  none: [0, 0, 0],
  sleeper: [86, 132, 196],
  business: [214, 140, 52],
  industrial: [146, 104, 196],
  centre: [196, 62, 82],
  green: [92, 156, 96],
};

export interface DistrictInput {
  cols: number;
  rows: number;
  cellSize: number;
  x0: number;
  y0: number;
  residents: ArrayLike<number>;
  jobs: ArrayLike<number>;
  jobsIndustry: ArrayLike<number>;
  nature: ArrayLike<number>;
  nightlife: ArrayLike<number>;
  centre: [number, number];
}

/** Box blur over (2r+1)² cells, so a district is a neighbourhood rather than one block. */
function blur(src: ArrayLike<number>, cols: number, rows: number, r: number): Float32Array {
  const tmp = new Float32Array(cols * rows);
  const out = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += x >= 0 && x < cols ? src[y * cols + x] : 0;
    for (let x = 0; x < cols; x++) {
      tmp[y * cols + x] = sum;
      const add = x + r + 1, sub = x - r;
      if (add < cols) sum += src[y * cols + add];
      if (sub >= 0) sum -= src[y * cols + sub];
    }
  }
  for (let x = 0; x < cols; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += y >= 0 && y < rows ? tmp[y * cols + x] : 0;
    for (let y = 0; y < rows; y++) {
      out[y * cols + x] = sum / ((2 * r + 1) * (2 * r + 1));
      const add = y + r + 1, sub = y - r;
      if (add < rows) sum += tmp[add * cols + x];
      if (sub >= 0) sum -= tmp[sub * cols + x];
    }
  }
  return out;
}

export function classifyDistricts(g: DistrictInput): Uint8Array {
  const n = g.cols * g.rows;
  const r = Math.max(1, Math.round(375 / g.cellSize));
  const res = blur(g.residents, g.cols, g.rows, r);
  const ind = blur(g.jobsIndustry, g.cols, g.rows, r);
  const jobs = blur(g.jobs, g.cols, g.rows, r);
  const nat = blur(g.nature, g.cols, g.rows, r);
  const night = blur(g.nightlife, g.cols, g.rows, r);
  const perKm2 = 1e6 / (g.cellSize * g.cellSize);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / g.cols);
    const x = g.x0 + (i - row * g.cols + 0.5) * g.cellSize;
    const y = g.y0 + (row + 0.5) * g.cellSize;
    const fromCentre = Math.hypot(x - g.centre[0], y - g.centre[1]);
    const R = res[i] * perKm2;
    const I = ind[i] * perKm2;
    const O = (jobs[i] - ind[i]) * perKm2;
    let d: District = "none";
    // Downtown is where the evenings out and the offices are, not a circle on the map.
    if (fromCentre < 7000 && (night[i] * perKm2 > 50000 || O > 20000)) d = "centre";
    else if (I > 1500 && I > 0.6 * (O + 0.5 * R)) d = "industrial";
    else if (O > 6000 && O > 1.5 * R) d = "business";
    else if (R > 1500) d = "sleeper";
    else if (nat[i] * perKm2 > 200) d = "green";
    out[i] = DISTRICTS.indexOf(d);
  }
  return out;
}
