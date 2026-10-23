import { MIN_HEADWAY, TRANSFER_LINK_DISTANCE } from "../game/data";
import type { Catchments } from "./demand";
import { PURPOSES, curves, walkSeconds } from "./demand";
import type { DayResult, DaySpec, RouteDayStats, SimNetwork, StationDayStats } from "./protocol";

const BOARD_PENALTY = 90; // s, how much a boarding "feels" beyond the wait
const BASE_DWELL = 25;
const PASSENGERS_PER_DOOR_SECOND = 1.2;
const MAX_WAIT = 900;
const SECONDS_PER_FARE_UNIT = 180; // people value an hour of their time at about twenty fare units

export function fareBetween(net: SimNetwork, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const f = net.fares;
  if (f.mode === "distance") return f.base + (f.perKm * Math.hypot(a.x - b.x, a.y - b.y)) / 1000;
  if (f.mode === "zones") {
    const za = Math.floor(Math.hypot(a.x, a.y) / f.zoneWidth);
    const zb = Math.floor(Math.hypot(b.x, b.y) / f.zoneWidth);
    return f.base + f.perZone * Math.abs(za - zb);
  }
  return f.base;
}

// Edge kinds in the routing graph.
const BOARD = 0;
const RIDE = 1;
const ALIGHT = 2;
const WALK = 3;

interface Graph {
  n: number; // station nodes first, then one node per route/direction/stop
  head: Int32Array;
  next: Int32Array;
  to: Int32Array;
  cost: Float32Array;
  kind: Uint8Array;
  // For RIDE edges: index into linkFlow; for BOARD: route index; for WALK: -1.
  ref: Int32Array;
  rsBase: Int32Array[]; // [route][dir] -> first node id
}

export interface Tree {
  dist: Float32Array; // generalised seconds to each station
  pred: Int32Array; // edge id into each node
}

function hourMinute(h: number): number {
  return h * 60 + 30;
}

export function periodOf(periods: number[], minute: number): number {
  let p = periods.length - 1;
  for (let i = 0; i < periods.length; i++) if (periods[i] <= minute) p = i;
  return p;
}

export function headwayAt(net: SimNetwork, r: number, weekend: boolean, period: number): number {
  const h = (weekend ? net.routes[r].headways.weekend : net.routes[r].headways.weekday)[period] ?? 0;
  return h > 0 ? Math.max(MIN_HEADWAY, h) : 0;
}

/** Link index for route r, direction d, link k (stop k to k+1 in that direction). */
export function linkOffsets(net: SimNetwork): Int32Array {
  const off = new Int32Array(net.routes.length + 1);
  for (let r = 0; r < net.routes.length; r++) off[r + 1] = off[r] + 2 * Math.max(0, net.routes[r].stops.length - 1);
  return off;
}

export function buildGraph(net: SimNetwork, weekend: boolean, period: number, links: Int32Array): Graph {
  const S = net.stations.length;
  const index = new Map(net.stations.map((s, i) => [s.id, i]));
  let n = S;
  const rsBase: Int32Array[] = [];
  for (const r of net.routes) {
    const base = new Int32Array(2);
    base[0] = n;
    n += r.stops.length;
    base[1] = n;
    n += r.stops.length;
    rsBase.push(base);
  }
  const edges: [number, number, number, number, number][] = [];
  for (let ri = 0; ri < net.routes.length; ri++) {
    const r = net.routes[ri];
    const hw = headwayAt(net, ri, weekend, period);
    if (hw <= 0 || r.stops.length < 2) continue;
    const wait = Math.min(MAX_WAIT, hw / 2);
    const m = r.stops.length;
    for (let d = 0; d < 2; d++) {
      for (let k = 0; k < m; k++) {
        const stopIdx = d === 0 ? k : m - 1 - k;
        const st = index.get(r.stops[stopIdx]);
        if (st === undefined) continue;
        const node = rsBase[ri][d] + k;
        if (k < m - 1) {
          edges.push([st, node, wait + BOARD_PENALTY, BOARD, ri]);
          const leg = d === 0 ? k : m - 2 - k;
          edges.push([node, node + 1, r.runTimes[leg] + BASE_DWELL, RIDE, links[ri] + d * (m - 1) + k]);
        }
        if (k > 0) edges.push([node, st, 0, ALIGHT, -1]);
      }
    }
  }
  for (let a = 0; a < S; a++) {
    for (let b = 0; b < S; b++) {
      if (a === b) continue;
      const sa = net.stations[a], sb = net.stations[b];
      const d = Math.hypot(sa.x - sb.x, sa.y - sb.y);
      if (d <= TRANSFER_LINK_DISTANCE) edges.push([a, b, walkSeconds(d) + 30, WALK, -1]);
    }
  }
  const E = edges.length;
  const g: Graph = {
    n,
    head: new Int32Array(n).fill(-1),
    next: new Int32Array(E),
    to: new Int32Array(E),
    cost: new Float32Array(E),
    kind: new Uint8Array(E),
    ref: new Int32Array(E),
    rsBase,
  };
  edges.forEach(([from, to, cost, kind, ref], i) => {
    g.to[i] = to;
    g.cost[i] = cost;
    g.kind[i] = kind;
    g.ref[i] = ref;
    g.next[i] = g.head[from];
    g.head[from] = i;
  });
  return g;
}

// Edge sources aren't stored, so keep them alongside for path tracing.
export function edgeSources(g: Graph): Int32Array {
  const src = new Int32Array(g.to.length);
  for (let v = 0; v < g.n; v++) for (let e = g.head[v]; e >= 0; e = g.next[e]) src[e] = v;
  return src;
}

class Heap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.ids.length;
  }
  push(id: number, key: number) {
    const ids = this.ids, keys = this.keys;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p];
      keys[i] = keys[p];
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }
  pop(): number {
    const ids = this.ids, keys = this.keys;
    const top = ids[0];
    const lastId = ids.pop()!;
    const lastKey = keys.pop()!;
    if (ids.length) {
      let i = 0;
      const n = ids.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= lastKey) break;
        ids[i] = ids[c];
        keys[i] = keys[c];
        i = c;
      }
      ids[i] = lastId;
      keys[i] = lastKey;
    }
    return top;
  }
}

export function shortestFrom(g: Graph, source: number): Tree {
  const dist = new Float32Array(g.n).fill(Infinity);
  const pred = new Int32Array(g.n).fill(-1);
  const heap = new Heap();
  dist[source] = 0;
  heap.push(source, 0);
  while (heap.size) {
    const v = heap.pop();
    const dv = dist[v];
    for (let e = g.head[v]; e >= 0; e = g.next[e]) {
      const w = g.to[e];
      const nd = dv + g.cost[e];
      if (nd < dist[w]) {
        dist[w] = nd;
        pred[w] = e;
        heap.push(w, nd);
      }
    }
  }
  return { dist, pred };
}

export interface RouteState {
  satisfaction: Float32Array;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function satisfactionShare(sat: number): number {
  return 0.3 + 0.7 * sat;
}

/**
 * One simulated day: route every station pair through the network for each hour,
 * load the trains, and work out how happy people are with each route.
 */
export function simulateDay(
  net: SimNetwork,
  c: Catchments,
  trips: Float32Array[],
  yesterday: Float32Array[] | null,
  day: DaySpec,
  sat: Float32Array,
): DayResult {
  const weekend = day.kind !== "weekday";
  const t0 = performance.now();
  const S = net.stations.length;
  const R = net.routes.length;
  const links = linkOffsets(net);
  const L = links[R];
  const linkFlow = new Float32Array(L * 24);
  const boardings = new Float32Array(R * 24);
  const entries = new Float32Array(S * 24);
  const exits = new Float32Array(S * 24);
  const stopActivity = new Float32Array(L * 24); // boardings + alightings at the start of each link
  const transfers = new Float32Array(S);
  const hourly = new Float32Array(24);
  const revenue = new Float32Array(24);
  let total = 0;
  let potential = 0;
  const prof = curves(day.kind);
  const prevProf = curves(day.previous);
  // A round trip only happens by metro if both legs can: scale each leg by how much of
  // the other one falls inside service hours (tonight's late trains count for going home).
  const within = (cv: { today: Float32Array; after: Float32Array }) => {
    let v = 0;
    for (let h = 0; h < 24; h++) v += cv.today[h] * day.service[h] + cv.after[h] * (day.tonight[h] ?? 0);
    return v;
  };
  const outOk = prof.map((x) => within(x.ret));
  const retOk = prof.map((x) => within(x.out));

  const cache = new Map<number, { g: Graph; src: Int32Array; trees: Tree[] }>();
  const graphFor = (period: number) => {
    let entry = cache.get(period);
    if (!entry) {
      const g = buildGraph(net, weekend, period, links);
      const trees: Tree[] = [];
      for (let s = 0; s < S; s++) trees.push(shortestFrom(g, s));
      entry = { g, src: edgeSources(g), trees };
      cache.set(period, entry);
    }
    return entry;
  };

  const shares = new Float32Array(R);
  for (let r = 0; r < R; r++) shares[r] = satisfactionShare(sat[r]);

  for (let h = 0; h < 24; h++) {
    const minute = hourMinute(h);
    if (!day.service[h]) continue;
    const period = periodOf(net.periods, minute);
    const { g, src, trees } = graphFor(period);
    for (let s = 0; s < S; s++) {
      const tree = trees[s];
      const a = net.stations[s];
      for (let t = 0; t < S; t++) {
        if (t === s) continue;
        let demand = 0;
        for (let p = 0; p < PURPOSES.length; p++) {
          demand += trips[p][s * S + t] * prof[p].out.today[h] * outOk[p] + trips[p][t * S + s] * prof[p].ret.today[h] * retOk[p];
          // Last night's outings coming home after midnight.
          if (yesterday) demand += yesterday[p][t * S + s] * prevProf[p].ret.after[h];
        }
        if (demand < 1e-3) continue;
        const ride = tree.dist[t];
        if (!isFinite(ride)) continue;
        const b = net.stations[t];
        const fare = fareBetween(net, a, net.stations[t]);
        const metro = c.access[s] + ride + c.access[t] + fare * SECONDS_PER_FARE_UNIT;
        const walk = walkSeconds(Math.hypot(a.x - b.x, a.y - b.y));
        const faster = sigmoid((walk - metro) / 120);
        if (faster < 0.01) continue;
        // Trace the path once for the share (weighted by ride time), then again to load it.
        let shareSum = 0;
        let rideSum = 0;
        for (let v = t, e = tree.pred[v]; e >= 0; v = src[e], e = tree.pred[v]) {
          if (g.kind[e] === RIDE) {
            const r = routeOfLink(links, g.ref[e]);
            shareSum += shares[r] * g.cost[e];
            rideSum += g.cost[e];
          }
        }
        const share = rideSum > 0 ? shareSum / rideSum : 1;
        potential += demand * faster;
        const flow = demand * faster * share;
        if (flow <= 0) continue;
        total += flow;
        hourly[h] += flow;
        revenue[h] += flow * fare;
        entries[s * 24 + h] += flow;
        exits[t * 24 + h] += flow;
        // Walking the path backwards, so the journey's first boarding comes last.
        const boardedAt: number[] = [];
        for (let v = t, e = tree.pred[v]; e >= 0; v = src[e], e = tree.pred[v]) {
          const k = g.kind[e];
          if (k === RIDE) {
            linkFlow[g.ref[e] * 24 + h] += flow;
          } else if (k === BOARD) {
            boardings[g.ref[e] * 24 + h] += flow;
            boardedAt.push(src[e]);
            // The next ride edge starts at this boarding node; count the boarding there.
            const node = g.to[e];
            for (let x = g.head[node]; x >= 0; x = g.next[x]) {
              if (g.kind[x] === RIDE) stopActivity[g.ref[x] * 24 + h] += flow;
            }
          } else if (k === ALIGHT) {
            // Alighting at the end of the previous ride link.
            const node = src[e];
            const prevRide = tree.pred[node];
            if (prevRide >= 0 && g.kind[prevRide] === RIDE) stopActivity[g.ref[prevRide] * 24 + h] += flow;
          }
        }
        for (let i = 0; i < boardedAt.length - 1; i++) transfers[boardedAt[i]] += flow;
      }
    }
  }

  const routes: RouteDayStats[] = [];
  for (let r = 0; r < R; r++) {
    const route = net.routes[r];
    const m = route.stops.length;
    const maxLoad = new Float32Array(24);
    let leftBehind = 0;
    let peakLoad = 0;
    let waitSum = 0;
    let waitHours = 0;
    const dwell = new Float32Array(Math.max(0, 2 * m));
    for (let h = 0; h < 24; h++) {
      const minute = hourMinute(h);
      if (!day.service[h]) continue;
      const hw = headwayAt(net, r, weekend, periodOf(net.periods, minute));
      if (hw <= 0) continue;
      const tph = 3600 / hw;
      waitSum += hw / 2;
      waitHours++;
      for (let k = links[r]; k < links[r + 1]; k++) {
        const f = linkFlow[k * 24 + h];
        const lf = f / (tph * route.capacity);
        if (lf > maxLoad[h]) maxLoad[h] = lf;
        leftBehind += Math.max(0, f - tph * route.crush);
        const perTrain = stopActivity[k * 24 + h] / tph;
        const dw = Math.min(90, BASE_DWELL + perTrain / Math.max(1, route.doors) / PASSENGERS_PER_DOOR_SECOND);
        const local = k - links[r];
        if (dw > dwell[local]) dwell[local] = dw;
      }
      if (maxLoad[h] > peakLoad) peakLoad = maxLoad[h];
    }
    const totalRun = route.runTimes.reduce((a, b) => a + b, 0) + BASE_DWELL * Math.max(0, m - 2);
    const totalLen = route.legLengths.reduce((a, b) => a + b, 0);
    const avgSpeed = totalRun > 0 ? (totalLen / totalRun) * 3.6 : 0;
    const crowd = Math.min(1, Math.max(0, 1 - (peakLoad - 0.8) / 0.7));
    const avgWait = waitHours ? waitSum / waitHours : MAX_WAIT;
    const waitScore = Math.min(1, Math.max(0, 1 - (avgWait - 60) / 300));
    const speedScore = Math.min(1, Math.max(0, (avgSpeed - 15) / 20));
    const target = waitHours ? 0.5 * crowd + 0.3 * waitScore + 0.2 * speedScore : sat[r];
    const next = sat[r] + 0.3 * (target - sat[r]);
    const flows = linkFlow.subarray(links[r] * 24, links[r + 1] * 24).slice();
    routes.push({
      id: route.id,
      boardings: boardings.slice(r * 24, r * 24 + 24),
      maxLoad,
      leftBehind,
      satisfaction: next,
      avgSpeed,
      linkFlow: flows,
      dwell,
    });
  }

  const stations: StationDayStats[] = net.stations.map((st, s) => ({
    id: st.id,
    entries: entries.slice(s * 24, s * 24 + 24),
    exits: exits.slice(s * 24, s * 24 + 24),
    transfers: transfers[s],
  }));

  return { kind: day.kind, trips: total, potential, hourly, revenue, routes, stations, computeMs: performance.now() - t0 };
}

function routeOfLink(links: Int32Array, link: number): number {
  let lo = 0;
  let hi = links.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (links[mid] <= link) lo = mid;
    else hi = mid;
  }
  return lo;
}
