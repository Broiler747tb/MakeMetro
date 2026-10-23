import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Building } from "./buildings";
import { GRID_LAYERS, type Grid } from "./grid";
import type { NamePoint } from "./names";
import { KIND_CODE } from "./weights";

const BUILDINGS_MAGIC = 0x44424d4d; // "MMBD" when read as bytes
const BUILDINGS_VERSION = 1;

export function writeGrid(dir: string, grid: Grid): string {
  const plane = grid.size * 4;
  const buf = Buffer.alloc(plane * GRID_LAYERS.length);
  GRID_LAYERS.forEach((name, k) => {
    const data = grid.layers[name];
    for (let i = 0; i < data.length; i++) buf.writeFloatLE(data[i], k * plane + i * 4);
  });
  const path = join(dir, "grid.bin");
  writeFileSync(path, buf);
  return path;
}

/**
 * Layout: uint32 magic, version, count, vertexCount; float32 props[count * 6]
 * (cx, cy, height, floorArea, residents, jobs); uint8 kind[count] padded to 4
 * bytes; uint32 ringStart[count + 1]; float32 verts[vertexCount * 2].
 */
export function writeBuildings(dir: string, buildings: Building[]): string {
  const count = buildings.length;
  const vertexCount = buildings.reduce((n, b) => n + b.outline.length / 2, 0);
  const kindBytes = Math.ceil(count / 4) * 4;
  const size = 16 + count * 24 + kindBytes + (count + 1) * 4 + vertexCount * 8;
  const buf = Buffer.alloc(size);

  buf.writeUInt32LE(BUILDINGS_MAGIC, 0);
  buf.writeUInt32LE(BUILDINGS_VERSION, 4);
  buf.writeUInt32LE(count, 8);
  buf.writeUInt32LE(vertexCount, 12);

  let o = 16;
  for (const b of buildings) {
    for (const v of [b.cx, b.cy, b.height, b.floorArea, b.residents, b.jobs]) {
      buf.writeFloatLE(v, o);
      o += 4;
    }
  }
  for (const b of buildings) buf.writeUInt8(KIND_CODE[b.use], o++);
  o = 16 + count * 24 + kindBytes;

  let start = 0;
  for (const b of buildings) {
    buf.writeUInt32LE(start, o);
    o += 4;
    start += b.outline.length / 2;
  }
  buf.writeUInt32LE(start, o);
  o += 4;

  for (const b of buildings) {
    for (const v of b.outline) {
      buf.writeFloatLE(v, o);
      o += 4;
    }
  }
  const path = join(dir, "buildings.bin");
  writeFileSync(path, buf);
  return path;
}

export function writeNames(dir: string, names: NamePoint[]): string {
  const path = join(dir, "names.json");
  writeFileSync(path, JSON.stringify(names));
  return path;
}

export function writeJson(dir: string, file: string, value: unknown): string {
  const path = join(dir, file);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}
