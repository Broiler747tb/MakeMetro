import { Projection, type ProjectionParams } from "./projection";
import { CityStore } from "./store";

export const GRID_LAYERS = [
  "residents",
  "jobs",
  "education",
  "retail",
  "leisure",
  "elevation",
  "water",
  "built",
  "jobsIndustry",
  "nature",
  "nightlife",
] as const;
export type GridLayer = (typeof GRID_LAYERS)[number];

export interface CityManifest {
  format: number;
  id: string;
  name: string;
  bbox: [number, number, number, number];
  center: [number, number];
  centre?: [number, number]; // the city's own centre in local metres
  projection: ProjectionParams;
  basemap: string;
  maxzoom: number;
  grid: {
    file: string;
    x0: number;
    y0: number;
    cellSize: number;
    cols: number;
    rows: number;
    layers: string[];
  };
  buildings: string;
  names: string;
  totals: { residents: number; jobs: number; education: number; buildings: number; jobsIndustry?: number };
  attribution: string[];
  dem?: { tiles: string; encoding: "terrarium" | "mapbox"; minzoom: number; maxzoom: number };
  generated?: string;
}

export interface Grid {
  x0: number;
  y0: number;
  cellSize: number;
  cols: number;
  rows: number;
  layers: Record<GridLayer, Float32Array>;
}

export interface NamedPoint {
  n: string;
  en?: string;
  x: number;
  y: number;
  k: "street" | "place" | "poi";
  r: number;
}

export interface City {
  id: string;
  baseUrl: string;
  manifest: CityManifest;
  proj: Projection;
  grid: Grid;
  names: NamedPoint[];
  store: CityStore;
}

export function cityUrl(id: string): string {
  return `${import.meta.env.BASE_URL}cities/${id}/`;
}

/** The manifest from the network, or the kept copy when offline. */
async function loadManifest(id: string, url: string): Promise<CityManifest> {
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (res.ok) return await res.json();
  } catch {
    // Offline: fall through to the kept copy.
  }
  const kept = await CityStore.anyKept(id, url);
  if (!kept) throw new Error(`Can't reach ${url}, and this city hasn't been saved for offline play yet.`);
  return kept.json();
}

export async function loadCity(id: string): Promise<City> {
  const baseUrl = cityUrl(id);
  const manifestUrl = new URL(baseUrl + "city.json", location.href).href;
  const manifest = await loadManifest(id, manifestUrl);
  if (manifest.format !== 1) throw new Error(`Unsupported city pack format ${manifest.format}`);

  const store = await CityStore.open(id, manifest.generated ?? "1", baseUrl);
  await store.get("city.json");
  // A city saved on an earlier visit draws its map straight from disk.
  await store.restore(manifest.basemap);
  const [gridBuf, names] = await Promise.all([
    store.get(manifest.grid.file),
    store.get(manifest.names).then((b) => JSON.parse(new TextDecoder().decode(b)) as NamedPoint[]),
  ]);

  const g = manifest.grid;
  const plane = g.cols * g.rows;
  const layers = {} as Record<GridLayer, Float32Array>;
  for (const name of GRID_LAYERS) {
    const i = g.layers.indexOf(name);
    layers[name] = i >= 0 ? new Float32Array(gridBuf, i * plane * 4, plane) : new Float32Array(plane);
  }
  // Packs made before these layers existed: stand in with the closest ones they have.
  if (!g.layers.includes("nature")) layers.nature = layers.leisure;
  if (!g.layers.includes("nightlife")) layers.nightlife = layers.retail;

  return {
    id,
    baseUrl,
    manifest,
    proj: new Projection(manifest.projection),
    grid: { x0: g.x0, y0: g.y0, cellSize: g.cellSize, cols: g.cols, rows: g.rows, layers },
    names,
    store,
  };
}

/** Bilinear sample of a grid layer at local coordinates, clamped at the edges. */
export function sampleGrid(grid: Grid, layer: Float32Array, x: number, y: number): number {
  const fx = Math.min(Math.max((x - grid.x0) / grid.cellSize - 0.5, 0), grid.cols - 1);
  const fy = Math.min(Math.max((y - grid.y0) / grid.cellSize - 0.5, 0), grid.rows - 1);
  const c0 = Math.floor(fx);
  const r0 = Math.floor(fy);
  const c1 = Math.min(c0 + 1, grid.cols - 1);
  const r1 = Math.min(r0 + 1, grid.rows - 1);
  const tx = fx - c0;
  const ty = fy - r0;
  const a = layer[r0 * grid.cols + c0] * (1 - tx) + layer[r0 * grid.cols + c1] * tx;
  const b = layer[r1 * grid.cols + c0] * (1 - tx) + layer[r1 * grid.cols + c1] * tx;
  return a * (1 - ty) + b * ty;
}
