import type { Building } from "./buildings";
import type { Features, Point } from "./collect";
import type { Grid } from "./grid";
import { Raster } from "./raster";
import { LANDUSE_KINDS, POI_WEIGHTS, type LanduseKind, type Use } from "./weights";

export interface LandRasters {
  /** Index into LANDUSE_KINDS plus one; 0 where no listed landuse applies. */
  landuse: Raster;
  /** 1 where there is open water. */
  water: Raster;
}

/** Rasterises landuse and water at `subdivisions` pixels per grid cell side. */
export function paintLand(features: Features, grid: Grid, subdivisions: number): LandRasters {
  const make = () =>
    new Raster(grid.x0, grid.y0, grid.cellSize / subdivisions, grid.cols * subdivisions, grid.rows * subdivisions);
  const landuse = make();
  LANDUSE_KINDS.forEach(([kind], i) => {
    for (const polygon of features.landuse.get(kind) ?? []) landuse.fill(polygon, i + 1);
  });
  const water = make();
  for (const polygon of features.water) water.fill(polygon, 1);
  return { landuse, water };
}

export function landuseAt(raster: Raster, x: number, y: number): LanduseKind | undefined {
  const v = raster.at(x, y);
  return v > 0 ? LANDUSE_KINDS[v - 1][1] : undefined;
}

// When a building holds several defining POIs, the first use in this list wins.
const DEFINE_ORDER: Use[] = ["education", "health", "retail", "civic", "office"];

/**
 * Buildings in the Protomaps schema carry no type, so their use comes from the
 * landuse under the building, overridden by telling POIs inside the footprint.
 */
export function classifyBuildings(buildings: Building[], landuse: Raster, pois: Point[], poiBuilding: Int32Array) {
  for (const b of buildings) {
    const use = landuseAt(landuse, b.ix, b.iy)?.use;
    // Tiny unclassified structures are mostly sheds, garages and kiosks.
    b.use = b.footprint < 40 && use !== "education" ? "other" : (use ?? "residential");
  }
  const defined = new Map<number, Use>();
  pois.forEach((p, k) => {
    const bi = poiBuilding[k];
    const use = POI_WEIGHTS[p.kind]?.defines;
    if (bi < 0 || !use) return;
    const current = defined.get(bi);
    if (!current || DEFINE_ORDER.indexOf(use) < DEFINE_ORDER.indexOf(current)) defined.set(bi, use);
  });
  for (const [bi, use] of defined) buildings[bi].use = use;
}
