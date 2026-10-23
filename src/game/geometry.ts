export type Vec2 = [number, number];

function dedupe(flat: number[]): number[] {
  const out: number[] = [flat[0], flat[1]];
  for (let i = 2; i < flat.length; i += 2) {
    const dx = flat[i] - out[out.length - 2];
    const dy = flat[i + 1] - out[out.length - 1];
    if (dx * dx + dy * dy > 0.01) out.push(flat[i], flat[i + 1]);
  }
  return out;
}

export function cumulative(pts: number[]): number[] {
  const s = [0];
  for (let i = 2; i < pts.length; i += 2) {
    s.push(s[s.length - 1] + Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]));
  }
  return s;
}

export function polylineLength(pts: number[]): number {
  let len = 0;
  for (let i = 2; i < pts.length; i += 2) len += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
  return len;
}

export interface Closest {
  x: number;
  y: number;
  dist: number;
  s: number; // distance along the polyline
  seg: number; // index of the segment's first vertex
}

export function closestOnPolyline(pts: number[], x: number, y: number): Closest {
  let best: Closest = { x: pts[0], y: pts[1], dist: Infinity, s: 0, seg: 0 };
  let s = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i], ay = pts[i + 1], bx = pts[i + 2], by = pts[i + 3];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
    const px = ax + dx * t, py = ay + dy * t;
    const d = Math.hypot(x - px, y - py);
    const len = Math.sqrt(len2);
    if (d < best.dist) best = { x: px, y: py, dist: d, s: s + len * t, seg: i / 2 };
    s += len;
  }
  return best;
}

export function pointAt(pts: number[], s: number): { x: number; y: number; dx: number; dy: number } {
  let acc = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const dx = pts[i + 2] - pts[i], dy = pts[i + 3] - pts[i + 1];
    const len = Math.hypot(dx, dy);
    if (acc + len >= s || i + 4 >= pts.length) {
      const t = len > 0 ? Math.min(1, Math.max(0, (s - acc) / len)) : 0;
      return { x: pts[i] + dx * t, y: pts[i + 1] + dy * t, dx: dx / (len || 1), dy: dy / (len || 1) };
    }
    acc += len;
  }
  return { x: pts[0], y: pts[1], dx: 1, dy: 0 };
}

/** Splits a polyline at distance s. Both halves include the split point. */
export function splitAt(pts: number[], s: number): [number[], number[]] {
  const a: number[] = [pts[0], pts[1]];
  let acc = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const dx = pts[i + 2] - pts[i], dy = pts[i + 3] - pts[i + 1];
    const len = Math.hypot(dx, dy);
    if (acc + len >= s) {
      const t = len > 0 ? (s - acc) / len : 0;
      const sx = pts[i] + dx * t, sy = pts[i + 1] + dy * t;
      a.push(sx, sy);
      const b = [sx, sy, ...pts.slice(i + 2)];
      return [dedupe(a), dedupe(b)];
    }
    a.push(pts[i + 2], pts[i + 3]);
    acc += len;
  }
  return [dedupe(a), [pts[pts.length - 2], pts[pts.length - 1]]];
}

export function reversePolyline(pts: number[]): number[] {
  const out: number[] = [];
  for (let i = pts.length - 2; i >= 0; i -= 2) out.push(pts[i], pts[i + 1]);
  return out;
}

/** Radius of the circle through three points; Infinity when they are collinear. */
export function circumradius(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  const a = Math.hypot(bx - cx, by - cy);
  const b = Math.hypot(ax - cx, ay - cy);
  const c = Math.hypot(ax - bx, ay - by);
  const area2 = Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
  if (area2 < 1e-6) return Infinity;
  return (a * b * c) / (2 * area2);
}

/** Radius at each vertex (Infinity on straights and at the ends). */
export function vertexRadii(pts: number[]): number[] {
  const n = pts.length / 2;
  const r = new Array<number>(n).fill(Infinity);
  for (let i = 1; i < n - 1; i++) {
    r[i] = circumradius(pts[2 * i - 2], pts[2 * i - 1], pts[2 * i], pts[2 * i + 1], pts[2 * i + 2], pts[2 * i + 3]);
  }
  return r;
}

export function minRadius(pts: number[]): number {
  return Math.min(...vertexRadii(pts));
}

/** Sideways lateral acceleration we allow on curves, including cant. */
const LATERAL_ACCEL = 1.0;

export function curveSpeed(radius: number): number {
  return Math.sqrt(LATERAL_ACCEL * radius);
}

export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function segmentsCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

export function segmentDistance(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): number {
  if (segmentsCross(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
  return Math.min(
    distToSegment(ax, ay, cx, cy, dx, dy),
    distToSegment(bx, by, cx, cy, dx, dy),
    distToSegment(cx, cy, ax, ay, bx, by),
    distToSegment(dx, dy, ax, ay, bx, by),
  );
}

export function pointInRing(x: number, y: number, ring: ArrayLike<number>, start: number, end: number): boolean {
  let inside = false;
  for (let i = start, j = end - 2; i < end; j = i, i += 2) {
    const xi = ring[i], yi = ring[i + 1], xj = ring[j], yj = ring[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function unit(dx: number, dy: number): Vec2 {
  const l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
}

/**
 * A smooth track through the bend points: it leaves `a` heading along `ta` and arrives
 * at `b` heading along `tb` (either may be null for a free end). Cubic Hermite pieces
 * whose tangent length depends on how far each piece turns, so a turn comes out as
 * close to a circular arc as a cubic gets: the widest curve that fits.
 */
export function smoothPath(a: Vec2, ta: Vec2 | null, bends: Vec2[], b: Vec2, tb: Vec2 | null, step = 8): number[] {
  const q: Vec2[] = [a, ...bends, b];
  const n = q.length;
  const dirs: Vec2[] = q.map((_, i) => {
    if (i === 0 && ta) return ta;
    if (i === n - 1 && tb) return tb;
    const p = q[Math.max(0, i - 1)];
    const r = q[Math.min(n - 1, i + 1)];
    return unit(r[0] - p[0], r[1] - p[1]);
  });
  const out: number[] = [a[0], a[1]];
  for (let i = 0; i + 1 < n; i++) {
    const [x0, y0] = q[i];
    const [x1, y1] = q[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 1e-6) continue;
    // For an arc turning through angle θ the ideal tangent is 2·tan(θ/4)/sin(θ/2) times the chord.
    const cosTurn = Math.max(-1, Math.min(1, dirs[i][0] * dirs[i + 1][0] + dirs[i][1] * dirs[i + 1][1]));
    const turn = Math.min(Math.acos(cosTurn), (170 * Math.PI) / 180);
    const k = turn < 1e-3 ? 1 : (2 * Math.tan(turn / 4)) / Math.sin(turn / 2);
    const m0x = dirs[i][0] * len * k, m0y = dirs[i][1] * len * k;
    const m1x = dirs[i + 1][0] * len * k, m1y = dirs[i + 1][1] * len * k;
    const steps = Math.max(2, Math.ceil(len / step));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const t2 = t * t, t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
      out.push(h00 * x0 + h10 * m0x + h01 * x1 + h11 * m1x, h00 * y0 + h10 * m0y + h01 * y1 + h11 * m1y);
    }
  }
  return dedupe(out);
}

/** Rectangle around a straight piece of track, as a closed ring of [x, y] points. */
export function boxAround(cx: number, cy: number, heading: number, length: number, width: number): Vec2[] {
  const ux = Math.cos(heading), uy = Math.sin(heading);
  const hl = length / 2, hw = width / 2;
  return [
    [cx - ux * hl - uy * hw, cy - uy * hl + ux * hw],
    [cx + ux * hl - uy * hw, cy + uy * hl + ux * hw],
    [cx + ux * hl + uy * hw, cy + uy * hl - ux * hw],
    [cx - ux * hl + uy * hw, cy - uy * hl - ux * hw],
  ];
}
