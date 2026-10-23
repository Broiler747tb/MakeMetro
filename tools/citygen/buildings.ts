import type { BuildingPieces } from "./collect";
import {
  interiorPoint,
  mergeAcrossSeams,
  pointInRing,
  removeCollinear,
  reverseRing,
  ringBounds,
  signedArea,
  type Ring,
} from "./geometry";
import { TILE_EXTENT, type WorldPixels } from "./tiles";
import type { Use } from "./weights";

const DEFAULT_HEIGHT = 9;
const STOREY = 3;
// Anything taller is a tagging error.
const MAX_HEIGHT = 1000;
// Big non-residential footprints are halls, malls and plants with tall storeys.
const HALL_FOOTPRINT = 10000;
const HALL_MAX_STOREYS = 4;

export interface Building {
  /** Outer ring in local metres, counter-clockwise. */
  outline: Ring;
  cx: number;
  cy: number;
  /** A point on the building itself; the centroid of a perimeter block lies in its courtyard. */
  ix: number;
  iy: number;
  /** Footprint area net of courtyards, m². */
  footprint: number;
  /** Tallest point, from the outline or any of its parts. */
  height: number;
  heightKnown: boolean;
  /** Height range of the outline itself. */
  base: number;
  outlineHeight: number;
  /** Floor area of building:part features inside, and the ground they cover. */
  partFloor: number;
  partCover: number;
  floorArea: number;
  use: Use;
  residents: number;
  jobs: number;
}

// Whole storeys only: Protomaps turns building:levels into levels * 3 + 2 m.
function storeys(bottom: number, top: number): number {
  return Math.max(1, Math.floor((top - bottom) / STOREY));
}

function validHeight(h: number | undefined): h is number {
  return h !== undefined && h >= 2 && h <= MAX_HEIGHT;
}

export interface AssemblyStats {
  /** Buildings cut by tile edges and joined back into one outline. */
  joined: number;
  /** Cut buildings whose pieces didn't join; they keep their largest piece. */
  joinFailed: number;
}

function largest(rings: Ring[]): Ring {
  let best = rings[0];
  let bestArea = 0;
  for (const r of rings) {
    const a = Math.abs(signedArea(r));
    if (a > bestArea) {
      best = r;
      bestArea = a;
    }
  }
  return best;
}

/**
 * Turns the per-tile pieces of each building into one record. Pieces share the
 * OSM id carried by the tiles, so a building cut by tile edges is joined back
 * along those edges. Buildings whose centroid falls outside `bounds` are dropped.
 */
export function assembleBuildings(
  pieces: Map<number, BuildingPieces>,
  world: WorldPixels,
  bounds: [number, number, number, number],
): { buildings: Building[]; stats: AssemblyStats } {
  const stats: AssemblyStats = { joined: 0, joinFailed: 0 };
  const buildings: Building[] = [];

  for (const p of pieces.values()) {
    // In tile space (y down) outer rings have positive area and holes negative.
    const outers = p.rings.filter((r) => signedArea(r) > 0);
    if (p.area < 1 || outers.length === 0) continue;
    const cx = p.sx / p.area;
    const cy = p.sy / p.area;
    if (cx < bounds[0] || cy < bounds[1] || cx >= bounds[2] || cy >= bounds[3]) continue;

    let ring: Ring;
    if (p.cut && outers.length > 1) {
      const joined = mergeAcrossSeams(outers, TILE_EXTENT);
      if (joined && joined.length > 0) {
        ring = largest(joined);
        stats.joined++;
      } else {
        ring = largest(outers);
        stats.joinFailed++;
      }
    } else {
      ring = largest(outers);
    }

    let outline = world.coordsToLocal(Float64Array.from(ring));
    if (signedArea(outline) < 0) outline = reverseRing(outline);
    outline = removeCollinear(outline, 0.05);

    const inner = interiorPoint(p.rings, world.toWorld(cx, cy)[1]);
    const [ix, iy] = inner ? world.toLocal(inner[0], inner[1]) : [cx, cy];

    const heightKnown = validHeight(p.height);
    const height = heightKnown ? p.height! : DEFAULT_HEIGHT;
    buildings.push({
      outline,
      cx,
      cy,
      ix,
      iy,
      footprint: p.area,
      height,
      heightKnown,
      base: Math.min(p.minHeight ?? 0, height),
      outlineHeight: height,
      partFloor: 0,
      partCover: 0,
      floorArea: 0,
      use: "residential",
      residents: 0,
      jobs: 0,
    });
  }
  return { buildings, stats };
}

/** Uniform bucket index over building outlines for point lookups. */
export class BuildingIndex {
  private buckets = new Map<number, number[]>();
  private readonly cols: number;

  constructor(
    private buildings: Building[],
    private x0: number,
    private y0: number,
    width: number,
    private cell = 100,
  ) {
    this.cols = Math.ceil(width / cell) + 1;
    buildings.forEach((b, i) => {
      const [bx0, by0, bx1, by1] = ringBounds(b.outline);
      for (let r = this.row(by0); r <= this.row(by1); r++) {
        for (let c = this.col(bx0); c <= this.col(bx1); c++) {
          const key = r * this.cols + c;
          let list = this.buckets.get(key);
          if (!list) this.buckets.set(key, (list = []));
          list.push(i);
        }
      }
    });
  }

  private col(x: number) {
    return Math.floor((x - this.x0) / this.cell);
  }

  private row(y: number) {
    return Math.floor((y - this.y0) / this.cell);
  }

  /** Index of the smallest building containing the point, or -1. */
  find(x: number, y: number): number {
    const list = this.buckets.get(this.row(y) * this.cols + this.col(x));
    if (!list) return -1;
    let best = -1;
    for (const i of list) {
      const b = this.buildings[i];
      if (pointInRing(b.outline, x, y) && (best < 0 || b.footprint < this.buildings[best].footprint)) best = i;
    }
    return best;
  }
}

/**
 * Buildings mapped in 3D keep their real heights on building:part features,
 * while the outline often carries a single height for a podium and its tower.
 * Parts found inside a building raise its height and replace the outline's
 * estimate for the ground they stand on.
 */
export function applyParts(buildings: Building[], parts: Map<number, BuildingPieces>, index: BuildingIndex): number {
  let used = 0;
  for (const p of parts.values()) {
    if (p.area < 1 || !validHeight(p.height)) continue;
    const bi = index.find(p.sx / p.area, p.sy / p.area);
    if (bi < 0) continue;
    const b = buildings[bi];
    const bottom = Math.min(p.minHeight ?? 0, p.height);
    b.partFloor += p.area * storeys(bottom, p.height);
    if (bottom < 1) b.partCover += p.area;
    b.height = b.heightKnown ? Math.max(b.height, p.height) : p.height;
    b.heightKnown = true;
    used++;
  }
  return used;
}

/** Gross floor area; needs the building's use, so it runs after classification. */
export function estimateFloorArea(b: Building): number {
  let n = storeys(b.base, b.outlineHeight);
  if (b.use !== "residential" && b.footprint > HALL_FOOTPRINT) n = Math.min(n, HALL_MAX_STOREYS);
  return b.partFloor + Math.max(0, b.footprint - b.partCover) * n;
}
