import { copyFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { PNG } from "pngjs";
import { cachePath, download, runPool } from "./cache";
import { latToTileY, lonToTileX, tileRange, type BBox } from "./projection";

const ZOOM = 12;
const SIZE = 256;
const URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";

/** Bilinear sampler over Terrarium elevation tiles. */
export class Elevation {
  private tiles = new Map<string, Float32Array>();

  static async load(bbox: BBox): Promise<Elevation> {
    const elevation = new Elevation();
    const r = tileRange(bbox, ZOOM);
    const jobs: { x: number; y: number }[] = [];
    // One tile of margin so bilinear sampling at the bbox edge has neighbours.
    for (let y = r.minY - 1; y <= r.maxY + 1; y++) for (let x = r.minX - 1; x <= r.maxX + 1; x++) jobs.push({ x, y });
    await runPool(jobs, 8, async ({ x, y }) => {
      const path = cachePath("terrarium", String(ZOOM), String(x), `${y}.png`);
      if (!(await download(`${URL}/${ZOOM}/${x}/${y}.png`, path))) return;
      elevation.tiles.set(`${x}/${y}`, decodeTerrarium(readFileSync(path)));
    });
    return elevation;
  }

  get tileCount(): number {
    return this.tiles.size;
  }

  private pixel(px: number, py: number): number {
    const tx = Math.floor(px / SIZE);
    const ty = Math.floor(py / SIZE);
    const tile = this.tiles.get(`${tx}/${ty}`);
    if (!tile) return 0;
    return tile[(py - ty * SIZE) * SIZE + (px - tx * SIZE)];
  }

  at(lon: number, lat: number): number {
    // Pixel centres sit at half-integer positions.
    const fx = lonToTileX(lon, ZOOM) * SIZE - 0.5;
    const fy = latToTileY(lat, ZOOM) * SIZE - 0.5;
    const x = Math.floor(fx);
    const y = Math.floor(fy);
    const tx = fx - x;
    const ty = fy - y;
    const top = this.pixel(x, y) * (1 - tx) + this.pixel(x + 1, y) * tx;
    const bottom = this.pixel(x, y + 1) * (1 - tx) + this.pixel(x + 1, y + 1) * tx;
    return top * (1 - ty) + bottom * ty;
  }
}

function decodeTerrarium(buf: Buffer): Float32Array {
  const png = PNG.sync.read(buf);
  if (png.width !== SIZE || png.height !== SIZE) throw new Error(`Unexpected terrarium tile size ${png.width}`);
  const out = new Float32Array(SIZE * SIZE);
  const d = png.data;
  for (let i = 0; i < out.length; i++) out[i] = d[4 * i] * 256 + d[4 * i + 1] + d[4 * i + 2] / 256 - 32768;
  return out;
}

/**
 * Copies Terrarium tiles for the bbox into the pack so the game can shade hills. The pack
 * keeps them as plain PNG files, at the zooms where hill shading shows.
 */
export async function writeTerrainTiles(bbox: BBox, outDir: string, minZoom = 8, maxZoom = ZOOM): Promise<{ count: number; bytes: number }> {
  const jobs: { z: number; x: number; y: number }[] = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const r = tileRange(bbox, z);
    for (let y = r.minY; y <= r.maxY; y++) for (let x = r.minX; x <= r.maxX; x++) jobs.push({ z, x, y });
  }
  let bytes = 0;
  let count = 0;
  await runPool(jobs, 8, async ({ z, x, y }) => {
    const src = cachePath("terrarium", String(z), String(x), `${y}.png`);
    if (!(await download(`${URL}/${z}/${x}/${y}.png`, src))) return;
    const dst = join(outDir, "dem", String(z), String(x), `${y}.png`);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
    bytes += statSync(dst).size;
    count++;
  });
  return { count, bytes };
}
