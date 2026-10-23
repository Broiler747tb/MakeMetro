import { openSync, readSync, closeSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { VectorTile, type VectorTileFeature } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { Compression, PMTiles, type Source, type RangeResponse } from "pmtiles";
import {
  latToTileY,
  lonToTileX,
  tileRange,
  tileXToLon,
  tileYToLat,
  toLocal,
  toLonLat,
  type BBox,
  type Projection,
} from "./projection";

export const TILE_EXTENT = 4096;

class LocalFileSource implements Source {
  private fd: number;
  constructor(private path: string) {
    this.fd = openSync(path, "r");
  }
  getKey() {
    return this.path;
  }
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const buf = Buffer.alloc(length);
    readSync(this.fd, buf, 0, length, offset);
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + length) };
  }
  close() {
    closeSync(this.fd);
  }
}

async function decompress(buf: ArrayBuffer, compression: Compression): Promise<ArrayBuffer> {
  if (compression === Compression.None || compression === Compression.Unknown) return buf;
  if (compression !== Compression.Gzip) throw new Error(`Unsupported tile compression ${compression}`);
  const out = gunzipSync(new Uint8Array(buf));
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

/**
 * Geometry is kept in "world pixels": tile coordinates offset by the tile index,
 * so the shared edge of two neighbouring tiles has exactly the same coordinate in both.
 */
export class WorldPixels {
  readonly size: number;

  constructor(
    readonly proj: Projection,
    readonly zoom: number,
  ) {
    this.size = 2 ** zoom * TILE_EXTENT;
  }

  toLocal(wx: number, wy: number): [number, number] {
    return toLocal(this.proj, tileXToLon(wx / TILE_EXTENT, this.zoom), tileYToLat(wy / TILE_EXTENT, this.zoom));
  }

  toWorld(x: number, y: number): [number, number] {
    const [lon, lat] = toLonLat(this.proj, x, y);
    return [lonToTileX(lon, this.zoom) * TILE_EXTENT, latToTileY(lat, this.zoom) * TILE_EXTENT];
  }

  /** Converts a flat [x0, y0, x1, y1, ...] array in place. */
  coordsToLocal(ring: Float64Array): Float64Array {
    for (let i = 0; i < ring.length; i += 2) {
      const [x, y] = this.toLocal(ring[i], ring[i + 1]);
      ring[i] = x;
      ring[i + 1] = y;
    }
    return ring;
  }
}

export interface Tile {
  z: number;
  x: number;
  y: number;
  layers: VectorTile["layers"];
}

/** Rings or lines of a feature in world pixels; rings lose their repeated closing point. */
export function worldGeometry(tile: Tile, f: VectorTileFeature): Float64Array[] {
  if (f.extent !== TILE_EXTENT) throw new Error(`Unexpected tile extent ${f.extent}`);
  const ox = tile.x * TILE_EXTENT;
  const oy = tile.y * TILE_EXTENT;
  const out: Float64Array[] = [];
  for (const ring of f.loadGeometry()) {
    let n = ring.length;
    if (f.type === 3 && n > 1 && ring[0].x === ring[n - 1].x && ring[0].y === ring[n - 1].y) n--;
    const flat = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) {
      flat[2 * i] = ox + ring[i].x;
      flat[2 * i + 1] = oy + ring[i].y;
    }
    out.push(flat);
  }
  return out;
}

export async function readTiles(path: string, bbox: BBox, z: number, visit: (tile: Tile) => void): Promise<number> {
  const source = new LocalFileSource(path);
  let count = 0;
  try {
    const archive = new PMTiles(source, undefined, decompress);
    const header = await archive.getHeader();
    if (header.maxZoom < z) throw new Error(`${path} only goes to zoom ${header.maxZoom}`);
    const range = tileRange(bbox, z);
    for (let y = range.minY; y <= range.maxY; y++) {
      for (let x = range.minX; x <= range.maxX; x++) {
        const res = await archive.getZxy(z, x, y);
        if (!res) continue;
        visit({ z, x, y, layers: new VectorTile(new PbfReader(new Uint8Array(res.data))).layers });
        count++;
      }
    }
  } finally {
    source.close();
  }
  return count;
}
