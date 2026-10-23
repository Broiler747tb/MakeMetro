import { cumulative, curveSpeed, vertexRadii } from "../game/geometry";
import type { TrainType } from "../game/data";

const DS = 10;

export interface RunProfile {
  length: number;
  time: number;
  // Samples every DS metres: time at which the train passes each one.
  t: Float32Array;
}

/** Time to run a stop-to-stop polyline, starting and ending at rest. */
export function runProfile(pts: number[], tt: TrainType): RunProfile {
  const cum = cumulative(pts);
  const length = cum[cum.length - 1];
  const radii = vertexRadii(pts);
  const n = Math.max(2, Math.ceil(length / DS) + 1);
  const limit = new Float32Array(n);
  let v = 0;
  for (let i = 0; i < n; i++) {
    const s = Math.min(length, i * DS);
    while (v + 1 < cum.length - 1 && cum[v + 1] < s) v++;
    const r = Math.min(radii[v], radii[Math.min(v + 1, radii.length - 1)]);
    limit[i] = Math.min(tt.maxSpeed, curveSpeed(r));
  }
  const speed = new Float32Array(n);
  speed[0] = 0;
  for (let i = 1; i < n; i++) speed[i] = Math.min(limit[i], Math.sqrt(speed[i - 1] ** 2 + 2 * tt.accel * DS));
  speed[n - 1] = 0;
  for (let i = n - 2; i >= 0; i--) speed[i] = Math.min(speed[i], Math.sqrt(speed[i + 1] ** 2 + 2 * tt.decel * DS));
  const t = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    const ds = Math.min(DS, length - (i - 1) * DS);
    const avg = Math.max(0.5, (speed[i - 1] + speed[i]) / 2);
    t[i] = t[i - 1] + ds / avg;
  }
  return { length, time: t[n - 1], t };
}

/** Distance along the leg after `elapsed` seconds. */
export function distanceAt(p: RunProfile, elapsed: number): number {
  const t = p.t;
  if (elapsed <= 0) return 0;
  if (elapsed >= p.time) return p.length;
  let lo = 0;
  let hi = t.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= elapsed) lo = mid;
    else hi = mid;
  }
  const f = (elapsed - t[lo]) / Math.max(1e-6, t[hi] - t[lo]);
  return Math.min(p.length, (lo + f) * DS);
}
