import { sampleGrid, type City, type NamedPoint } from "../city/pack";
import type { Buildings } from "../city/buildings";
import {
  BUILD_TIME,
  COSTS,
  CORRIDOR_HALF_WIDTH,
  KIND_LEVEL_RANGE,
  MAX_GRADIENT,
  MIN_CURVE_RADIUS,
  RIVER_CLEARANCE_LEVEL,
  TUNNEL_RADIUS,
  trainType,
  type BuildKind,
  type TrackCount,
} from "./data";
import {
  closestOnPolyline,
  cumulative,
  minRadius,
  pointAt,
  polylineLength,
  reversePolyline,
  smoothPath,
  splitAt,
  type Vec2,
} from "./geometry";
import type { Depot, GameState, Route, Station, TrackEdge, TrackNode } from "./model";

/** Something the player pointed at while laying track. */
export type Target =
  | { type: "station"; station: number; x: number; y: number }
  | { type: "depot"; depot: number; x: number; y: number }
  | { type: "node"; node: number; x: number; y: number }
  | { type: "edge"; edge: number; s: number; x: number; y: number }
  | { type: "free"; x: number; y: number };

export interface TrackOptions {
  kind: BuildKind;
  tracks: TrackCount;
  level: number; // used for free ends
  bends?: Vec2[];
}

export interface TrackPreview {
  pts: number[];
  length: number;
  minRadius: number;
  cost: number;
  problems: string[];
  demolish: number[];
  days: number;
}

export interface Leg {
  edge: number;
  forward: boolean;
}

export interface RoutePath {
  legs: Leg[][]; // one list of edges per pair of consecutive stops
  ok: boolean;
  problems: string[];
}

interface Endpoint {
  x: number;
  y: number;
  level: number;
  dir?: Vec2;
  port?: boolean;
}

export const DEPOT_LENGTH = 300;
export const DEPOT_WIDTH = 80;
const MIN_CROSSING_CLEARANCE = 8; // m between track levels where lines cross without a junction
const MAX_TURN_COS = Math.cos((60 * Math.PI) / 180);
const SAMPLE = 20;

export function platformWidth(st: Station): number {
  return st.layout === "island" ? 14 : 20;
}

function unit(dx: number, dy: number): Vec2 {
  const l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
}

export class Network {
  nodes = new Map<number, TrackNode>();
  edges = new Map<number, TrackEdge>();
  stations = new Map<number, Station>();
  depots = new Map<number, Depot>();
  routes = new Map<number, Route>();
  adj = new Map<number, number[]>();
  stationByNode = new Map<number, Station>(); // centre and port nodes
  depotByNode = new Map<number, Depot>();
  private demolished = new Set<number>();

  constructor(
    public state: GameState,
    public city: City,
    public buildings: Buildings | null,
  ) {
    this.reindex();
  }

  reindex() {
    const s = this.state;
    this.nodes = new Map(s.nodes.map((n) => [n.id, n]));
    this.edges = new Map(s.edges.map((e) => [e.id, e]));
    this.stations = new Map(s.stations.map((x) => [x.id, x]));
    this.depots = new Map(s.depots.map((x) => [x.id, x]));
    this.routes = new Map(s.routes.map((x) => [x.id, x]));
    this.adj = new Map();
    for (const n of s.nodes) this.adj.set(n.id, []);
    for (const e of s.edges) {
      this.adj.get(e.a)?.push(e.id);
      this.adj.get(e.b)?.push(e.id);
    }
    this.stationByNode = new Map();
    for (const st of s.stations) for (const n of [st.node, ...st.ports]) this.stationByNode.set(n, st);
    this.depotByNode = new Map(s.depots.map((x) => [x.node, x]));
    this.demolished = new Set(s.demolished);
  }

  private id(): number {
    return this.state.nextId++;
  }

  ground(x: number, y: number): number {
    return sampleGrid(this.city.grid, this.city.grid.layers.elevation, x, y);
  }

  water(x: number, y: number): number {
    return sampleGrid(this.city.grid, this.city.grid.layers.water, x, y);
  }

  // ---- queries -------------------------------------------------------------

  edgeLength(e: TrackEdge): number {
    return polylineLength(e.pts);
  }

  /** Track level relative to the ground at distance s along the edge. */
  levelAt(e: TrackEdge, s: number): number {
    const a = this.nodes.get(e.a)!;
    const b = this.nodes.get(e.b)!;
    const len = this.edgeLength(e) || 1;
    return a.level + (b.level - a.level) * Math.min(1, Math.max(0, s / len));
  }

  edgeLevels(e: TrackEdge): number[] {
    return cumulative(e.pts).map((d) => this.levelAt(e, d));
  }

  stationPos(st: Station): Vec2 {
    return [st.x, st.y];
  }

  /** Track edges that leave a station, not counting its own platform. */
  stationLinks(st: Station): TrackEdge[] {
    const out: TrackEdge[] = [];
    for (const p of st.ports) for (const id of this.adj.get(p) ?? []) if (this.edges.get(id)!.platform === undefined) out.push(this.edges.get(id)!);
    return out;
  }

  /** What's under a point: a station, a depot, a loose track end, a piece of track, or nothing. */
  hit(x: number, y: number, tolerance: number): Target {
    for (const st of this.stations.values()) {
      if (insideBox(x, y, st.x, st.y, st.heading, st.platformLength + tolerance * 2, platformWidth(st) + tolerance * 2)) {
        return { type: "station", station: st.id, x: st.x, y: st.y };
      }
    }
    for (const d of this.depots.values()) {
      const [cx, cy] = depotCentre(d);
      if (insideBox(x, y, cx, cy, d.heading, DEPOT_LENGTH, DEPOT_WIDTH)) {
        const n = this.nodes.get(d.node)!;
        return { type: "depot", depot: d.id, x: n.x, y: n.y };
      }
    }
    let best: Target | null = null;
    let bestD = tolerance * 1.5;
    for (const n of this.nodes.values()) {
      if (this.stationByNode.has(n.id) || this.depotByNode.has(n.id)) continue;
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < bestD) {
        bestD = d;
        best = { type: "node", node: n.id, x: n.x, y: n.y };
      }
    }
    if (best) return best;
    bestD = tolerance;
    for (const e of this.edges.values()) {
      if (e.platform !== undefined) continue;
      const c = closestOnPolyline(e.pts, x, y);
      if (c.dist < bestD) {
        bestD = c.dist;
        best = { type: "edge", edge: e.id, s: c.s, x: c.x, y: c.y };
      }
    }
    return best ?? { type: "free", x, y };
  }

  // ---- stations and depots ---------------------------------------------------

  private addNode(x: number, y: number, level: number, dir?: Vec2, port?: boolean): TrackNode {
    const n: TrackNode = { id: this.id(), x, y, level };
    if (dir) n.dir = dir;
    if (port) n.port = true;
    this.state.nodes.push(n);
    this.nodes.set(n.id, n);
    this.adj.set(n.id, []);
    return n;
  }

  private addEdge(e: Omit<TrackEdge, "id" | "pts" | "status" | "daysLeft">): TrackEdge {
    const edge: TrackEdge = { ...e, id: this.id(), pts: [], status: "planned", daysLeft: 0 };
    this.state.edges.push(edge);
    this.reindex();
    this.recompute(edge);
    return edge;
  }

  placeStation(x: number, y: number, heading: number, kind: BuildKind, level: number): Station {
    const u: Vec2 = [Math.cos(heading), Math.sin(heading)];
    const half = 75;
    const centre = this.addNode(x, y, level, u);
    const back = this.addNode(x - u[0] * half, y - u[1] * half, level, [-u[0], -u[1]], true);
    const ahead = this.addNode(x + u[0] * half, y + u[1] * half, level, u, true);
    const st: Station = {
      id: this.id(),
      name: this.suggestName(x, y),
      x,
      y,
      heading,
      level,
      kind,
      node: centre.id,
      ports: [back.id, ahead.id],
      aimed: false,
      platformLength: 150,
      layout: "island",
      entrances: [],
      status: "planned",
      daysLeft: 0,
    };
    this.state.stations.push(st);
    this.addEdge({ a: back.id, b: centre.id, bends: [], kind, tracks: 2, platform: st.id });
    this.addEdge({ a: centre.id, b: ahead.id, bends: [], kind, tracks: 2, platform: st.id });
    st.entrances = this.defaultEntrances(st);
    return st;
  }

  /** Moves or turns a planned station; its connections follow. */
  poseStation(st: Station, x: number, y: number, heading: number, platformLength = st.platformLength): boolean {
    if (st.status !== "planned") return false;
    const dx = x - st.x, dy = y - st.y, dh = heading - st.heading;
    const cos = Math.cos(dh), sin = Math.sin(dh);
    st.entrances = st.entrances.map(([ex, ey]) => {
      const rx = ex - st.x, ry = ey - st.y;
      return [st.x + dx + rx * cos - ry * sin, st.y + dy + rx * sin + ry * cos];
    });
    st.x = x;
    st.y = y;
    st.heading = heading;
    st.platformLength = platformLength;
    const u: Vec2 = [Math.cos(heading), Math.sin(heading)];
    const half = platformLength / 2;
    const [back, ahead] = st.ports.map((id) => this.nodes.get(id)!);
    const centre = this.nodes.get(st.node)!;
    const backDir: Vec2 = [-u[0], -u[1]];
    Object.assign(centre, { x, y, dir: u });
    Object.assign(back, { x: x - u[0] * half, y: y - u[1] * half, dir: backDir });
    Object.assign(ahead, { x: x + u[0] * half, y: y + u[1] * half, dir: u });
    this.recomputeAround([st.node, ...st.ports]);
    return true;
  }

  setStationLevel(st: Station, kind: BuildKind, level: number) {
    st.kind = kind;
    st.level = level;
    for (const id of [st.node, ...st.ports]) this.nodes.get(id)!.level = level;
    for (const e of this.edges.values()) if (e.platform === st.id) e.kind = kind;
  }

  defaultEntrances(st: Station): Vec2[] {
    const ux = Math.cos(st.heading), uy = Math.sin(st.heading);
    const half = st.platformLength / 2 + 10;
    const off = platformWidth(st) / 2 + 12;
    return [
      [st.x + ux * half - uy * off, st.y + uy * half + ux * off],
      [st.x - ux * half + uy * off, st.y - uy * half - ux * off],
    ];
  }

  placeDepot(x: number, y: number, heading: number): Depot {
    const u: Vec2 = [Math.cos(heading), Math.sin(heading)];
    const n = this.addNode(x + (u[0] * DEPOT_LENGTH) / 2, y + (u[1] * DEPOT_LENGTH) / 2, 0, u, true);
    const d: Depot = { id: this.id(), x, y, heading, node: n.id, capacity: 200, status: "planned", daysLeft: 0 };
    this.state.depots.push(d);
    this.reindex();
    return d;
  }

  poseDepot(d: Depot, x: number, y: number, heading: number): boolean {
    if (d.status !== "planned") return false;
    const u: Vec2 = [Math.cos(heading), Math.sin(heading)];
    Object.assign(d, { x, y, heading });
    Object.assign(this.nodes.get(d.node)!, { x: x + (u[0] * DEPOT_LENGTH) / 2, y: y + (u[1] * DEPOT_LENGTH) / 2, dir: u });
    this.recomputeAround([d.node]);
    return true;
  }

  // ---- track geometry ----------------------------------------------------------

  /** Direction a train leaves a node in when heading for `toward`. */
  private departure(n: Endpoint, toward: Vec2): Vec2 | undefined {
    if (!n.dir) return undefined;
    if (n.port) return n.dir;
    const s = n.dir[0] * (toward[0] - n.x) + n.dir[1] * (toward[1] - n.y) >= 0 ? 1 : -1;
    return [n.dir[0] * s, n.dir[1] * s];
  }

  /** Direction a train is travelling in as it reaches a node coming from `from`. */
  private arrival(n: Endpoint, from: Vec2): Vec2 | undefined {
    if (!n.dir) return undefined;
    if (n.port) return [-n.dir[0], -n.dir[1]];
    const s = n.dir[0] * (n.x - from[0]) + n.dir[1] * (n.y - from[1]) >= 0 ? 1 : -1;
    return [n.dir[0] * s, n.dir[1] * s];
  }

  private curve(a: Endpoint, b: Endpoint, bends: Vec2[]): number[] {
    const first: Vec2 = bends[0] ?? [b.x, b.y];
    const last: Vec2 = bends[bends.length - 1] ?? [a.x, a.y];
    return smoothPath([a.x, a.y], this.departure(a, first) ?? null, bends, [b.x, b.y], this.arrival(b, last) ?? null);
  }

  /** Works out an edge's shape again. Built track keeps the shape it was built with. */
  recompute(e: TrackEdge) {
    const a = this.nodes.get(e.a)!;
    const b = this.nodes.get(e.b)!;
    if (e.platform !== undefined) e.pts = [a.x, a.y, b.x, b.y];
    else if (e.status === "planned" || e.pts.length < 4) e.pts = this.curve(a, b, e.bends);
  }

  private recomputeAround(nodeIds: number[]) {
    const seen = new Set<number>();
    for (const n of nodeIds) for (const id of this.adj.get(n) ?? []) if (!seen.has(id)) {
      seen.add(id);
      this.recompute(this.edges.get(id)!);
    }
  }

  insertBend(e: TrackEdge, x: number, y: number): number {
    const s = closestOnPolyline(e.pts, x, y).s;
    let i = 0;
    while (i < e.bends.length && closestOnPolyline(e.pts, e.bends[i][0], e.bends[i][1]).s < s) i++;
    e.bends.splice(i, 0, [x, y]);
    this.recompute(e);
    return i;
  }

  moveBend(e: TrackEdge, i: number, x: number, y: number) {
    e.bends[i] = [x, y];
    this.recompute(e);
  }

  removeBend(e: TrackEdge, i: number) {
    e.bends.splice(i, 1);
    this.recompute(e);
  }

  /** Splits an edge at distance s and returns the junction node in the middle. */
  splitEdge(edgeId: number, s: number): number {
    const e = this.edges.get(edgeId)!;
    const len = this.edgeLength(e);
    if (s < 1) return e.a;
    if (s > len - 1) return e.b;
    const p = pointAt(e.pts, s);
    const mid = this.addNode(p.x, p.y, this.levelAt(e, s), [p.dx, p.dy]);
    const [p1, p2] = splitAt(e.pts, s);
    const before = e.bends.filter((b) => closestOnPolyline(e.pts, b[0], b[1]).s < s);
    const after = e.bends.slice(before.length);
    const second: TrackEdge = { ...e, id: this.id(), a: mid.id, bends: after, pts: p2 };
    e.b = mid.id;
    e.bends = before;
    e.pts = p1;
    this.state.edges.push(second);
    this.reindex();
    this.recompute(e);
    this.recompute(second);
    return mid.id;
  }

  // ---- connecting ---------------------------------------------------------------

  private stationPortFacing(st: Station, toward: Vec2, heading = st.heading): 0 | 1 {
    const ux = Math.cos(heading), uy = Math.sin(heading);
    return ux * (toward[0] - st.x) + uy * (toward[1] - st.y) >= 0 ? 1 : 0;
  }

  /**
   * Heading a station would turn to when connected towards `toward`: along the line for
   * a new station, or smoothly through when it already has one connection.
   */
  private aimFor(st: Station, toward: Vec2): number {
    if (st.status !== "planned" || st.aimed) return st.heading;
    const links = this.stationLinks(st);
    if (links.length > 1) return st.heading;
    const out = unit(toward[0] - st.x, toward[1] - st.y);
    if (!links.length) return Math.atan2(out[1], out[0]);
    const e = links[0];
    const otherId = st.ports.includes(e.a) ? e.b : e.a;
    const other = this.nodes.get(otherId)!;
    const inn = unit(st.x - other.x, st.y - other.y);
    // Doubling back towards the existing connection: leave the station as it is.
    if (Math.hypot(inn[0] + out[0], inn[1] + out[1]) < 0.3) return st.heading;
    const mid = unit(inn[0] + out[0], inn[1] + out[1]);
    return Math.atan2(mid[1], mid[0]);
  }

  /** Where a connection would attach for a target, without changing anything. */
  private endpoint(t: Target, toward: Vec2, o: TrackOptions): Endpoint {
    switch (t.type) {
      case "station": {
        const st = this.stations.get(t.station)!;
        const heading = this.aimFor(st, toward);
        const side = this.stationPortFacing(st, toward, heading);
        const u: Vec2 = [Math.cos(heading), Math.sin(heading)];
        const sign = side === 1 ? 1 : -1;
        const half = st.platformLength / 2;
        return { x: st.x + u[0] * half * sign, y: st.y + u[1] * half * sign, level: st.level, dir: [u[0] * sign, u[1] * sign], port: true };
      }
      case "depot":
        return this.nodes.get(this.depots.get(t.depot)!.node)!;
      case "node":
        return this.nodes.get(t.node)!;
      case "edge": {
        const e = this.edges.get(t.edge)!;
        const p = pointAt(e.pts, t.s);
        return { x: p.x, y: p.y, level: this.levelAt(e, t.s), dir: [p.dx, p.dy] };
      }
      default:
        return { x: t.x, y: t.y, level: o.level };
    }
  }

  private attach(t: Target, toward: Vec2, o: TrackOptions): number {
    switch (t.type) {
      case "station": {
        const st = this.stations.get(t.station)!;
        const heading = this.aimFor(st, toward);
        if (heading !== st.heading) {
          this.poseStation(st, st.x, st.y, heading);
          this.keepLinksBehind(st, toward);
        }
        return st.ports[this.stationPortFacing(st, toward)];
      }
      case "depot":
        return this.depots.get(t.depot)!.node;
      case "node":
        return t.node;
      case "edge":
        return this.splitEdge(t.edge, t.s);
      default:
        return this.addNode(t.x, t.y, o.level).id;
    }
  }

  /** After turning a station, moves an existing connection off the end facing the new one. */
  private keepLinksBehind(st: Station, toward: Vec2) {
    const facing = st.ports[this.stationPortFacing(st, toward)];
    const other = st.ports[0] === facing ? st.ports[1] : st.ports[0];
    for (const e of this.stationLinks(st)) {
      if (e.a === facing) e.a = other;
      if (e.b === facing) e.b = other;
    }
    this.reindex();
    this.recomputeAround(st.ports);
  }

  /** Lays planned track between two targets. Returns the new edge. */
  connect(from: Target, to: Target, o: TrackOptions): TrackEdge | null {
    const bends = o.bends ?? [];
    const towardFrom: Vec2 = bends[0] ?? [to.x, to.y];
    const towardTo: Vec2 = bends[bends.length - 1] ?? [from.x, from.y];
    if (from.type === "station" && to.type === "station" && from.station === to.station) return null;
    // Attach the far end first so splitting an edge for one end can't shift the other.
    const b = this.attach(to, towardTo, o);
    // Splitting track for the far end may have moved the near end onto a different edge.
    const fromT = from.type === "edge" ? this.hit(from.x, from.y, 2) : from;
    const a = this.attach(fromT, towardFrom, o);
    if (a === b) return null;
    const edge = this.addEdge({ a, b, bends, kind: o.kind, tracks: o.tracks });
    if (this.edgeLength(edge) < 15) {
      this.removeEdge(edge.id);
      return null;
    }
    return edge;
  }

  /** Cost, problems and demolition for a connection, without changing the network. */
  previewConnect(from: Target, to: Target, o: TrackOptions): TrackPreview | null {
    const bends = o.bends ?? [];
    const a = this.endpoint(from, bends[0] ?? [to.x, to.y], o);
    const b = this.endpoint(to, bends[bends.length - 1] ?? [from.x, from.y], o);
    const pts = this.curve(a, b, bends);
    if (pts.length < 4) return null;
    const ignore = new Set<number>();
    for (const t of [from, to]) {
      if (t.type === "edge") ignore.add(t.edge);
      if (t.type === "station") {
        const st = this.stations.get(t.station)!;
        for (const p of [st.node, ...st.ports]) for (const id of this.adj.get(p) ?? []) ignore.add(id);
      }
      if (t.type === "depot") for (const id of this.adj.get(this.depots.get(t.depot)!.node) ?? []) ignore.add(id);
    }
    this.nodes.set(-1, { ...a, id: -1 });
    this.nodes.set(-2, { ...b, id: -2 });
    const e: TrackEdge = { id: -3, a: -1, b: -2, bends, pts, kind: o.kind, tracks: o.tracks, status: "planned", daysLeft: 0 };
    this.edges.set(e.id, e);
    try {
      const demolish = this.demolitionForEdge(e);
      return {
        pts,
        length: polylineLength(pts),
        minRadius: minRadius(pts),
        cost: this.edgeCost(e, false) + this.demolitionCost(demolish),
        problems: this.edgeProblems(e, ignore),
        demolish,
        days: this.edgeDays(e),
      };
    } finally {
      this.edges.delete(-3);
      this.nodes.delete(-1);
      this.nodes.delete(-2);
    }
  }

  // ---- removing --------------------------------------------------------------------

  removeEdge(id: number) {
    const e = this.edges.get(id);
    if (!e || e.platform !== undefined) return;
    this.state.edges = this.state.edges.filter((x) => x.id !== id);
    this.reindex();
    this.pruneNodes([e.a, e.b]);
  }

  removeStation(id: number) {
    const st = this.stations.get(id);
    if (!st) return;
    const own = new Set([st.node, ...st.ports]);
    const ends: number[] = [];
    this.state.edges = this.state.edges.filter((e) => {
      const touches = own.has(e.a) || own.has(e.b);
      if (touches) ends.push(e.a, e.b);
      return !touches;
    });
    this.state.nodes = this.state.nodes.filter((n) => !own.has(n.id));
    this.state.stations = this.state.stations.filter((x) => x.id !== id);
    for (const r of this.state.routes) r.stops = r.stops.filter((s) => s !== id);
    this.reindex();
    this.pruneNodes(ends.filter((n) => !own.has(n)));
  }

  removeDepot(id: number) {
    const d = this.depots.get(id);
    if (!d) return;
    const ends: number[] = [];
    this.state.edges = this.state.edges.filter((e) => {
      const touches = e.a === d.node || e.b === d.node;
      if (touches) ends.push(e.a, e.b);
      return !touches;
    });
    this.state.nodes = this.state.nodes.filter((n) => n.id !== d.node);
    this.state.depots = this.state.depots.filter((x) => x.id !== id);
    this.reindex();
    this.pruneNodes(ends.filter((n) => n !== d.node));
  }

  removeRoute(id: number) {
    this.state.routes = this.state.routes.filter((x) => x.id !== id);
    delete this.state.satisfaction[id];
    this.reindex();
  }

  /** Drops loose track ends and junctions that no longer have any track. */
  private pruneNodes(ids: number[]) {
    const dead = new Set(ids.filter((n) => !this.stationByNode.has(n) && !this.depotByNode.has(n) && (this.adj.get(n)?.length ?? 0) === 0));
    if (!dead.size) return;
    this.state.nodes = this.state.nodes.filter((n) => !dead.has(n.id));
    this.reindex();
  }

  // ---- names ---------------------------------------------------------------

  suggestName(x: number, y: number): string {
    const used = new Set(this.state.stations.map((s) => s.name.toLowerCase()));
    let best: NamedPoint | null = null;
    let bestScore = Infinity;
    for (const p of this.city.names) {
      if (!usableName(p) || used.has(p.n.toLowerCase())) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      const reach = p.k === "place" ? 800 : p.k === "poi" ? 300 : 400;
      if (d > reach) continue;
      // Neighbourhood names read best, then well-known landmarks, then the bigger streets.
      const bonus = p.k === "place" ? 250 + p.r * 20 : p.k === "poi" ? p.r * 25 : p.r * 15;
      const score = d - bonus;
      if (score < bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (!best) return `Station ${this.state.stations.length + 1}`;
    return best.n[0].toUpperCase() + best.n.slice(1);
  }

  // ---- routing over track ---------------------------------------------------

  private exitHeading(e: TrackEdge, forward: boolean): Vec2 {
    const pts = forward ? e.pts : reversePolyline(e.pts);
    const n = pts.length;
    return unit(pts[n - 2] - pts[n - 4], pts[n - 1] - pts[n - 3]);
  }

  private entryHeading(e: TrackEdge, forward: boolean): Vec2 {
    const pts = forward ? e.pts : reversePolyline(e.pts);
    return unit(pts[2] - pts[0], pts[3] - pts[1]);
  }

  /** Shortest track path from one node to another that never turns back on itself. */
  private findLeg(from: number, to: number, arrivingWith: Leg | null): Leg[] | null {
    type S = { key: string; leg: Leg; cost: number; prev: string | null };
    const dist = new Map<string, S>();
    const open: S[] = [];
    const push = (leg: Leg, cost: number, prev: string | null) => {
      const key = `${leg.edge}:${leg.forward ? 1 : 0}`;
      const cur = dist.get(key);
      if (cur && cur.cost <= cost) return;
      const s = { key, leg, cost, prev };
      dist.set(key, s);
      open.push(s);
    };
    const prevHeading = arrivingWith ? this.exitHeading(this.edges.get(arrivingWith.edge)!, arrivingWith.forward) : null;
    for (const eid of this.adj.get(from) ?? []) {
      const e = this.edges.get(eid)!;
      const forward = e.a === from;
      if (prevHeading) {
        const h = this.entryHeading(e, forward);
        if (h[0] * prevHeading[0] + h[1] * prevHeading[1] < MAX_TURN_COS) continue;
      }
      push({ edge: eid, forward }, this.edgeLength(e), null);
    }
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i].cost < open[bi].cost) bi = i;
      const cur = open.splice(bi, 1)[0];
      if (dist.get(cur.key) !== cur) continue;
      const e = this.edges.get(cur.leg.edge)!;
      const at = cur.leg.forward ? e.b : e.a;
      if (at === to) {
        const out: Leg[] = [];
        let k: S | undefined = cur;
        while (k) {
          out.push(k.leg);
          k = k.prev ? dist.get(k.prev) : undefined;
        }
        return out.reverse();
      }
      const h = this.exitHeading(e, cur.leg.forward);
      for (const nid of this.adj.get(at) ?? []) {
        if (nid === e.id) continue;
        const n = this.edges.get(nid)!;
        const fwd = n.a === at;
        const eh = this.entryHeading(n, fwd);
        if (eh[0] * h[0] + eh[1] * h[1] < MAX_TURN_COS) continue;
        push({ edge: nid, forward: fwd }, cur.cost + this.edgeLength(n), cur.key);
      }
    }
    return null;
  }

  routePath(r: Route): RoutePath {
    const problems: string[] = [];
    const legs: Leg[][] = [];
    let last: Leg | null = null;
    for (let i = 0; i + 1 < r.stops.length; i++) {
      const a = this.stations.get(r.stops[i]);
      const b = this.stations.get(r.stops[i + 1]);
      if (!a || !b) {
        problems.push("A stop on this route no longer exists.");
        return { legs, ok: false, problems };
      }
      const leg = this.findLeg(a.node, b.node, last);
      if (!leg) {
        problems.push(`No track from ${a.name} to ${b.name} that trains can run without reversing.`);
        return { legs, ok: false, problems };
      }
      legs.push(leg);
      last = leg[leg.length - 1];
    }
    if (r.stops.length < 2) problems.push("Add at least two stops.");
    const tt = trainType(r.trainType);
    const tightest = Math.min(Infinity, ...legs.flat().map((l) => minRadius(this.edges.get(l.edge)!.pts)));
    if (tightest < tt.minRadius) problems.push(`Curves too tight for ${tt.name} trains (${Math.round(tightest)} m, needs ${tt.minRadius} m).`);
    const trainLen = r.cars * tt.carLength;
    const shortest = Math.min(Infinity, ...r.stops.map((s) => this.stations.get(s)?.platformLength ?? Infinity));
    if (trainLen > shortest) problems.push(`Trains are ${Math.round(trainLen)} m but the shortest platform is ${shortest} m.`);
    return { legs, ok: problems.length === 0, problems };
  }

  /** Whether everything a route needs is built and a depot is reachable. */
  routeReady(r: Route, path = this.routePath(r)): string | null {
    if (!path.ok) return path.problems[0];
    for (const leg of path.legs.flat()) if (this.edges.get(leg.edge)!.status !== "built") return "Waiting for track to be built.";
    for (const s of r.stops) if (this.stations.get(s)!.status !== "built") return "Waiting for stations to be built.";
    const start = this.stations.get(r.stops[0])!.node;
    if (!this.reachesBuiltDepot(start)) return "No built depot connected to this route.";
    return null;
  }

  private reachesBuiltDepot(node: number): boolean {
    const seen = new Set([node]);
    const stack = [node];
    while (stack.length) {
      const n = stack.pop()!;
      const d = this.depotByNode.get(n);
      if (d && d.status === "built") return true;
      for (const eid of this.adj.get(n) ?? []) {
        const e = this.edges.get(eid)!;
        if (e.status !== "built") continue;
        const o = e.a === n ? e.b : e.a;
        if (!seen.has(o)) {
          seen.add(o);
          stack.push(o);
        }
      }
    }
    return false;
  }

  /** The polyline a route's trains follow between two consecutive stops. */
  legPolyline(legs: Leg[]): number[] {
    const out: number[] = [];
    for (const l of legs) {
      const e = this.edges.get(l.edge)!;
      const pts = l.forward ? e.pts : reversePolyline(e.pts);
      out.push(...(out.length ? pts.slice(2) : pts));
    }
    return out;
  }

  legLevels(legs: Leg[]): number[] {
    const out: number[] = [];
    for (const l of legs) {
      const e = this.edges.get(l.edge)!;
      const lv = this.edgeLevels(e);
      const seq = l.forward ? lv : lv.slice().reverse();
      out.push(...(out.length ? seq.slice(1) : seq));
    }
    return out;
  }

  // ---- validation ----------------------------------------------------------

  edgeProblems(e: TrackEdge, ignore?: Set<number>): string[] {
    if (e.platform !== undefined) return [];
    const out: string[] = [];
    const a = this.nodes.get(e.a)!;
    const b = this.nodes.get(e.b)!;
    const len = this.edgeLength(e);
    const deepest = Math.min(a.level, b.level);
    const highest = Math.max(a.level, b.level);
    if (e.kind === "bored" && highest > -10) {
      if (deepest > -10) out.push("Too shallow for a bored tunnel. Use cut-and-cover.");
    }
    if (e.kind === "cut" && deepest < -16) out.push("Too deep for cut-and-cover (14 m at most). Use a bored tunnel.");
    if (e.kind === "elevated" && highest < 2) out.push("Elevated track needs at least one end above ground.");
    if (e.kind !== "grade") {
      const za = this.ground(a.x, a.y) + a.level;
      const zb = this.ground(b.x, b.y) + b.level;
      const grade = Math.abs(zb - za) / Math.max(len, 1);
      if (grade > MAX_GRADIENT) out.push(`Too steep: ${(grade * 100).toFixed(1)}% (max ${MAX_GRADIENT * 100}%). Make it longer or bring the levels closer.`);
    }
    const r = minRadius(e.pts);
    if (r < MIN_CURVE_RADIUS) out.push(`Curve too tight: ${Math.round(r)} m. No train takes less than ${MIN_CURVE_RADIUS} m.`);
    if (e.kind === "bored" || e.kind === "cut") {
      for (let s = 0; s <= len; s += SAMPLE) {
        const p = pointAt(e.pts, s);
        if (this.water(p.x, p.y) < 0.5) continue;
        if (e.kind === "cut") {
          out.push("Cut-and-cover can't cross water. Use a bored tunnel or a bridge.");
          break;
        }
        if (this.levelAt(e, s) > RIVER_CLEARANCE_LEVEL) {
          out.push(`Too shallow under water (needs ${-RIVER_CLEARANCE_LEVEL} m).`);
          break;
        }
      }
    }
    for (const o of this.edges.values()) {
      if (o.id === e.id || ignore?.has(o.id) || o.a === e.a || o.a === e.b || o.b === e.a || o.b === e.b) continue;
      const hit = crossing(e.pts, o.pts);
      if (!hit) continue;
      if (Math.abs(this.levelAt(e, hit.sa) - this.levelAt(o, hit.sb)) < MIN_CROSSING_CLEARANCE) {
        out.push("Crosses other track at the same level. Go over or under it, or join it.");
        break;
      }
    }
    return out;
  }

  stationProblems(st: Station): string[] {
    const out: string[] = [];
    const [lo, hi] = KIND_LEVEL_RANGE[st.kind];
    if (st.level < lo || st.level > hi) out.push("Depth doesn't suit this station type.");
    if ((st.kind === "cut" || st.kind === "grade") && this.water(st.x, st.y) >= 0.5) out.push("This station would stand in water.");
    if (st.kind === "bored" && this.water(st.x, st.y) >= 0.5 && st.level > RIVER_CLEARANCE_LEVEL) out.push(`Too shallow under water (needs ${-RIVER_CLEARANCE_LEVEL} m).`);
    for (const o of this.stations.values()) {
      if (o.id === st.id) continue;
      const d = Math.hypot(o.x - st.x, o.y - st.y);
      if (d < (o.platformLength + st.platformLength) / 2 && Math.abs(o.level - st.level) < MIN_CROSSING_CLEARANCE) {
        if (boxesOverlap(st, o)) {
          out.push(`Overlaps ${o.name}. Move it or put it at a different depth.`);
          break;
        }
      }
    }
    return out;
  }

  // ---- demolition ----------------------------------------------------------

  demolitionForEdge(e: TrackEdge): number[] {
    if (!this.buildings || e.platform !== undefined) return [];
    const w = CORRIDOR_HALF_WIDTH[e.tracks];
    const b = this.buildings;
    if (e.kind === "bored") {
      return b.alongPolyline(e.pts, w, (i, s) => !this.demolished.has(i) && b.foundationDepth(i) >= -this.levelAt(e, s) - TUNNEL_RADIUS);
    }
    return b.alongPolyline(e.pts, w, (i) => !this.demolished.has(i));
  }

  demolitionForStation(st: Station): number[] {
    if (!this.buildings) return [];
    const ux = Math.cos(st.heading), uy = Math.sin(st.heading);
    const half = st.platformLength / 2;
    const axis = [st.x - ux * half, st.y - uy * half, st.x + ux * half, st.y + uy * half];
    const w = platformWidth(st) / 2 + 4;
    const b = this.buildings;
    if (st.kind === "bored") {
      return b.alongPolyline(axis, w, (i) => !this.demolished.has(i) && b.foundationDepth(i) >= -st.level - 6);
    }
    return b.alongPolyline(axis, w, (i) => !this.demolished.has(i));
  }

  demolitionForDepot(d: Depot): number[] {
    if (!this.buildings) return [];
    const ux = Math.cos(d.heading), uy = Math.sin(d.heading);
    const half = DEPOT_LENGTH / 2;
    return this.buildings.alongPolyline([d.x - ux * half, d.y - uy * half, d.x + ux * half, d.y + uy * half], DEPOT_WIDTH / 2, (i) => !this.demolished.has(i));
  }

  demolitionCost(ids: number[]): number {
    if (!this.buildings) return 0;
    let sum = 0;
    for (const i of ids) sum += this.buildings.floorArea(i) * COSTS.demolitionPerM2;
    return sum;
  }

  // ---- costs and build times ---------------------------------------------

  edgeCost(e: TrackEdge, includeDemolition = true): number {
    if (e.platform !== undefined) return 0;
    const len = this.edgeLength(e);
    const factor = COSTS.trackCountFactor[e.tracks];
    let cost = 0;
    for (let s = 0; s < len; s += SAMPLE) {
      const step = Math.min(SAMPLE, len - s);
      const p = pointAt(e.pts, s + step / 2);
      const overWater = (e.kind === "grade" || e.kind === "elevated") && this.water(p.x, p.y) >= 0.5;
      let rate = overWater ? COSTS.bridgePerKm : COSTS.trackPerKm[e.kind];
      if (e.kind === "bored") rate += Math.max(0, -this.levelAt(e, s) - 15) * COSTS.boredPerMetreDepth;
      cost += (rate * step * factor) / 1000;
    }
    if (includeDemolition) cost += this.demolitionCost(this.demolitionForEdge(e));
    return cost;
  }

  stationCost(st: Station, includeDemolition = true): number {
    let cost = COSTS.station[st.kind];
    if (st.kind === "bored") cost += Math.max(0, -st.level - 15) * COSTS.stationPerMetreDepth;
    cost *= st.platformLength / COSTS.stationRefLength;
    if (st.layout === "side") cost *= COSTS.stationSideFactor;
    if (includeDemolition) cost += this.demolitionCost(this.demolitionForStation(st));
    return cost;
  }

  depotCost(d: Depot, includeDemolition = true): number {
    return COSTS.depot + (includeDemolition ? this.demolitionCost(this.demolitionForDepot(d)) : 0);
  }

  edgeDays(e: TrackEdge): number {
    if (e.platform !== undefined) return 0;
    const km = this.edgeLength(e) / 1000;
    if (e.kind === "bored") return (km * 1000) / BUILD_TIME.tbmMetresPerDay;
    return km * BUILD_TIME.daysPerKm[e.kind];
  }

  stationDays(st: Station): number {
    return BUILD_TIME.station[st.kind];
  }

  plannedCost(): number {
    let sum = 0;
    for (const e of this.edges.values()) if (e.status === "planned") sum += this.edgeCost(e);
    for (const st of this.stations.values()) if (st.status === "planned") sum += this.stationCost(st);
    for (const d of this.depots.values()) if (d.status === "planned") sum += this.depotCost(d);
    return sum;
  }

  /** Everything planned that can't be built as it is. */
  plannedProblems(): string[] {
    const out: string[] = [];
    for (const e of this.edges.values()) if (e.status === "planned") out.push(...this.edgeProblems(e));
    for (const st of this.stations.values()) if (st.status === "planned") out.push(...this.stationProblems(st).map((p) => `${st.name}: ${p}`));
    return out;
  }

  /** Starts construction of everything planned. Returns the buildings knocked down. */
  buildPlanned(instant: boolean): number[] {
    const knocked = new Set<number>();
    const start = <T extends { status: string; daysLeft: number }>(x: T, days: number) => {
      x.status = instant ? "built" : "building";
      x.daysLeft = instant ? 0 : days;
    };
    for (const st of this.stations.values()) {
      if (st.status !== "planned") continue;
      for (const i of this.demolitionForStation(st)) knocked.add(i);
      start(st, this.stationDays(st));
    }
    for (const e of this.edges.values()) {
      if (e.status !== "planned") continue;
      if (e.platform !== undefined) {
        // A platform is part of its station and opens with it.
        const st = this.stations.get(e.platform)!;
        e.status = st.status;
        e.daysLeft = st.daysLeft;
        continue;
      }
      for (const i of this.demolitionForEdge(e)) knocked.add(i);
      start(e, this.edgeDays(e));
    }
    for (const d of this.depots.values()) {
      if (d.status !== "planned") continue;
      for (const i of this.demolitionForDepot(d)) knocked.add(i);
      start(d, BUILD_TIME.depot);
    }
    const list = [...knocked];
    this.state.demolished.push(...list);
    for (const i of list) this.demolished.add(i);
    return list;
  }

  isDemolished(i: number): boolean {
    return this.demolished.has(i);
  }
}

export function depotCentre(d: Depot): Vec2 {
  return [d.x, d.y];
}

function insideBox(x: number, y: number, cx: number, cy: number, heading: number, length: number, width: number): boolean {
  const ux = Math.cos(heading), uy = Math.sin(heading);
  const dx = x - cx, dy = y - cy;
  return Math.abs(dx * ux + dy * uy) <= length / 2 && Math.abs(-dx * uy + dy * ux) <= width / 2;
}

function boxesOverlap(a: Station, b: Station): boolean {
  // Sample one platform's axis against the other's box; platforms are long and thin.
  for (let k = -1; k <= 1; k += 0.25) {
    const x = a.x + Math.cos(a.heading) * (k * a.platformLength) / 2;
    const y = a.y + Math.sin(a.heading) * (k * a.platformLength) / 2;
    if (insideBox(x, y, b.x, b.y, b.heading, b.platformLength, platformWidth(b) + platformWidth(a))) return true;
  }
  return false;
}

const bboxCache = new WeakMap<number[], [number, number, number, number]>();

function bbox(pts: number[]): [number, number, number, number] {
  let b = bboxCache.get(pts);
  if (!b) {
    b = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pts.length; i += 2) {
      if (pts[i] < b[0]) b[0] = pts[i];
      if (pts[i + 1] < b[1]) b[1] = pts[i + 1];
      if (pts[i] > b[2]) b[2] = pts[i];
      if (pts[i + 1] > b[3]) b[3] = pts[i + 1];
    }
    bboxCache.set(pts, b);
  }
  return b;
}

const UNNAMEABLE = [/№/, /^проектируем/i, /^квартал/i, /^жк /i, /жилой комплекс/i, /километр/i, /^\d/];

function usableName(p: NamedPoint): boolean {
  if (p.n.length > 32) return false;
  if (p.k === "poi" && p.r < 5) return false;
  return !UNNAMEABLE.some((re) => re.test(p.n));
}

function crossing(p: number[], q: number[]): { sa: number; sb: number } | null {
  const bp = bbox(p);
  const bq = bbox(q);
  if (bp[0] > bq[2] || bq[0] > bp[2] || bp[1] > bq[3] || bq[1] > bp[3]) return null;
  // Track that only touches at its very ends (a shared station or junction) doesn't cross.
  const lenP = polylineLength(p);
  const lenQ = polylineLength(q);
  const atEnd = (s: number, len: number) => s < 0.5 || s > len - 0.5;
  let sa = 0;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i], ay = p[i + 1], bx = p[i + 2], by = p[i + 3];
    const la = Math.hypot(bx - ax, by - ay);
    let sb = 0;
    for (let j = 0; j + 3 < q.length; j += 2) {
      const cx = q[j], cy = q[j + 1], dx = q[j + 2], dy = q[j + 3];
      const lb = Math.hypot(dx - cx, dy - cy);
      const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
      if (Math.abs(den) > 1e-9) {
        const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den;
        const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
          const hit = { sa: sa + t * la, sb: sb + u * lb };
          if (!atEnd(hit.sa, lenP) && !atEnd(hit.sb, lenQ)) return hit;
        }
      }
      sb += lb;
    }
    sa += la;
  }
  return null;
}
