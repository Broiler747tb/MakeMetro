import { pointInRing, segmentDistance } from "../game/geometry";

const MAGIC = 0x44424d4d; // "MMBD"
const INDEX_CELL = 200; // m

export const BUILDING_KINDS = ["Residential", "Office / commercial", "Industrial", "Education", "Retail", "Other"];

/** All buildings of a city pack, with a coarse grid index for corridor queries. */
export class Buildings {
  readonly count: number;
  readonly props: Float32Array; // cx, cy, height, floorArea, residents, jobs
  readonly kind: Uint8Array;
  readonly ringStart: Uint32Array;
  readonly verts: Float32Array;
  private minX = Infinity;
  private minY = Infinity;
  private cols = 0;
  private rows = 0;
  private cellStart!: Uint32Array;
  private cellItems!: Uint32Array;

  constructor(buf: ArrayBuffer) {
    const head = new Uint32Array(buf, 0, 4);
    if (head[0] !== MAGIC || head[1] !== 1) throw new Error("buildings.bin: bad header");
    const count = head[2];
    const vertexCount = head[3];
    let off = 16;
    this.count = count;
    this.props = new Float32Array(buf, off, count * 6);
    off += count * 24;
    this.kind = new Uint8Array(buf, off, count);
    off += (count + 3) & ~3;
    this.ringStart = new Uint32Array(buf, off, count + 1);
    off += (count + 1) * 4;
    this.verts = new Float32Array(buf, off, vertexCount * 2);
    this.buildIndex();
  }

  static async load(url: string, onProgress?: (fraction: number) => void): Promise<Buildings> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    const total = Number(res.headers.get("content-length")) || 0;
    if (!res.body || !total || !onProgress) return new Buildings(await res.arrayBuffer());
    const buf = new Uint8Array(total);
    const reader = res.body.getReader();
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf.set(value, got);
      got += value.length;
      onProgress(got / total);
    }
    return new Buildings(buf.buffer);
  }

  height(i: number): number {
    return this.props[i * 6 + 2];
  }
  floorArea(i: number): number {
    return this.props[i * 6 + 3];
  }
  residents(i: number): number {
    return this.props[i * 6 + 4];
  }
  jobs(i: number): number {
    return this.props[i * 6 + 5];
  }
  centroid(i: number): [number, number] {
    return [this.props[i * 6], this.props[i * 6 + 1]];
  }

  /** Estimated foundation depth: basements for ordinary blocks, deep piles for towers. */
  foundationDepth(i: number): number {
    return Math.min(30, 3 + 0.12 * this.height(i));
  }

  private buildIndex() {
    const { count, ringStart, verts } = this;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < verts.length; i += 2) {
      if (verts[i] < this.minX) this.minX = verts[i];
      if (verts[i + 1] < this.minY) this.minY = verts[i + 1];
      if (verts[i] > maxX) maxX = verts[i];
      if (verts[i + 1] > maxY) maxY = verts[i + 1];
    }
    if (count === 0) {
      this.cellStart = new Uint32Array(1);
      this.cellItems = new Uint32Array(0);
      return;
    }
    this.cols = Math.max(1, Math.ceil((maxX - this.minX) / INDEX_CELL) + 1);
    this.rows = Math.max(1, Math.ceil((maxY - this.minY) / INDEX_CELL) + 1);
    // Each building goes into every cell its bounding box touches.
    const bbox = new Float32Array(count * 4);
    const counts = new Uint32Array(this.cols * this.rows + 1);
    for (let i = 0; i < count; i++) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let v = ringStart[i] * 2; v < ringStart[i + 1] * 2; v += 2) {
        x0 = Math.min(x0, verts[v]);
        y0 = Math.min(y0, verts[v + 1]);
        x1 = Math.max(x1, verts[v]);
        y1 = Math.max(y1, verts[v + 1]);
      }
      bbox.set([x0, y0, x1, y1], i * 4);
      this.forCells(x0, y0, x1, y1, (c) => counts[c]++);
    }
    this.cellStart = new Uint32Array(this.cols * this.rows + 1);
    for (let c = 0; c < this.cols * this.rows; c++) this.cellStart[c + 1] = this.cellStart[c] + counts[c];
    this.cellItems = new Uint32Array(this.cellStart[this.cols * this.rows]);
    const fill = this.cellStart.slice(0, -1);
    for (let i = 0; i < count; i++) {
      this.forCells(bbox[i * 4], bbox[i * 4 + 1], bbox[i * 4 + 2], bbox[i * 4 + 3], (c) => {
        this.cellItems[fill[c]++] = i;
      });
    }
  }

  private forCells(x0: number, y0: number, x1: number, y1: number, fn: (cell: number) => void) {
    const c0 = Math.max(0, Math.floor((x0 - this.minX) / INDEX_CELL));
    const r0 = Math.max(0, Math.floor((y0 - this.minY) / INDEX_CELL));
    const c1 = Math.min(this.cols - 1, Math.floor((x1 - this.minX) / INDEX_CELL));
    const r1 = Math.min(this.rows - 1, Math.floor((y1 - this.minY) / INDEX_CELL));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) fn(r * this.cols + c);
  }

  /** Buildings whose footprint comes within halfWidth of the polyline. */
  alongPolyline(pts: number[], halfWidth: number, filter?: (i: number, sAlong: number) => boolean): number[] {
    const hits = new Set<number>();
    const seen = new Set<number>();
    let s = 0;
    for (let k = 0; k + 3 < pts.length; k += 2) {
      const ax = pts[k], ay = pts[k + 1], bx = pts[k + 2], by = pts[k + 3];
      seen.clear();
      this.forCells(Math.min(ax, bx) - halfWidth, Math.min(ay, by) - halfWidth, Math.max(ax, bx) + halfWidth, Math.max(ay, by) + halfWidth, (cell) => {
        for (let j = this.cellStart[cell]; j < this.cellStart[cell + 1]; j++) {
          const i = this.cellItems[j];
          if (hits.has(i) || seen.has(i)) continue;
          seen.add(i);
          if (this.touchesSegment(i, ax, ay, bx, by, halfWidth)) {
            const sAlong = s + projectT(ax, ay, bx, by, this.props[i * 6], this.props[i * 6 + 1]);
            if (!filter || filter(i, sAlong)) hits.add(i);
          }
        }
      });
      s += Math.hypot(bx - ax, by - ay);
    }
    return [...hits];
  }

  private touchesSegment(i: number, ax: number, ay: number, bx: number, by: number, w: number): boolean {
    const v0 = this.ringStart[i] * 2;
    const v1 = this.ringStart[i + 1] * 2;
    const vs = this.verts;
    if (v1 - v0 < 6) return false;
    if (pointInRing(ax, ay, vs, v0, v1)) return true;
    for (let v = v0, u = v1 - 2; v < v1; u = v, v += 2) {
      if (segmentDistance(vs[u], vs[u + 1], vs[v], vs[v + 1], ax, ay, bx, by) <= w) return true;
    }
    return false;
  }

  /** The building under a point, if any. */
  at(x: number, y: number): number {
    if (x < this.minX || y < this.minY) return -1;
    const c = Math.floor((x - this.minX) / INDEX_CELL);
    const r = Math.floor((y - this.minY) / INDEX_CELL);
    if (c >= this.cols || r >= this.rows) return -1;
    const cell = r * this.cols + c;
    for (let j = this.cellStart[cell]; j < this.cellStart[cell + 1]; j++) {
      const i = this.cellItems[j];
      if (pointInRing(x, y, this.verts, this.ringStart[i] * 2, this.ringStart[i + 1] * 2)) return i;
    }
    return -1;
  }

  ring(i: number): Float32Array {
    return this.verts.subarray(this.ringStart[i] * 2, this.ringStart[i + 1] * 2);
  }
}

function projectT(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len === 0) return 0;
  return Math.min(len, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len));
}

