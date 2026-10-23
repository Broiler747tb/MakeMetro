/** Rings and lines are flat arrays [x0, y0, x1, y1, ...] with no repeated closing point. */
export type Ring = Float64Array;

export function signedArea(ring: Ring): number {
  const n = ring.length / 2;
  let a = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    a += ring[2 * j] * ring[2 * i + 1] - ring[2 * i] * ring[2 * j + 1];
  }
  return a / 2;
}

/** Signed area and the area-weighted centroid sums of a ring. */
export function ringMoments(ring: Ring): { area: number; sx: number; sy: number } {
  const n = ring.length / 2;
  // Shift to the first vertex so large coordinates don't eat precision.
  const ox = ring[0];
  const oy = ring[1];
  let a = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xj = ring[2 * j] - ox;
    const yj = ring[2 * j + 1] - oy;
    const xi = ring[2 * i] - ox;
    const yi = ring[2 * i + 1] - oy;
    const c = xj * yi - xi * yj;
    a += c;
    sx += (xj + xi) * c;
    sy += (yj + yi) * c;
  }
  const area = a / 2;
  return { area, sx: sx / 6 + ox * area, sy: sy / 6 + oy * area };
}

export function ringBounds(ring: Ring): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    const x = ring[i];
    const y = ring[i + 1];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

export function pointInRing(ring: Ring, x: number, y: number): boolean {
  const n = ring.length / 2;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[2 * i];
    const yi = ring[2 * i + 1];
    const xj = ring[2 * j];
    const yj = ring[2 * j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function clipEdge(input: number[], axis: 0 | 1, bound: number, keepGreater: boolean): number[] {
  const out: number[] = [];
  const n = input.length / 2;
  if (n === 0) return out;
  const inside = (i: number) => (keepGreater ? input[2 * i + axis] >= bound : input[2 * i + axis] <= bound);
  for (let i = 0; i < n; i++) {
    const j = (i + n - 1) % n;
    const curIn = inside(i);
    const prevIn = inside(j);
    if (curIn !== prevIn) {
      const a = input[2 * j + axis];
      const b = input[2 * i + axis];
      const t = (bound - a) / (b - a);
      const other = 1 - axis;
      const o = input[2 * j + other] + t * (input[2 * i + other] - input[2 * j + other]);
      // Put the crossing exactly on the bound so seams line up between tiles.
      if (axis === 0) out.push(bound, o);
      else out.push(o, bound);
    }
    if (curIn) out.push(input[2 * i], input[2 * i + 1]);
  }
  return out;
}

/** Sutherland-Hodgman clip of a ring to an axis-aligned rectangle. */
export function clipRingToRect(ring: Ring, x0: number, y0: number, x1: number, y1: number): Ring {
  const [bx0, by0, bx1, by1] = ringBounds(ring);
  if (bx0 >= x0 && bx1 <= x1 && by0 >= y0 && by1 <= y1) return ring;
  let pts = Array.from(ring);
  pts = clipEdge(pts, 0, x0, true);
  pts = clipEdge(pts, 0, x1, false);
  pts = clipEdge(pts, 1, y0, true);
  pts = clipEdge(pts, 1, y1, false);
  return new Float64Array(pts);
}

/** Liang-Barsky clip of a polyline to a rectangle; returns the pieces inside. */
export function clipLineToRect(line: Float64Array, x0: number, y0: number, x1: number, y1: number): Float64Array[] {
  const pieces: Float64Array[] = [];
  let cur: number[] = [];
  const flush = () => {
    if (cur.length >= 4) pieces.push(new Float64Array(cur));
    cur = [];
  };
  for (let i = 0; i + 3 < line.length; i += 2) {
    const ax = line[i];
    const ay = line[i + 1];
    const dx = line[i + 2] - ax;
    const dy = line[i + 3] - ay;
    let t0 = 0;
    let t1 = 1;
    const p = [-dx, dx, -dy, dy];
    const q = [ax - x0, x1 - ax, ay - y0, y1 - ay];
    let visible = true;
    for (let k = 0; k < 4 && visible; k++) {
      if (p[k] === 0) {
        if (q[k] < 0) visible = false;
      } else {
        const r = q[k] / p[k];
        if (p[k] < 0) t0 = Math.max(t0, r);
        else t1 = Math.min(t1, r);
        if (t0 > t1) visible = false;
      }
    }
    if (!visible) {
      flush();
      continue;
    }
    const sx = ax + t0 * dx;
    const sy = ay + t0 * dy;
    const n = cur.length;
    if (n === 0 || cur[n - 2] !== sx || cur[n - 1] !== sy) {
      flush();
      cur.push(sx, sy);
    }
    cur.push(ax + t1 * dx, ay + t1 * dy);
    if (t1 < 1) flush();
  }
  flush();
  return pieces;
}

export function lineLength(line: Float64Array): number {
  let len = 0;
  for (let i = 0; i + 3 < line.length; i += 2) len += Math.hypot(line[i + 2] - line[i], line[i + 3] - line[i + 1]);
  return len;
}

/** Point at distance d along a polyline. */
export function pointAlong(line: Float64Array, d: number): [number, number] {
  for (let i = 0; i + 3 < line.length; i += 2) {
    const seg = Math.hypot(line[i + 2] - line[i], line[i + 3] - line[i + 1]);
    if (d <= seg || i + 4 >= line.length) {
      const t = seg > 0 ? Math.min(1, d / seg) : 0;
      return [line[i] + t * (line[i + 2] - line[i]), line[i + 1] + t * (line[i + 3] - line[i + 1])];
    }
    d -= seg;
  }
  return [line[0], line[1]];
}

/** Drops vertices that lie on the straight line between their neighbours. */
export function removeCollinear(ring: Ring, tolerance: number): Ring {
  const n = ring.length / 2;
  if (n <= 3) return ring;
  const keep: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = (i + n - 1) % n;
    const q = (i + 1) % n;
    const ax = ring[2 * p];
    const ay = ring[2 * p + 1];
    const bx = ring[2 * q];
    const by = ring[2 * q + 1];
    const len = Math.hypot(bx - ax, by - ay);
    const cross = (bx - ax) * (ring[2 * i + 1] - ay) - (by - ay) * (ring[2 * i] - ax);
    if (len === 0 || Math.abs(cross) / len > tolerance) keep.push(ring[2 * i], ring[2 * i + 1]);
  }
  return keep.length >= 6 ? new Float64Array(keep) : ring;
}

/**
 * Joins pieces of one polygon that were cut along a regular grid of seams
 * (tile edges every `step` units). Each piece must already be clipped exactly
 * to its own cell, and all pieces must share the same winding. Edges lying on a
 * seam cancel against the opposite edge of the neighbouring piece; whatever
 * remains is chained back into rings. Returns null if the edges don't close.
 */
export function mergeAcrossSeams(pieces: Ring[], step: number): Ring[] | null {
  const edges: number[] = [];
  const seams = new Map<string, number[]>();
  const addSeam = (key: string, from: number, to: number) => {
    let list = seams.get(key);
    if (!list) seams.set(key, (list = []));
    list.push(from, to);
  };

  for (const r of pieces) {
    const n = r.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = r[2 * i];
      const ay = r[2 * i + 1];
      const bx = r[2 * j];
      const by = r[2 * j + 1];
      if (ax === bx && ay === by) continue;
      if (ax === bx && ax % step === 0) addSeam(`x${ax}`, ay, by);
      else if (ay === by && ay % step === 0) addSeam(`y${ay}`, ax, bx);
      else edges.push(ax, ay, bx, by);
    }
  }

  for (const [key, list] of seams) {
    const c = Number(key.slice(1));
    const vertical = key[0] === "x";
    const stops = [...new Set(list)].sort((a, b) => a - b);
    const index = new Map(stops.map((v, i) => [v, i]));
    const diff = new Int32Array(stops.length);
    for (let k = 0; k < list.length; k += 2) {
      const from = list[k];
      const to = list[k + 1];
      const s = to > from ? 1 : -1;
      diff[index.get(Math.min(from, to))!] += s;
      diff[index.get(Math.max(from, to))!] -= s;
    }
    let cover = 0;
    for (let k = 0; k + 1 < stops.length; k++) {
      cover += diff[k];
      if (cover === 0) continue;
      const [a, b] = cover > 0 ? [stops[k], stops[k + 1]] : [stops[k + 1], stops[k]];
      if (vertical) edges.push(c, a, c, b);
      else edges.push(a, c, b, c);
    }
  }

  const byStart = new Map<string, number[]>();
  const edgeCount = edges.length / 4;
  for (let e = 0; e < edgeCount; e++) {
    const key = `${edges[4 * e]},${edges[4 * e + 1]}`;
    let list = byStart.get(key);
    if (!list) byStart.set(key, (list = []));
    list.push(e);
  }

  const used = new Uint8Array(edgeCount);
  const rings: Ring[] = [];
  for (let start = 0; start < edgeCount; start++) {
    if (used[start]) continue;
    const pts: number[] = [];
    let e = start;
    for (;;) {
      used[e] = 1;
      pts.push(edges[4 * e], edges[4 * e + 1]);
      const next = byStart.get(`${edges[4 * e + 2]},${edges[4 * e + 3]}`)?.find((k) => !used[k]);
      if (next === undefined) break;
      e = next;
    }
    const closes = edges[4 * e + 2] === edges[4 * start] && edges[4 * e + 3] === edges[4 * start + 1];
    if (!closes) return null;
    if (pts.length >= 6) rings.push(new Float64Array(pts));
  }
  return rings;
}

/**
 * A point inside a polygon (rings with holes, even-odd), on the horizontal line
 * through `y`: the middle of the widest span. Unlike the centroid, it does not
 * land in a courtyard.
 */
export function interiorPoint(rings: Ring[], y: number): [number, number] | null {
  const xs: number[] = [];
  for (const r of rings) {
    const n = r.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ay = r[2 * j + 1];
      const by = r[2 * i + 1];
      if (ay > y !== by > y) xs.push(r[2 * j] + ((y - ay) * (r[2 * i] - r[2 * j])) / (by - ay));
    }
  }
  xs.sort((a, b) => a - b);
  let best = -1;
  let width = 0;
  for (let k = 0; k + 1 < xs.length; k += 2) {
    if (xs[k + 1] - xs[k] > width) {
      width = xs[k + 1] - xs[k];
      best = k;
    }
  }
  return best < 0 ? null : [(xs[best] + xs[best + 1]) / 2, y];
}

export function reverseRing(ring: Ring): Ring {
  const n = ring.length / 2;
  const out = new Float64Array(ring.length);
  for (let i = 0; i < n; i++) {
    out[2 * i] = ring[2 * (n - 1 - i)];
    out[2 * i + 1] = ring[2 * (n - 1 - i) + 1];
  }
  return out;
}
