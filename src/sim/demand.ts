import type { DayKind, GridData, SimNetwork } from "./protocol";
import { classifyDistricts } from "./districts";

export const PURPOSES = ["office", "industry", "education", "shopping", "nature", "nightlife"] as const;
export type Purpose = (typeof PURPOSES)[number];
const P = PURPOSES.length;
const NATURE = PURPOSES.indexOf("nature");
const NIGHTLIFE = PURPOSES.indexOf("nightlife");

// How far people are willing to go for each purpose (distance decay, metres). Factory
// workers live close to the plant; people cross the whole city for a night out.
const DECAY = [12000, 6000, 3500, 3000, 10000, 14000];

const EMPLOYED = 0.5; // workers per resident
// Share of a weekday's office and factory commutes that still happen on other days.
const WORK_DAYS: Record<DayKind, [number, number]> = { weekday: [1, 1], saturday: [0.2, 0.45], sunday: [0.1, 0.35] };
// Outbound trips per resident for the other purposes: education, shopping, nature, nightlife.
const OTHER_RATES: Record<DayKind, [number, number, number, number]> = {
  weekday: [0.16, 0.25, 0.03, 0.015],
  saturday: [0.03, 0.35, 0.12, 0.06],
  sunday: [0, 0.2, 0.2, 0.04],
};
// By month: summer sends people out to parks and dachas, winter keeps them in town.
const NATURE_SEASON = [0.35, 0.35, 0.5, 0.8, 1.2, 1.6, 1.7, 1.6, 1.1, 0.8, 0.5, 0.4];
const NIGHT_SEASON = [1.15, 1.15, 1.1, 1.0, 0.95, 0.9, 0.85, 0.9, 1.0, 1.05, 1.1, 1.2];

// Who makes each kind of trip, by the district they live in (order of DISTRICTS):
// none, sleeper, business, industrial, centre, green. Factories fill from sleeper
// districts; hardly anyone commutes from an industrial zone to an office.
const HOME_WEIGHT: number[][] = [
  [1, 1, 1, 0.15, 1, 1],
  [0.5, 1, 0.15, 0.6, 0.1, 0.5],
  [1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1],
];

// How strongly a good metro link draws trips to a place: one that everybody would reach
// by metro draws 1 + METRO_PULL times the trips it otherwise would.
const METRO_PULL = 10;
// Real metros also carry people who come from beyond walking range by bus or tram, which
// the game leaves out. Scaling up everyone's trips makes up for them, so that a grown
// network carries about as many people as Moscow's metro.
const TRIP_SCALE = 2;

const WALK_SPEED = 1.3; // m/s
const WALK_DETOUR = 1.25;
const GATE_TIME = 30; // s, fare gates and walking inside the station

/** Hours of a day; `after` holds the hours past midnight that belong to the next morning. */
export interface DayCurve {
  today: Float32Array;
  after: Float32Array;
}

function curve(parts: [number, number, number][]): DayCurve {
  const raw = new Float32Array(30);
  let sum = 0;
  for (let h = 0; h < 30; h++) {
    for (const [w, mean, sd] of parts) raw[h] += w * Math.exp(-0.5 * ((h + 0.5 - mean) / sd) ** 2);
    sum += raw[h];
  }
  const today = new Float32Array(24);
  const after = new Float32Array(24);
  for (let h = 0; h < 30; h++) {
    if (h < 24) today[h] = raw[h] / sum;
    else after[h - 24] = raw[h] / sum;
  }
  return { today, after };
}

type Curves = { out: DayCurve; ret: DayCurve }[];

// Factory shifts: early, afternoon and a few nights. Night-shift workers go home in the morning.
const SHIFTS = {
  out: curve([
    [0.6, 6.6, 0.5],
    [0.3, 14.5, 0.6],
    [0.1, 22.4, 0.5],
  ]),
  ret: curve([
    [0.6, 15.4, 0.6],
    [0.3, 23.3, 0.5],
    [0.1, 6.9, 0.5],
  ]),
};

const CURVES: Record<DayKind, Curves> = {
  weekday: [
    { out: curve([[1, 8.6, 0.9]]), ret: curve([[1, 18.3, 1.1]]) },
    SHIFTS,
    { out: curve([[1, 8, 0.6]]), ret: curve([[1, 14.5, 2]]) },
    { out: curve([[1, 14, 3.5]]), ret: curve([[1, 15.5, 3.5]]) },
    { out: curve([[1, 17, 1.5]]), ret: curve([[1, 19.5, 1.5]]) },
    { out: curve([[1, 20, 1.3]]), ret: curve([[1, 23.5, 1.2]]) },
  ],
  saturday: [
    { out: curve([[1, 10, 1.5]]), ret: curve([[1, 17, 2]]) },
    SHIFTS,
    { out: curve([[1, 9.5, 1]]), ret: curve([[1, 13.5, 1.5]]) },
    { out: curve([[1, 13, 3]]), ret: curve([[1, 15.5, 3]]) },
    { out: curve([[1, 11, 1.5]]), ret: curve([[1, 17.5, 2]]) },
    { out: curve([[1, 21.5, 1.3]]), ret: curve([[1, 26, 1.5]]) },
  ],
  sunday: [
    { out: curve([[1, 10, 1.5]]), ret: curve([[1, 16, 2]]) },
    SHIFTS,
    { out: curve([[1, 10, 1]]), ret: curve([[1, 13, 1.5]]) },
    { out: curve([[1, 13.5, 3]]), ret: curve([[1, 16, 3]]) },
    { out: curve([[1, 10.5, 1.5]]), ret: curve([[1, 17, 2]]) },
    { out: curve([[1, 20.5, 1.3]]), ret: curve([[1, 24.5, 1.4]]) },
  ],
};

export function curves(kind: DayKind): Curves {
  return CURVES[kind];
}

export function walkSeconds(dist: number): number {
  return (dist * WALK_DETOUR) / WALK_SPEED;
}

/** Share of people willing to walk a given distance to a station. */
export function willingness(dist: number, range: number): number {
  const full = range * 0.4;
  if (dist <= full) return 1;
  return Math.max(0, 1 - (dist - full) / (range - full));
}

/** Time from the street to the platform: gates, then stairs or escalators. */
export function accessSeconds(level: number): number {
  return GATE_TIME + (level < 0 ? -level / 0.6 : level / 0.5);
}

/**
 * City-wide demand that doesn't depend on the network: where trips start, what attracts
 * them, and for each place the sum of everything it could travel to (the gravity model's
 * denominator).
 */
export class Demand {
  readonly districts: Uint8Array;
  residents: Float32Array;
  readonly attract: Float32Array[]; // per purpose, fine grid
  readonly homeWeight: Float32Array[]; // per purpose, fine grid
  readonly denom: Float32Array[]; // per purpose, coarse grid
  readonly officeShare: number;
  private coarse = 4; // fine cells per coarse cell side
  private ccols: number;
  private crows: number;

  constructor(readonly grid: GridData) {
    const g = grid;
    const n = g.cols * g.rows;
    this.residents = g.residents.slice();
    this.districts = classifyDistricts(g);
    const office = new Float32Array(n);
    let jobs = 0;
    let industry = 0;
    for (let i = 0; i < n; i++) {
      office[i] = Math.max(0, g.jobs[i] - g.jobsIndustry[i]);
      jobs += g.jobs[i];
      industry += g.jobsIndustry[i];
    }
    this.officeShare = jobs > 0 ? 1 - industry / jobs : 1;
    // The far forests outweigh city parks in the data; outings mostly go to the edge of town.
    const nature = g.nature.slice();
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / g.cols);
      const d = Math.hypot(g.x0 + (i - r * g.cols + 0.5) * g.cellSize - g.centre[0], g.y0 + (r + 0.5) * g.cellSize - g.centre[1]);
      if (d > 20000) nature[i] *= Math.max(0.15, 1 - (d - 20000) / 15000);
    }
    this.attract = [office, g.jobsIndustry.slice(), g.education.slice(), g.retail.slice(), nature, g.nightlife.slice()];
    this.homeWeight = HOME_WEIGHT.map((weights) => {
      let num = 0;
      let den = 0;
      for (let i = 0; i < n; i++) {
        num += this.residents[i] * weights[this.districts[i]];
        den += this.residents[i];
      }
      // Scale so the city-wide number of trips stays the same.
      const k = num > 0 ? den / num : 1;
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = weights[this.districts[i]] * k;
      return out;
    });
    this.ccols = Math.ceil(g.cols / this.coarse);
    this.crows = Math.ceil(g.rows / this.coarse);
    this.denom = PURPOSES.map(() => new Float32Array(this.ccols * this.crows));
    this.computeDenominators();
  }

  /** Outbound trips per resident for a purpose on a given kind of day and month. */
  rate(kind: DayKind, p: number, month: number): number {
    if (p === 0) return EMPLOYED * this.officeShare * WORK_DAYS[kind][0];
    if (p === 1) return EMPLOYED * (1 - this.officeShare) * WORK_DAYS[kind][1];
    const base = OTHER_RATES[kind][p - 2];
    if (p === NATURE) return base * NATURE_SEASON[month];
    if (p === NIGHTLIFE) return base * NIGHT_SEASON[month];
    return base;
  }

  /** Takes demolished buildings off the map. */
  applyRemovals(removed: SimNetwork["removed"]) {
    const g = this.grid;
    this.residents = g.residents.slice();
    this.attract[0] = new Float32Array(g.cols * g.rows).map((_, i) => Math.max(0, g.jobs[i] - g.jobsIndustry[i]));
    this.attract[1] = g.jobsIndustry.slice();
    for (const b of removed) {
      const c = Math.floor((b.x - g.x0) / g.cellSize);
      const r = Math.floor((b.y - g.y0) / g.cellSize);
      if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) continue;
      const i = r * g.cols + c;
      this.residents[i] = Math.max(0, this.residents[i] - b.residents);
      // Take the jobs from office and industry in the cell's own proportion.
      const total = this.attract[0][i] + this.attract[1][i];
      if (total > 0) {
        const keep = Math.max(0, total - b.jobs) / total;
        this.attract[0][i] *= keep;
        this.attract[1][i] *= keep;
      }
    }
  }

  private computeDenominators() {
    const g = this.grid;
    const k = this.coarse;
    const cs = g.cellSize * k;
    for (let p = 0; p < P; p++) {
      const coarseA = new Float32Array(this.ccols * this.crows);
      const a = this.attract[p];
      for (let r = 0; r < g.rows; r++) {
        for (let c = 0; c < g.cols; c++) {
          const v = a[r * g.cols + c];
          if (v > 0) coarseA[Math.floor(r / k) * this.ccols + Math.floor(c / k)] += v;
        }
      }
      const reach = Math.min(Math.max(this.ccols, this.crows), Math.ceil((DECAY[p] * 5) / cs));
      const w = 2 * reach + 1;
      const kernel = new Float32Array(w * w);
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          // Half a cell keeps the self-cell from dominating.
          const d = Math.max(Math.hypot(dx, dy), 0.5) * cs;
          kernel[(dy + reach) * w + dx + reach] = Math.exp(-d / DECAY[p]);
        }
      }
      const nz: number[] = [];
      for (let i = 0; i < coarseA.length; i++) if (coarseA[i] > 0) nz.push(i);
      const out = this.denom[p];
      for (let r = 0; r < this.crows; r++) {
        for (let c = 0; c < this.ccols; c++) {
          let sum = 0;
          for (const j of nz) {
            const jr = Math.floor(j / this.ccols);
            const dy = jr - r;
            const dx = j - jr * this.ccols - c;
            if (dy < -reach || dy > reach || dx < -reach || dx > reach) continue;
            sum += coarseA[j] * kernel[(dy + reach) * w + dx + reach];
          }
          out[r * this.ccols + c] = sum;
        }
      }
    }
  }

  denomAt(p: number, fineIndex: number): number {
    const g = this.grid;
    const r = Math.floor(fineIndex / g.cols);
    const c = fineIndex - r * g.cols;
    return this.denom[p][Math.floor(r / this.coarse) * this.ccols + Math.floor(c / this.coarse)];
  }
}

export interface Catchments {
  // Per station: production (residents / denominator) and attraction for each purpose.
  prod: Float32Array[]; // [purpose][station]
  attr: Float32Array[];
  access: Float32Array; // average street-to-platform seconds
  potentialResidents: Float32Array;
}

export function catchments(d: Demand, net: SimNetwork): Catchments {
  const g = d.grid;
  const S = net.stations.length;
  const range = net.walkRange;
  const prod = PURPOSES.map(() => new Float32Array(S));
  const attr = PURPOSES.map(() => new Float32Array(S));
  const access = new Float32Array(S);
  const potentialResidents = new Float32Array(S);

  // First pass: each cell's total pull towards stations, so overlapping catchments split people.
  const pull = new Map<number, number>();
  const cellsOf: { cell: number; w: number; dist: number }[][] = [];
  const reachCells = Math.ceil(range / g.cellSize) + 1;
  for (let s = 0; s < S; s++) {
    const st = net.stations[s];
    const points = st.entrances.length ? st.entrances : [[st.x, st.y] as [number, number]];
    const c0 = Math.floor((st.x - g.x0) / g.cellSize);
    const r0 = Math.floor((st.y - g.y0) / g.cellSize);
    const list: { cell: number; w: number; dist: number }[] = [];
    for (let r = r0 - reachCells; r <= r0 + reachCells; r++) {
      if (r < 0 || r >= g.rows) continue;
      for (let c = c0 - reachCells; c <= c0 + reachCells; c++) {
        if (c < 0 || c >= g.cols) continue;
        const cx = g.x0 + (c + 0.5) * g.cellSize;
        const cy = g.y0 + (r + 0.5) * g.cellSize;
        let dist = Infinity;
        for (const [ex, ey] of points) dist = Math.min(dist, Math.hypot(cx - ex, cy - ey));
        const w = willingness(dist, range);
        if (w <= 0) continue;
        const cell = r * g.cols + c;
        list.push({ cell, w, dist });
        pull.set(cell, (pull.get(cell) ?? 0) + w);
      }
    }
    cellsOf.push(list);
  }

  for (let s = 0; s < S; s++) {
    let wsum = 0;
    let tsum = 0;
    const depth = accessSeconds(net.stations[s].level);
    for (const { cell, w, dist } of cellsOf[s]) {
      const share = w / Math.max(1, pull.get(cell)!);
      const res = d.residents[cell] * share;
      potentialResidents[s] += res;
      for (let p = 0; p < P; p++) {
        const den = d.denomAt(p, cell);
        if (den > 0) prod[p][s] += (res * d.homeWeight[p][cell]) / den;
        attr[p][s] += d.attract[p][cell] * share;
      }
      const weight = d.residents[cell] * share + d.attract[0][cell] * share + 1e-3;
      wsum += weight;
      tsum += weight * walkSeconds(dist);
    }
    access[s] = (wsum > 0 ? tsum / wsum : walkSeconds(range / 2)) + depth;
  }
  return { prod, attr, access, potentialResidents };
}

/**
 * Daily outbound trips between every pair of stations, per purpose: [p][s * S + t].
 * reach (from metroReach) pulls trips towards places the metro serves well; people still
 * make the same number of trips, they just go to different places.
 */
export function stationTrips(d: Demand, net: SimNetwork, c: Catchments, kind: DayKind, month: number, reach?: Float32Array): Float32Array[] {
  const S = net.stations.length;
  const g = d.grid;
  const out = PURPOSES.map(() => new Float32Array(S * S));
  const rates = PURPOSES.map((_, p) => d.rate(kind, p, month) * TRIP_SCALE);
  const weight = new Float32Array(S);
  for (let s = 0; s < S; s++) {
    const a = net.stations[s];
    const col = Math.min(g.cols - 1, Math.max(0, Math.floor((a.x - g.x0) / g.cellSize)));
    const row = Math.min(g.rows - 1, Math.max(0, Math.floor((a.y - g.y0) / g.cellSize)));
    for (let p = 0; p < P; p++) {
      if (rates[p] <= 0) continue;
      let pulled = 0;
      for (let t = 0; t < S; t++) {
        if (s === t) continue;
        const b = net.stations[t];
        const w = c.attr[p][t] * Math.exp(-Math.hypot(a.x - b.x, a.y - b.y) / DECAY[p]);
        const extra = reach ? METRO_PULL * reach[s * S + t] : 0;
        weight[t] = w * (1 + extra);
        pulled += w * extra;
      }
      // Places the metro pulls towards take their trips from everywhere else.
      const den = d.denomAt(p, row * g.cols + col);
      const keep = den > 0 ? den / (den + pulled) : 1;
      for (let t = 0; t < S; t++) if (s !== t) out[p][s * S + t] = rates[p] * c.prod[p][s] * weight[t] * keep;
    }
  }
  return out;
}

