import { readFileSync, writeFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { fromFile } from "geotiff";
import { cachePath, download, isCached } from "./cache";
import type { BBox } from "./projection";

const PRODUCT = "GHS_POP_E2025_GLOBE_R2023A_4326_3ss_V1_0";
const BASE_URL =
  "https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_POP_GLOBE_R2023A/GHS_POP_E2025_GLOBE_R2023A_4326_3ss/V1-0/tiles";

// The WGS84 GHSL products are cut into 10 x 10 degree tiles, R1_C1 at the
// north-west corner. The global raster's origin sits half a pixel off whole
// degrees (-180.0079, 89.0996), so tile edges are shifted by the same amount.
const RES = 3 / 3600;
const ORIGIN_LON = -180 - 9.5 * RES;
const ORIGIN_LAT = 89 + 119.5 * RES;
const TILE_DEG = 10;

/** Population raster window covering a bbox. Row 0 is the north edge. */
export interface PopulationRaster {
  /** Longitude of the west edge of column 0. */
  lon0: number;
  /** Latitude of the north edge of row 0. */
  lat0: number;
  res: number;
  width: number;
  height: number;
  values: Float32Array;
  tiles: string[];
}

function tilesFor(bbox: BBox): { row: number; col: number }[] {
  const col0 = Math.floor((bbox[0] - ORIGIN_LON) / TILE_DEG) + 1;
  const col1 = Math.floor((bbox[2] - ORIGIN_LON) / TILE_DEG) + 1;
  const row0 = Math.floor((ORIGIN_LAT - bbox[3]) / TILE_DEG) + 1;
  const row1 = Math.floor((ORIGIN_LAT - bbox[1]) / TILE_DEG) + 1;
  const out = [];
  for (let row = row0; row <= row1; row++) for (let col = col0; col <= col1; col++) out.push({ row, col });
  return out;
}

async function ensureTile(name: string): Promise<string | null> {
  const tif = cachePath("ghsl", `${name}.tif`);
  if (isCached(tif)) return tif;
  const zip = cachePath("ghsl", `${name}.zip`);
  console.log(`Downloading ${name}.zip`);
  // Tiles that are all sea or empty land are simply not published.
  if (!(await download(`${BASE_URL}/${name}.zip`, zip))) return null;
  const files = unzipSync(readFileSync(zip), { filter: (f) => f.name.endsWith(".tif") });
  const data = files[`${name}.tif`];
  if (!data) throw new Error(`${zip} has no ${name}.tif`);
  writeFileSync(tif, data);
  return tif;
}

export async function loadPopulation(bbox: BBox): Promise<PopulationRaster> {
  const c0 = Math.floor((bbox[0] - ORIGIN_LON) / RES);
  const c1 = Math.ceil((bbox[2] - ORIGIN_LON) / RES);
  const r0 = Math.floor((ORIGIN_LAT - bbox[3]) / RES);
  const r1 = Math.ceil((ORIGIN_LAT - bbox[1]) / RES);
  const width = c1 - c0;
  const height = r1 - r0;
  const values = new Float32Array(width * height);
  const used: string[] = [];

  for (const { row, col } of tilesFor(bbox)) {
    const name = `${PRODUCT}_R${row}_C${col}`;
    const path = await ensureTile(name);
    if (!path) continue;
    used.push(name);

    const tiff = await fromFile(path);
    const image = await tiff.getImage();
    const [west, , , north] = image.getBoundingBox();
    const [resX, resY] = image.getResolution();
    if (Math.abs(resX - RES) > 1e-9 || Math.abs(-resY - RES) > 1e-9) throw new Error(`${name}: unexpected resolution`);

    // Pixel offset of this tile inside the global raster.
    const tc = Math.round((west - ORIGIN_LON) / RES);
    const tr = Math.round((ORIGIN_LAT - north) / RES);
    const x0 = Math.max(c0, tc);
    const x1 = Math.min(c1, tc + image.getWidth());
    const y0 = Math.max(r0, tr);
    const y1 = Math.min(r1, tr + image.getHeight());
    if (x1 <= x0 || y1 <= y0) continue;

    const [band] = (await image.readRasters({ window: [x0 - tc, y0 - tr, x1 - tc, y1 - tr], samples: [0] })) as unknown as [
      ArrayLike<number>,
    ];
    const w = x1 - x0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const v = band[(y - y0) * w + (x - x0)];
        if (v > 0) values[(y - r0) * width + (x - c0)] = v;
      }
    }
  }

  return { lon0: ORIGIN_LON + c0 * RES, lat0: ORIGIN_LAT - r0 * RES, res: RES, width, height, values, tiles: used };
}
