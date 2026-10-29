import { MIN_HEADWAY, TRANSFER_LINK_DISTANCE } from "../game/data";
import type { Catchments } from "./demand";
import { PURPOSES, curves, walkSeconds } from "./demand";
import type { DayResult, DaySpec, RouteDayStats, SimNetwork, SimStation, StationDayStats } from "./protocol";

const BOARD_PENALTY = 90; // s, how much a boarding "feels" beyond the wait
const BASE_DWELL = 25;
const PASSENGERS_PER_DOOR_SECOND = 1.2;
const MAX_WAIT = 900;
export const SECONDS_PER_FARE_UNIT = 180; // people value an hour of their time at about twenty fare units

// The other ways to make a trip: buses, trams, cars and taxis, none of which the game
// models in detail. They take a while to get going and crawl through traffic, but they
// cost the same whatever the metro charges.
const OTHER_START = 600; // s to reach a stop or the car, wait, and park at the other end
const OTHER_SPEED = 4.5; // m/s along the roads, in traffic
const ROAD_DETOUR = 1.3;
const MODE_SCALE = 700; // s; how sharply people go for the quicker way

/** Share of travellers between two places who take the metro rather than walking or going some other way. */
export function metroShare(metroSeconds: number, dist: number): number {
  const other = OTHER_START + (dist * ROAD_DETOUR) / OTHER_SPEED;
  const walk = walkSeconds(dist);
  return 1 / (1 + Math.exp((metroSeconds - other) / MODE_SCALE) + Math.exp((metroSeconds - walk) / MODE_SCALE));
}

/** Ring around the city centre, for zone fares. */
function zoneOf(net: SimNetwork, p: SimStation): number {
  return Math.floor(Math.hypot(p.x - net.centre[0], p.y - net.centre[1]) / net.fares.zoneWidth);
}

/** What boarding a route costs before distance or zone charges: its own fare, or the network's. */
export function boardingFare(net: SimNetwork, r: number): number {
  return net.routes[r].fare ?? net.fares.base;
}

/** What riding one leg adds to the fare: by its length, or by the rings it crosses. */
export function legFare(net: SimNetwork, a: SimStation | undefined, b: SimStation | undefined, length: number): number {
  const f = net.fares;
  if (f.mode === "distance") return (f.perKm * length) / 1000;
  if (f.mode === "zones" && a && b) return f.perZone * Math.abs(zoneOf(net, a) - zoneOf(net, b));
  return 0;
}

// Edge kinds in the routing graph.
const BOARD = 0;
const RIDE = 1;
const ALIGHT = 2;
const WALK = 3;

// Fares: routes on the network fare share one ticket, paid when boarding the first of them;
// a route with its own fare charges it every time someone boards. So the graph keeps each
// station twice, before and after the network fare is paid (nodes s and S + s).
interface Graph {
  n: number; // stations twice, then one node per route/direction/stop (twice for routes with their own fare)
  S: number;
  head: Int32Array;
  next: Int32Array;
  to: Int32Array;
  cost: Float32Array; // generalised seconds, fares included
  fare: Float32Array; // what the edge charges: a boarding fare, or a leg's distance or zone charge
  kind: Uint8Array;
  // For RIDE edges: index into linkFlow; for BOARD: route index; for WALK: -1.
  ref: Int32Array;
}

export interface Tree {
  dist: Float32Array; // generalised seconds to each node
  pred: Int32Array; // edge id into each node
}

/** The node a journey to station t ends at: whichever of its two copies is cheaper to reach. */
export function arrival(g: Graph, tree: Tree, t: number): number {
  return tree.dist[g.S + t] < tree.dist[t] ? g.S + t : t;
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

/** The routing graph for one period. fareWeight turns fares into seconds; 0 routes by time alone. */
export function buildGraph(net: SimNetwork, weekend: boolean, period: number, links: Int32Array, fareWeight = SECONDS_PER_FARE_UNIT): Graph {
  const S = net.stations.length;
  const index = new Map(net.stations.map((s, i) => [s.id, i]));
  let n = 2 * S;
  const edges: [number, number, number, number, number, number][] = [];
  for (let ri = 0; ri < net.routes.length; ri++) {
    const r = net.routes[ri];
    const hw = headwayAt(net, ri, weekend, period);
    if (hw <= 0 || r.stops.length < 2) continue;
    const wait = Math.min(MAX_WAIT, hw / 2);
    const m = r.stops.length;
    const own = r.fare !== undefined;
    const board = boardingFare(net, ri);
    // A network-fare route only exists after paying: boarding it from outside pays, from inside is free.
    // A route with its own fare keeps whichever side the rider was on.
    for (const layer of own ? [0, 1] : [1]) {
      for (let d = 0; d < 2; d++) {
        const first = n;
        n += m;
        for (let k = 0; k < m; k++) {
          const stopIdx = d === 0 ? k : m - 1 - k;
          const st = index.get(r.stops[stopIdx]);
          if (st === undefined) continue;
          const node = first + k;
          if (k < m - 1) {
            if (own) edges.push([layer * S + st, node, wait + BOARD_PENALTY + board * fareWeight, BOARD, ri, board]);
            else {
              edges.push([st, node, wait + BOARD_PENALTY + board * fareWeight, BOARD, ri, board]);
              edges.push([S + st, node, wait + BOARD_PENALTY, BOARD, ri, 0]);
            }
            const leg = d === 0 ? k : m - 2 - k;
            const next = index.get(r.stops[d === 0 ? stopIdx + 1 : stopIdx - 1]);
            const charge = legFare(net, net.stations[st], next === undefined ? undefined : net.stations[next], r.legLengths[leg]);
            edges.push([node, node + 1, r.runTimes[leg] + BASE_DWELL + charge * fareWeight, RIDE, links[ri] + d * (m - 1) + k, charge]);
          }
          if (k > 0) edges.push([node, layer * S + st, 0, ALIGHT, -1, 0]);
        }
      }
    }
  }
  for (let a = 0; a < S; a++) {
    for (let b = 0; b < S; b++) {
      if (a === b) continue;
      const sa = net.stations[a], sb = net.stations[b];
      const d = Math.hypot(sa.x - sb.x, sa.y - sb.y);
      if (d > TRANSFER_LINK_DISTANCE) continue;
      for (const layer of [0, 1]) edges.push([layer * S + a, layer * S + b, walkSeconds(d) + 30, WALK, -1, 0]);
    }
  }
  const E = edges.length;
  const g: Graph = {
    n,
    S,
    head: new Int32Array(n).fill(-1),
    next: new Int32Array(E),
    to: new Int32Array(E),
    cost: new Float32Array(E),
    fare: new Float32Array(E),
    kind: new Uint8Array(E),
    ref: new Int32Array(E),
  };
  edges.forEach(([from, to, cost, kind, ref, fare], i) => {
    g.to[i] = to;
    g.cost[i] = cost;
    g.fare[i] = fare;
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

export function satisfactionShare(sat: number): number {
  return 0.3 + 0.7 * sat;
}

/**
 * How well the metro links each pair of stations, as the share of people who would take it
 * at midday on a weekday, leaving fares aside: [s * S + t]. Over the years people who live
 * by the metro come to work, shop and go out along it, so this steers where trips go.
 */
export function metroReach(net: SimNetwork, c: Catchments): Float32Array {
  const S = net.stations.length;
  const out = new Float32Array(S * S);
  if (!net.routes.length) return out;
  const g = buildGraph(net, false, periodOf(net.periods, 12 * 60 + 30), linkOffsets(net), 0);
  for (let s = 0; s < S; s++) {
    const tree = shortestFrom(g, s);
    const a = net.stations[s];
    for (let t = 0; t < S; t++) {
      const time = Math.min(tree.dist[t], tree.dist[S + t]);
      if (t === s || !isFinite(time)) continue;
      const b = net.stations[t];
      out[s * S + t] = metroShare(c.access[s] + time + c.access[t], Math.hypot(a.x - b.x, a.y - b.y));
    }
  }
  return out;
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
  const routeFares = new Float64Array(R);
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
        const end = arrival(g, tree, t);
        const ride = tree.dist[end];
        if (!isFinite(ride)) continue;
        const b = net.stations[t];
        const choose = metroShare(c.access[s] + ride + c.access[t], Math.hypot(a.x - b.x, a.y - b.y));
        if (choose < 0.005) continue;
        // Trace the path once for the share (weighted by ride time) and the fare, then again to load it.
        let shareSum = 0;
        let rideSum = 0;
        let fare = 0;
        for (let v = end, e = tree.pred[v]; e >= 0; v = src[e], e = tree.pred[v]) {
          fare += g.fare[e];
          if (g.kind[e] === RIDE) {
            const r = routeOfLink(links, g.ref[e]);
            const time = g.cost[e] - g.fare[e] * SECONDS_PER_FARE_UNIT;
            shareSum += shares[r] * time;
            rideSum += time;
          }
        }
        const share = rideSum > 0 ? shareSum / rideSum : 1;
        potential += demand * choose;
        const flow = demand * choose * share;
        if (flow <= 0) continue;
        total += flow;
        hourly[h] += flow;
        revenue[h] += flow * fare;
        entries[s * 24 + h] += flow;
        exits[t * 24 + h] += flow;
        // Walking the path backwards, so the journey's first boarding comes last.
        const boardedAt: number[] = [];
        for (let v = end, e = tree.pred[v]; e >= 0; v = src[e], e = tree.pred[v]) {
          const k = g.kind[e];
          if (k === RIDE) {
            linkFlow[g.ref[e] * 24 + h] += flow;
            if (g.fare[e]) routeFares[routeOfLink(links, g.ref[e])] += flow * g.fare[e];
          } else if (k === BOARD) {
            boardings[g.ref[e] * 24 + h] += flow;
            routeFares[g.ref[e]] += flow * g.fare[e];
            boardedAt.push(src[e] % S);
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
      fares: routeFares[r],
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
