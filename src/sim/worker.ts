/// <reference lib="webworker" />
import { buildGraph, linkOffsets, metroReach, periodOf, shortestFrom, simulateDay } from "./assign";
import { Demand, accessSeconds, catchments, stationTrips, walkSeconds, willingness, type Catchments } from "./demand";
import type { DayKind, DaySpec, FromWorker, SimNetwork, ToWorker } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

let demand: Demand | null = null;
let net: SimNetwork | null = null;
let catch_: Catchments | null = null;
let reach: Float32Array | undefined;
const tripsCache = new Map<string, Float32Array[]>();
let sat = new Float32Array(0);
let removedKey = "";

function post(msg: FromWorker, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer);
}

function setNetwork(n: SimNetwork) {
  net = n;
  if (!demand) return;
  const key = `${n.removed.length}`;
  if (key !== removedKey) {
    demand.applyRemovals(n.removed);
    removedKey = key;
  }
  catch_ = catchments(demand, n);
  reach = metroReach(n, catch_);
  tripsCache.clear();
  sat = new Float32Array(n.routes.map((r) => r.satisfaction));
}

function trips(kind: DayKind, month: number): Float32Array[] {
  const key = `${kind}:${month}`;
  let t = tripsCache.get(key);
  if (!t) {
    t = stationTrips(demand!, net!, catch_!, kind, month, reach);
    tripsCache.set(key, t);
  }
  return t;
}

function travelTime(x: number, y: number, hour: number, day: DaySpec) {
  const g = demand!.grid;
  const n = net!;
  const S = n.stations.length;
  const out = new Float32Array(g.cols * g.rows);
  const atStation = new Float32Array(S).fill(Infinity);
  if (S > 0 && day.service[hour]) {
    const graph = buildGraph(n, day.kind !== "weekday", periodOf(n.periods, hour * 60 + 30), linkOffsets(n), 0);
    // Walk to every station in range of the start, then ride.
    for (let s = 0; s < S; s++) {
      const st = n.stations[s];
      const d = Math.hypot(st.x - x, st.y - y);
      if (willingness(d, n.walkRange * 1.5) <= 0) continue;
      const start = walkSeconds(d) + accessSeconds(st.level);
      const tree = shortestFrom(graph, s);
      for (let t = 0; t < S; t++) atStation[t] = Math.min(atStation[t], start + Math.min(tree.dist[t], tree.dist[S + t]) + accessSeconds(n.stations[t].level));
    }
  }
  const range = n.walkRange * 1.5;
  for (let r = 0; r < g.rows; r++) {
    const cy = g.y0 + (r + 0.5) * g.cellSize;
    for (let c = 0; c < g.cols; c++) {
      const cx = g.x0 + (c + 0.5) * g.cellSize;
      let best = walkSeconds(Math.hypot(cx - x, cy - y));
      for (let t = 0; t < S; t++) {
        if (!isFinite(atStation[t])) continue;
        const st = n.stations[t];
        const d = Math.hypot(cx - st.x, cy - st.y);
        if (d > range) continue;
        best = Math.min(best, atStation[t] + walkSeconds(d));
      }
      out[r * g.cols + c] = best / 60;
    }
  }
  return out;
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  try {
    switch (msg.type) {
      case "init":
        demand = new Demand(msg.grid);
        if (net) setNetwork(net);
        post({ type: "ready" });
        break;
      case "network":
        setNetwork(msg.network);
        break;
      case "day": {
        if (!net || !catch_ || !demand) throw new Error("day requested before the city and network arrived");
        const d = msg.day;
        const result = simulateDay(net, catch_, trips(d.kind, d.month), trips(d.previous, d.month), d, sat);
        if (msg.commit) result.routes.forEach((r, i) => (sat[i] = r.satisfaction));
        post({ type: "day", seq: msg.seq, result });
        break;
      }
      case "forecast": {
        if (!net || !catch_ || !demand) return;
        const d = msg.day;
        const n = net;
        // Where people go doesn't depend on fares, so the day's trips stand; only who rides changes.
        const priced: SimNetwork = {
          ...n,
          fares: msg.fares,
          routes: n.routes.map((r) => ({ ...r, fare: r.id in msg.routeFares ? (msg.routeFares[r.id] ?? undefined) : r.fare })),
        };
        const result = simulateDay(priced, catch_, trips(d.kind, d.month), trips(d.previous, d.month), d, sat.slice());
        post({
          type: "forecast",
          seq: msg.seq,
          trips: result.trips,
          fares: result.revenue.reduce((a, b) => a + b, 0),
          routes: result.routes.map((r) => ({ id: r.id, riders: r.boardings.reduce((a, b) => a + b, 0), fares: r.fares })),
        });
        break;
      }
      case "travelTime": {
        if (!net || !catch_ || !demand) return;
        const g = demand.grid;
        const minutes = travelTime(msg.x, msg.y, msg.hour, msg.day);
        post({ type: "travelTime", seq: msg.seq, minutes, cols: g.cols, rows: g.rows, x0: g.x0, y0: g.y0, cellSize: g.cellSize }, [minutes.buffer]);
        break;
      }
    }
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? `${err.message}\n${err.stack}` : String(err) });
  }
};
