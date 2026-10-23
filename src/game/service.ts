import { cumulative } from "./geometry";
import { trainType, type TrainType } from "./data";
import type { Network } from "./network";
import type { Route } from "./model";
import { runProfile, distanceAt, type RunProfile } from "../sim/profile";

export interface CompiledLeg {
  pts: number[];
  levels: number[];
  cum: number[];
  profile: RunProfile;
}

/** Everything needed to run trains on a route, in both directions. */
export interface CompiledRoute {
  route: Route;
  tt: TrainType;
  legs: [CompiledLeg[], CompiledLeg[]]; // direction 0 runs stops in order, 1 in reverse
  runTimes: number[]; // per leg, direction 0
  lengths: number[];
  dwell: [number[], number[]]; // seconds at each stop, by direction
  cycle: number; // seconds for a full round trip including turnbacks
}

export const TURNBACK = 120;
const DEFAULT_DWELL = 30;

function reverseFlat(pts: number[]): number[] {
  const out: number[] = [];
  for (let i = pts.length - 2; i >= 0; i -= 2) out.push(pts[i], pts[i + 1]);
  return out;
}

export function compileRoute(net: Network, r: Route): CompiledRoute | null {
  const path = net.routePath(r);
  if (net.routeReady(r, path)) return null;
  const tt = trainType(r.trainType);
  const fwd: CompiledLeg[] = path.legs.map((legs) => {
    const pts = net.legPolyline(legs);
    return { pts, levels: net.legLevels(legs), cum: cumulative(pts), profile: runProfile(pts, tt) };
  });
  const back: CompiledLeg[] = fwd
    .slice()
    .reverse()
    .map((l) => {
      const pts = reverseFlat(l.pts);
      return { pts, levels: l.levels.slice().reverse(), cum: cumulative(pts), profile: l.profile };
    });
  const runTimes = fwd.map((l) => l.profile.time);
  const lengths = fwd.map((l) => l.profile.length);
  const stops = r.stops.length;
  const dwell: [number[], number[]] = [new Array(stops).fill(DEFAULT_DWELL), new Array(stops).fill(DEFAULT_DWELL)];
  const oneWay = runTimes.reduce((a, b) => a + b, 0) + DEFAULT_DWELL * Math.max(0, stops - 2);
  return { route: r, tt, legs: [fwd, back], runTimes, lengths, dwell, cycle: 2 * oneWay + 2 * TURNBACK };
}

export interface Trip {
  route: number;
  dir: 0 | 1;
  start: number; // game seconds at departure from the first stop
  // Departure time from each stop, relative to start; the last entry is the arrival.
  departs: Float64Array;
  arrives: Float64Array;
}

export function makeTrip(c: CompiledRoute, dir: 0 | 1, start: number): Trip {
  const legs = c.legs[dir];
  const n = legs.length + 1;
  const departs = new Float64Array(n);
  const arrives = new Float64Array(n);
  let t = 0;
  for (let i = 0; i < n; i++) {
    arrives[i] = t;
    if (i > 0 && i < n - 1) t += c.dwell[dir][i];
    departs[i] = t;
    if (i < legs.length) t += legs[i].profile.time;
  }
  return { route: c.route.id, dir, start, departs, arrives };
}

export function tripEnd(t: Trip): number {
  return t.start + t.arrives[t.arrives.length - 1];
}

export interface TrainPose {
  leg: CompiledLeg;
  s: number; // distance of the head along the leg
  moving: boolean;
}

export function tripPose(c: CompiledRoute, trip: Trip, now: number): TrainPose | null {
  const local = now - trip.start;
  const legs = c.legs[trip.dir];
  if (local < 0 || local > trip.arrives[trip.arrives.length - 1]) return null;
  for (let i = 0; i < legs.length; i++) {
    if (local < trip.departs[i]) return { leg: legs[Math.max(0, i - 1)], s: i === 0 ? 0 : legs[i - 1].profile.length, moving: false };
    if (local <= trip.arrives[i + 1]) {
      return { leg: legs[i], s: distanceAt(legs[i].profile, local - trip.departs[i]), moving: true };
    }
  }
  const last = legs[legs.length - 1];
  return { leg: last, s: last.profile.length, moving: false };
}

/** Position, heading and level at distance s along a compiled leg. */
export function legPoint(leg: CompiledLeg, s: number): { x: number; y: number; dx: number; dy: number; level: number } {
  const cum = leg.cum;
  const pts = leg.pts;
  let lo = 0;
  let hi = cum.length - 1;
  if (s >= cum[hi]) lo = hi - 1;
  else {
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid;
    }
  }
  const i = Math.max(0, Math.min(lo, cum.length - 2));
  const segLen = cum[i + 1] - cum[i] || 1;
  // Past either end, carry straight on: at a terminus the train runs on along the platform.
  const t = (s - cum[i]) / segLen;
  const ax = pts[2 * i], ay = pts[2 * i + 1], bx = pts[2 * i + 2], by = pts[2 * i + 3];
  return {
    x: ax + (bx - ax) * t,
    y: ay + (by - ay) * t,
    dx: (bx - ax) / segLen,
    dy: (by - ay) / segLen,
    level: leg.levels[i] + (leg.levels[i + 1] - leg.levels[i]) * Math.min(1, Math.max(0, t)),
  };
}

/** Trains needed to keep a headway, given the round-trip time. */
export function trainsFor(c: CompiledRoute, headway: number): number {
  return headway > 0 ? Math.ceil(c.cycle / headway) : 0;
}
