import type { Grid } from "./grid";
import type { LandRasters } from "./landuse";
import { LANDUSE_KINDS } from "./weights";

// Green patches are traced on blocks of 5 x 5 landuse pixels (50 m), so a
// clearing or a narrow road through a forest doesn't cut it in two.
const BLOCK = 5;
/** A block at least this green is part of a patch. */
const PATCH_SHARE = 0.5;
/** Smaller patches are squares and courtyard lawns, not somewhere to spend the day. */
const MIN_PATCH_HA = 2;
/** Green land within a block of a river or lake counts this much more. */
const WATERSIDE_BOOST = 1.5;
const WATERSIDE_SHARE = 0.25;

interface Blocks {
  cols: number;
  rows: number;
  /** Share of each block under green kinds, and under water. */
  green: Float32Array;
  water: Float32Array;
  /** Green area in hectares, weighted by kind. */
  weight: Float64Array;
}

/** Day outings head out of town: 0.5 at the centre, plus 1 every 15 km, up to 2.5. */
function distanceBoost(metres: number): number {
  return Math.min(2.5, 0.5 + metres / 15000);
}

function sumBlocks({ landuse, water }: LandRasters): Blocks {
  const cols = Math.ceil(landuse.width / BLOCK);
  const rows = Math.ceil(landuse.height / BLOCK);
  const pixelHa = (landuse.res * landuse.res) / 10000;
  const perPixel = LANDUSE_KINDS.map(([, kind]) => (kind.nature ?? 0) * pixelHa);
  const share = 1 / (BLOCK * BLOCK);
  const blocks: Blocks = {
    cols,
    rows,
    green: new Float32Array(cols * rows),
    water: new Float32Array(cols * rows),
    weight: new Float64Array(cols * rows),
  };
  for (let j = 0; j < landuse.height; j++) {
    const row = Math.floor(j / BLOCK) * cols;
    for (let i = 0; i < landuse.width; i++) {
      const p = j * landuse.width + i;
      const b = row + Math.floor(i / BLOCK);
      if (water.data[p]) blocks.water[b] += share;
      const v = landuse.data[p] - 1;
      if (v < 0 || perPixel[v] === 0) continue;
      blocks.green[b] += share;
      blocks.weight[b] += perPixel[v];
    }
  }
  return blocks;
}

function root(parent: Int32Array, i: number): number {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]];
    i = parent[i];
  }
  return i;
}

/** Calls visit for each block in the 3 x 3 square around (r, c), inside the grid. */
function around(blocks: Blocks, r: number, c: number, visit: (i: number) => void) {
  for (let rr = Math.max(0, r - 1); rr <= Math.min(blocks.rows - 1, r + 1); rr++) {
    for (let cc = Math.max(0, c - 1); cc <= Math.min(blocks.cols - 1, c + 1); cc++) visit(rr * blocks.cols + cc);
  }
}

/**
 * Joins mostly green blocks into 8-connected patches and returns, for each
 * block, the green area in hectares of the largest patch it is in or touches.
 * Touching counts so that the ragged edge of a park keeps the park's size.
 */
function patchAreas(blocks: Blocks, blockHa: number): Float64Array {
  const { cols, rows, green } = blocks;
  const parent = new Int32Array(cols * rows).fill(-1);
  const join = (a: number, b: number) => {
    if (parent[b] < 0) return;
    const ra = root(parent, a);
    const rb = root(parent, b);
    if (ra !== rb) parent[rb] = ra;
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (green[i] < PATCH_SHARE) continue;
      parent[i] = i;
      if (c > 0) join(i, i - 1);
      if (r === 0) continue;
      for (let cc = Math.max(0, c - 1); cc <= Math.min(cols - 1, c + 1); cc++) join(i, i - cols + cc - c);
    }
  }
  const area = new Float64Array(cols * rows);
  for (let i = 0; i < area.length; i++) if (parent[i] >= 0) area[root(parent, i)] += green[i] * blockHa;

  const out = new Float64Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (blocks.weight[i] === 0) continue;
      around(blocks, r, c, (j) => {
        if (parent[j] >= 0) out[i] = Math.max(out[i], area[root(parent, j)]);
      });
    }
  }
  return out;
}

function nearWater(blocks: Blocks, r: number, c: number): boolean {
  let near = false;
  around(blocks, r, c, (j) => {
    if (blocks.water[j] >= WATERSIDE_SHARE) near = true;
  });
  return near;
}

/**
 * Attraction for day outings: parks, woods, meadows, beaches and dacha plots by
 * area and kind. Each hectare counts 1 + ln(patch hectares), so a big forest
 * park draws more per hectare than a square; patches under 2 ha don't count.
 * Green land by water counts more, and everything grows with distance from
 * the centre. Normalised to `total`.
 */
export function distributeNature(land: LandRasters, grid: Grid, centre: [number, number], total: number) {
  const blocks = sumBlocks(land);
  const size = land.landuse.res * BLOCK;
  const patch = patchAreas(blocks, (size * size) / 10000);
  for (let r = 0; r < blocks.rows; r++) {
    const y = land.landuse.y0 + (r + 0.5) * size;
    for (let c = 0; c < blocks.cols; c++) {
      const i = r * blocks.cols + c;
      if (patch[i] < MIN_PATCH_HA) continue;
      const x = land.landuse.x0 + (c + 0.5) * size;
      const boost = distanceBoost(Math.hypot(x - centre[0], y - centre[1]));
      const side = nearWater(blocks, r, c) ? WATERSIDE_BOOST : 1;
      grid.add("nature", x, y, blocks.weight[i] * (1 + Math.log(patch[i])) * side * boost);
    }
  }
  grid.normalise("nature", total);
}
