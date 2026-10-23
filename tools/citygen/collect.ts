import type { VectorTileFeature } from "@mapbox/vector-tile";
import { clipLineToRect, clipRingToRect, ringMoments, type Ring } from "./geometry";
import { worldGeometry, readTiles, TILE_EXTENT, WorldPixels, type Tile } from "./tiles";
import { NOT_WATER } from "./weights";
import type { BBox } from "./projection";

/** All pieces of one OSM building or building part, gathered from every tile it touches. */
export interface BuildingPieces {
  /** Rings (outer and holes) clipped to their tile, in world pixels. Not kept for building parts. */
  rings: Ring[];
  /** Net footprint area and its first moments, local metres. */
  area: number;
  sx: number;
  sy: number;
  height?: number;
  minHeight?: number;
  /** True if any piece was cut at a tile edge. */
  cut: boolean;
}

export interface Point {
  kind: string;
  name?: string;
  nameEn?: string;
  x: number;
  y: number;
  detail?: string;
  minZoom: number;
}

export interface NamedLine {
  name: string;
  nameEn?: string;
  kind: string;
  detail: string;
  line: Float64Array;
}

export interface Features {
  tiles: number;
  buildings: Map<number, BuildingPieces>;
  /** building:part features, which detail the height of parts of a building. */
  parts: Map<number, BuildingPieces>;
  /** Landuse polygons (rings in local metres) by kind. */
  landuse: Map<string, Ring[][]>;
  water: Ring[][];
  pois: Point[];
  places: Point[];
  roads: NamedLine[];
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function toPoint(world: WorldPixels, tile: Tile, f: VectorTileFeature): Point | null {
  const p = f.loadGeometry()[0]?.[0];
  if (!p || f.id === undefined) return null;
  const [x, y] = world.toLocal(tile.x * TILE_EXTENT + p.x, tile.y * TILE_EXTENT + p.y);
  return {
    kind: String(f.properties.kind ?? ""),
    name: str(f.properties.name),
    nameEn: str(f.properties["name:en"]),
    x,
    y,
    detail: str(f.properties.kind_detail),
    minZoom: num(f.properties.min_zoom) ?? 99,
  };
}

/** Rings of a polygon feature in local metres, with holes. */
function localRings(world: WorldPixels, tile: Tile, f: VectorTileFeature): Ring[] {
  return worldGeometry(tile, f).map((r) => world.coordsToLocal(r));
}

export async function collectFeatures(path: string, bbox: BBox, world: WorldPixels): Promise<Features> {
  const out: Features = {
    tiles: 0,
    buildings: new Map(),
    parts: new Map(),
    landuse: new Map(),
    water: [],
    pois: [],
    places: [],
    roads: [],
  };

  const addBuilding = (target: Map<number, BuildingPieces>, tile: Tile, f: VectorTileFeature, keepOutline: boolean) => {
    if (f.type !== 3 || f.id === undefined) return;
    const x0 = tile.x * TILE_EXTENT;
    const y0 = tile.y * TILE_EXTENT;
    let b = target.get(f.id);
    if (!b) {
      b = { rings: [], area: 0, sx: 0, sy: 0, cut: false };
      target.set(f.id, b);
    }
    for (const ring of worldGeometry(tile, f)) {
      const clipped = clipRingToRect(ring, x0, y0, x0 + TILE_EXTENT, y0 + TILE_EXTENT);
      if (clipped !== ring) b.cut = true;
      if (clipped.length < 6) continue;
      if (keepOutline) b.rings.push(clipped);
      const m = ringMoments(world.coordsToLocal(Float64Array.from(clipped)));
      // Converting to y-up flips the winding, hence the minus signs.
      b.area -= m.area;
      b.sx -= m.sx;
      b.sy -= m.sy;
    }
    const h = num(f.properties.height);
    const mh = num(f.properties.min_height);
    if (h !== undefined) b.height = Math.max(b.height ?? 0, h);
    if (mh !== undefined) b.minHeight = Math.min(b.minHeight ?? Infinity, mh);
  };

  const addRoad = (tile: Tile, f: VectorTileFeature) => {
    const name = str(f.properties.name);
    if (!name || f.type !== 2) return;
    const x0 = tile.x * TILE_EXTENT;
    const y0 = tile.y * TILE_EXTENT;
    for (const line of worldGeometry(tile, f)) {
      // Clip to the tile itself so the buffer overlap isn't counted twice.
      for (const piece of clipLineToRect(line, x0, y0, x0 + TILE_EXTENT, y0 + TILE_EXTENT)) {
        out.roads.push({
          name,
          nameEn: str(f.properties["name:en"]),
          kind: String(f.properties.kind ?? ""),
          detail: String(f.properties.kind_detail ?? ""),
          line: world.coordsToLocal(piece),
        });
      }
    }
  };

  // Points near a tile edge are repeated in the neighbouring tile's buffer.
  const seenPois = new Set<number>();
  const seenPlaces = new Set<number>();
  const addPoint = (list: Point[], seen: Set<number>, tile: Tile, f: VectorTileFeature) => {
    if (f.type !== 1 || f.id === undefined || seen.has(f.id)) return;
    const p = toPoint(world, tile, f);
    if (!p) return;
    seen.add(f.id);
    list.push(p);
  };

  out.tiles = await readTiles(path, bbox, world.zoom, (tile) => {
    const { buildings, landuse, water, pois, places, roads } = tile.layers;
    if (buildings) {
      for (let i = 0; i < buildings.length; i++) {
        const f = buildings.feature(i);
        if (f.properties.kind === "building") addBuilding(out.buildings, tile, f, true);
        else if (f.properties.kind === "building_part") addBuilding(out.parts, tile, f, false);
      }
    }
    if (landuse) {
      for (let i = 0; i < landuse.length; i++) {
        const f = landuse.feature(i);
        if (f.type !== 3) continue;
        const kind = String(f.properties.kind);
        let list = out.landuse.get(kind);
        if (!list) out.landuse.set(kind, (list = []));
        list.push(localRings(world, tile, f));
      }
    }
    if (water) {
      for (let i = 0; i < water.length; i++) {
        const f = water.feature(i);
        if (f.type === 3 && !NOT_WATER.has(String(f.properties.kind))) out.water.push(localRings(world, tile, f));
      }
    }
    if (pois) for (let i = 0; i < pois.length; i++) addPoint(out.pois, seenPois, tile, pois.feature(i));
    if (places) for (let i = 0; i < places.length; i++) addPoint(out.places, seenPlaces, tile, places.feature(i));
    if (roads) for (let i = 0; i < roads.length; i++) addRoad(tile, roads.feature(i));
  });

  return out;
}
