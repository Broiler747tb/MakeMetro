import type { Building } from "./buildings";
import type { Elevation } from "./elevation";
import { clipRingToRect, ringBounds, signedArea } from "./geometry";
import type { Grid } from "./grid";
import { toLonLat, type Projection } from "./projection";
import type { Raster } from "./raster";

export function fillElevation(grid: Grid, elevation: Elevation, proj: Projection) {
  const out = grid.layers.elevation;
  for (let i = 0; i < grid.size; i++) {
    const [x, y] = grid.centre(i);
    const [lon, lat] = toLonLat(proj, x, y);
    out[i] = elevation.at(lon, lat);
  }
}

/** Share of each cell covered by water, from a raster aligned with the grid. */
export function fillWater(grid: Grid, water: Raster) {
  const sub = Math.round(grid.cellSize / water.res);
  const out = grid.layers.water;
  for (let j = 0; j < water.height; j++) {
    const row = Math.floor(j / sub) * grid.cols;
    for (let i = 0; i < water.width; i++) {
      if (water.data[j * water.width + i]) out[row + Math.floor(i / sub)] += 1;
    }
  }
  const perCell = sub * sub;
  for (let i = 0; i < out.length; i++) out[i] /= perCell;
}

/** Share of each cell covered by building footprints, clipping footprints at cell edges. */
export function fillBuilt(grid: Grid, buildings: Building[]) {
  const out = grid.layers.built;
  const s = grid.cellSize;
  for (const b of buildings) {
    const [x0, y0, x1, y1] = ringBounds(b.outline);
    const c0 = Math.floor((x0 - grid.x0) / s);
    const c1 = Math.floor((x1 - grid.x0) / s);
    const r0 = Math.floor((y0 - grid.y0) / s);
    const r1 = Math.floor((y1 - grid.y0) / s);
    if (c0 === c1 && r0 === r1) {
      grid.add("built", b.cx, b.cy, b.footprint);
      continue;
    }
    // Courtyards are ignored for the few buildings that cross a cell edge.
    for (let r = Math.max(0, r0); r <= Math.min(grid.rows - 1, r1); r++) {
      for (let c = Math.max(0, c0); c <= Math.min(grid.cols - 1, c1); c++) {
        const cx = grid.x0 + c * s;
        const cy = grid.y0 + r * s;
        const piece = clipRingToRect(b.outline, cx, cy, cx + s, cy + s);
        if (piece.length >= 6) out[r * grid.cols + c] += Math.abs(signedArea(piece));
      }
    }
  }
  const area = s * s;
  for (let i = 0; i < out.length; i++) out[i] = Math.min(1, out[i] / area);
}
