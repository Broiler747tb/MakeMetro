import type { Building } from "./buildings";
import type { Point } from "./collect";
import type { Grid } from "./grid";
import type { PopulationRaster } from "./population";
import { toLocal, toLonLat, type BBox, type Projection } from "./projection";
import type { Raster } from "./raster";
import {
  EDUCATION_PER_FLOOR_M2,
  LANDUSE_KINDS,
  LEISURE_PER_FLOOR_M2,
  NIGHTLIFE_PER_FLOOR_M2,
  POI_WEIGHTS,
  RETAIL_PER_FLOOR_M2,
  USE_WEIGHTS,
} from "./weights";

function residentialWeight(b: Building): number {
  // Small footprints are sheds and garages even where the landuse is housing.
  return b.floorArea * USE_WEIGHTS[b.use].residents * (b.footprint < 40 ? 0.1 : 1);
}

/** Homes, plus unclassified houses such as farmsteads inside fields. */
function isHousing(b: Building): boolean {
  return b.use === "residential" || (b.use === "other" && b.footprint >= 40);
}

const NEIGHBOURHOOD_M = 100;

/**
 * Spreads each GHSL pixel's population over the housing floor area of the
 * buildings whose centroid lies in it; other buildings in the pixel take a
 * small share by use. A pixel with people but no housing hands them to the
 * housing within 100 m, which catches buildings that straddle the pixel edge.
 * Beyond that GHSL is left as it is: the people go straight into the grid
 * cell, attached to no building. That is mostly GHSL's modelled population on
 * industrial and open land.
 */
export function distributeResidents(
  buildings: Building[],
  pop: PopulationRaster,
  grid: Grid,
  proj: Projection,
  bbox: BBox,
): { total: number; unhoused: number } {
  const { width, height, res } = pop;
  const pixelOf = (x: number, y: number) => {
    const [lon, lat] = toLonLat(proj, x, y);
    const c = Math.floor((lon - pop.lon0) / res);
    const r = Math.floor((pop.lat0 - lat) / res);
    return c < 0 || r < 0 || c >= width || r >= height ? -1 : r * width + c;
  };

  const pixel = new Int32Array(buildings.length);
  const housing = new Float64Array(width * height);
  const weight = new Float64Array(width * height);
  buildings.forEach((b, i) => {
    const p = (pixel[i] = pixelOf(b.cx, b.cy));
    if (p < 0) return;
    const w = residentialWeight(b);
    weight[p] += w;
    if (isHousing(b)) housing[p] += w;
  });

  const dc = Math.round(NEIGHBOURHOOD_M / (res * proj.mPerDegLon));
  const dr = Math.round(NEIGHBOURHOOD_M / (res * proj.mPerDegLat));
  const assigned = new Float64Array(width * height);
  const toNearbyHousing = (r: number, c: number, people: number): boolean => {
    const r0 = Math.max(0, r - dr);
    const r1 = Math.min(height - 1, r + dr);
    const c0 = Math.max(0, c - dc);
    const c1 = Math.min(width - 1, c + dc);
    let sum = 0;
    for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) sum += housing[rr * width + cc];
    if (sum <= 0) return false;
    for (let rr = r0; rr <= r1; rr++)
      for (let cc = c0; cc <= c1; cc++) assigned[rr * width + cc] += (people * housing[rr * width + cc]) / sum;
    return true;
  };

  let total = 0;
  let unhoused = 0;
  for (let r = 0; r < height; r++) {
    const lat = pop.lat0 - (r + 0.5) * res;
    if (lat < bbox[1] || lat > bbox[3]) continue;
    for (let c = 0; c < width; c++) {
      const p = r * width + c;
      const people = pop.values[p];
      const lon = pop.lon0 + (c + 0.5) * res;
      if (people <= 0 || lon < bbox[0] || lon > bbox[2]) continue;
      total += people;
      if (housing[p] > 0) {
        assigned[p] += people;
      } else if (!toNearbyHousing(r, c, people)) {
        const [x, y] = toLocal(proj, lon, lat);
        grid.add("residents", x, y, people);
        unhoused += people;
      }
    }
  }

  // Within a pixel every building takes its share by weight, so people placed
  // for a pixel's housing leave a small share in its shops and offices.
  buildings.forEach((b, i) => {
    const p = pixel[i];
    if (p < 0 || weight[p] <= 0) return;
    b.residents = (assigned[p] * residentialWeight(b)) / weight[p];
    grid.add("residents", b.cx, b.cy, b.residents);
  });
  return { total, unhoused };
}

/**
 * Jobs follow non-residential floor area weighted by use, plus a fixed bump per
 * POI. A POI inside a building adds its jobs to that building.
 *
 * Industrial POIs and the floor of industrial buildings also count towards
 * jobsIndustry. An industrial building with a shop, cafe or office inside has
 * usually been let out, as many old factories have, so its floor doesn't.
 */
export function distributeJobs(
  buildings: Building[],
  pois: Point[],
  poiBuilding: Int32Array,
  grid: Grid,
  total: number,
) {
  const floor = buildings.map((b) => b.floorArea * USE_WEIGHTS[b.use].jobs);
  const weight = floor.slice();
  const industry = new Float64Array(buildings.length);
  const letOut = new Uint8Array(buildings.length);
  const loose: { x: number; y: number; jobs: number; industry: number }[] = [];
  pois.forEach((p, k) => {
    const w = POI_WEIGHTS[p.kind];
    if (!w?.jobs) return;
    const industrial = w.industrial ? w.jobs : 0;
    const bi = poiBuilding[k];
    if (bi < 0) {
      loose.push({ x: p.x, y: p.y, jobs: w.jobs, industry: industrial });
      return;
    }
    weight[bi] += w.jobs;
    industry[bi] += industrial;
    if (!w.industrial) letOut[bi] = 1;
  });
  buildings.forEach((b, i) => {
    if (b.use === "industrial" && !letOut[i]) industry[i] += floor[i];
  });
  const sum = weight.reduce((s, w) => s + w, 0) + loose.reduce((s, l) => s + l.jobs, 0);
  const k = sum > 0 ? total / sum : 0;
  buildings.forEach((b, i) => {
    b.jobs = weight[i] * k;
    grid.add("jobs", b.cx, b.cy, b.jobs);
    grid.add("jobsIndustry", b.cx, b.cy, industry[i] * k);
  });
  for (const l of loose) {
    grid.add("jobs", l.x, l.y, l.jobs * k);
    grid.add("jobsIndustry", l.x, l.y, l.industry * k);
  }
  // The two layers are summed separately in float32, which can leave a cell's
  // industrial jobs a rounding error above its jobs.
  const jobs = grid.layers.jobs;
  const industrial = grid.layers.jobsIndustry;
  for (let i = 0; i < jobs.length; i++) industrial[i] = Math.min(industrial[i], jobs[i]);
}

/** Education, retail, leisure and nightlife attraction, each normalised to a total. */
export function distributeAttractions(
  buildings: Building[],
  pois: Point[],
  landuse: Raster,
  grid: Grid,
  totals: { education: number; retail: number; leisure: number; nightlife: number },
) {
  for (const b of buildings) {
    if (b.use === "education") grid.add("education", b.cx, b.cy, b.floorArea * EDUCATION_PER_FLOOR_M2);
    grid.add("retail", b.cx, b.cy, b.floorArea * (RETAIL_PER_FLOOR_M2[b.use] ?? 0));
    grid.add("leisure", b.cx, b.cy, b.floorArea * (LEISURE_PER_FLOOR_M2[b.use] ?? 0));
    grid.add("nightlife", b.cx, b.cy, b.floorArea * (NIGHTLIFE_PER_FLOOR_M2[b.use] ?? 0));
  }
  for (const p of pois) {
    const w = POI_WEIGHTS[p.kind];
    if (!w) continue;
    if (w.education) grid.add("education", p.x, p.y, w.education);
    if (w.retail) grid.add("retail", p.x, p.y, w.retail);
    if (w.leisure) grid.add("leisure", p.x, p.y, w.leisure);
    if (w.nightlife) grid.add("nightlife", p.x, p.y, w.nightlife);
  }

  // Landuse attracts by area too: parks and woods for leisure, school grounds for education.
  const hectares = (landuse.res * landuse.res) / 10000;
  const leisure = LANDUSE_KINDS.map(([, kind]) => (kind.leisure ?? 0) * hectares);
  const education = LANDUSE_KINDS.map(([, kind]) => (kind.education ?? 0) * hectares);
  for (let j = 0; j < landuse.height; j++) {
    const y = landuse.y0 + (j + 0.5) * landuse.res;
    for (let i = 0; i < landuse.width; i++) {
      const v = landuse.data[j * landuse.width + i] - 1;
      if (v < 0) continue;
      const x = landuse.x0 + (i + 0.5) * landuse.res;
      if (leisure[v] > 0) grid.add("leisure", x, y, leisure[v]);
      if (education[v] > 0) grid.add("education", x, y, education[v]);
    }
  }

  grid.normalise("education", totals.education);
  grid.normalise("retail", totals.retail);
  grid.normalise("leisure", totals.leisure);
  grid.normalise("nightlife", totals.nightlife);
}
