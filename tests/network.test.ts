import { test } from "node:test";
import assert from "node:assert/strict";
import { Network, type Target } from "../src/game/network";
import { Projection } from "../src/city/projection";
import { minRadius } from "../src/game/geometry";
import type { City, GridLayer } from "../src/city/pack";
import type { GameState, Route } from "../src/game/model";

function flatCity(): City {
  const cols = 60, rows = 60, n = cols * rows;
  const layers = Object.fromEntries(["residents", "jobs", "education", "retail", "leisure", "elevation", "water", "built"].map((k) => [k, new Float32Array(n)])) as Record<GridLayer, Float32Array>;
  return {
    id: "flat",
    baseUrl: "",
    proj: new Projection({ lon0: 0, lat0: 0, mPerDegLon: 111000, mPerDegLat: 111000 }),
    grid: { x0: -7500, y0: -7500, cellSize: 250, cols, rows, layers },
    names: [],
    manifest: { totals: { residents: 1e6, jobs: 5e5, education: 1e5, buildings: 0 } } as City["manifest"],
    store: null as unknown as City["store"],
  };
}

function emptyState(): GameState {
  return {
    format: 2, cityId: "flat", startDate: "2026-01-05", time: 0, money: 0, yearBudget: 0, loans: [],
    sandbox: { unlimitedMoney: true, instantBuild: true }, fare: 2, fares: { mode: "flat", perKm: 0, zoneWidth: 8000, perZone: 0 }, lineFares: {},
    periods: [], serviceHours: { open: 0, close: 1440 }, weekendHours: { open: 0, close: 1440 }, units: "metric", walkRange: 1000,
    nodes: [], edges: [], stations: [], depots: [], routes: [], demolished: [], tbms: 2,
    satisfaction: {}, fleet: {}, history: [], nextId: 1, gameOver: false,
  };
}

const opts = { kind: "bored" as const, tracks: 2 as const, level: -20 };
const station = (net: Network, id: number): Target => {
  const st = net.stations.get(id)!;
  return { type: "station", station: id, x: st.x, y: st.y };
};
const route = (stops: number[]): Route => ({ id: 1, number: 1, name: "", autoName: false, color: "", stops, trainType: "standard", cars: 6, headways: { weekday: [], weekend: [] } });

test("a station is a straight platform with a port at each end", () => {
  const net = new Network(emptyState(), flatCity(), null);
  const st = net.placeStation(0, 0, 0, "bored", -20);
  const [back, ahead] = st.ports.map((p) => net.nodes.get(p)!);
  assert.deepEqual([back.x, ahead.x], [-75, 75]);
  assert.equal(net.edges.size, 2);
  net.poseStation(st, 100, 0, Math.PI / 2, 200);
  const [b2, a2] = st.ports.map((p) => net.nodes.get(p)!);
  assert.ok(Math.abs(b2.x - 100) < 1e-9 && Math.abs(b2.y + 100) < 1e-9);
  assert.ok(Math.abs(a2.y - 100) < 1e-9);
});

test("connecting stations leaves each platform straight and curves in between", () => {
  const net = new Network(emptyState(), flatCity(), null);
  const a = net.placeStation(0, 0, 0, "bored", -20);
  const b = net.placeStation(1500, 1500, Math.PI / 2, "bored", -20);
  a.aimed = b.aimed = true;
  const e = net.connect(station(net, a.id), station(net, b.id), opts)!;
  assert.ok(e);
  // Leaves A's east end heading east, arrives at B's south end heading north.
  assert.equal(e.a, a.ports[1]);
  assert.equal(e.b, b.ports[0]);
  const p = e.pts;
  assert.ok(Math.abs(p[3] - p[1]) < 1, "leaves A straight along the platform");
  assert.ok(Math.abs(p[p.length - 2] - p[p.length - 4]) < 1, "arrives at B straight along the platform");
  assert.ok(minRadius(p) > 400, `smooth curve, radius ${minRadius(p)}`);
});

test("a chain of three lines up the middle station and runs through it", () => {
  const net = new Network(emptyState(), flatCity(), null);
  const a = net.placeStation(0, 0, 0, "bored", -20);
  const b = net.placeStation(1500, 300, 0, "bored", -20);
  const c = net.placeStation(3000, 0, 0, "bored", -20);
  net.connect(station(net, a.id), station(net, b.id), opts);
  net.connect(station(net, b.id), station(net, c.id), opts);
  const path = net.routePath(route([a.id, b.id, c.id]));
  assert.ok(path.ok, path.problems.join("; "));
});

test("trains don't reverse at a station to reach a line behind them", () => {
  const net = new Network(emptyState(), flatCity(), null);
  const a = net.placeStation(0, 0, 0, "bored", -20);
  const b = net.placeStation(1500, 0, 0, "bored", -20);
  const c = net.placeStation(0, 1200, 0, "bored", -20);
  for (const s of [a, b, c]) s.aimed = true;
  net.connect(station(net, a.id), station(net, b.id), opts);
  // C hangs off B's west end, the same end A arrives at.
  net.connect(station(net, b.id), station(net, c.id), opts);
  assert.ok(!net.routePath(route([a.id, b.id, c.id])).ok);
});

test("a branch off existing track makes a junction trains can take one way", () => {
  const net = new Network(emptyState(), flatCity(), null);
  const a = net.placeStation(0, 0, 0, "bored", -20);
  const b = net.placeStation(3000, 0, 0, "bored", -20);
  const c = net.placeStation(3000, 1500, 0, "bored", -20);
  for (const s of [a, b, c]) s.aimed = true;
  const main = net.connect(station(net, a.id), station(net, b.id), opts)!;
  const mid = main.pts.length / 2;
  const at: Target = { type: "edge", edge: main.id, s: 1400, x: main.pts[mid - (mid % 2)], y: main.pts[mid - (mid % 2) + 1] };
  const hit = net.hit(at.x, at.y, 5);
  assert.equal(hit.type, "edge");
  net.connect(hit, station(net, c.id), opts);
  assert.ok(net.routePath(route([a.id, c.id])).ok, "A to C through the junction");
  assert.ok(!net.routePath(route([b.id, c.id])).ok, "B to C would mean reversing at the junction");
});

test("bend points reshape planned track and can be removed", () => {
  const net = new Network(emptyState(), flatCity(), null);
  const a = net.placeStation(0, 0, 0, "bored", -20);
  const b = net.placeStation(2000, 0, 0, "bored", -20);
  const e = net.connect(station(net, a.id), station(net, b.id), opts)!;
  const straight = e.pts.slice();
  const i = net.insertBend(e, 1000, 0);
  net.moveBend(e, i, 1000, 300);
  assert.ok(Math.max(...e.pts.filter((_, k) => k % 2 === 1)) > 250, "pulled north");
  net.removeBend(e, 0);
  assert.equal(e.pts.length, straight.length);
});

test("track crossing at the same level is flagged, and passes with enough height between", () => {
  const net = new Network(emptyState(), flatCity(), null);
  const a = net.placeStation(-2000, 0, 0, "bored", -20);
  const b = net.placeStation(2000, 0, 0, "bored", -20);
  const c = net.placeStation(0, -2000, Math.PI / 2, "bored", -20);
  const d = net.placeStation(0, 2000, Math.PI / 2, "bored", -20);
  for (const s of [a, b, c, d]) s.aimed = true;
  net.connect(station(net, a.id), station(net, b.id), opts);
  const cross = net.connect(station(net, c.id), station(net, d.id), opts)!;
  assert.ok(net.edgeProblems(cross).some((p) => p.includes("same level")));
  net.setStationLevel(c, "bored", -45);
  net.setStationLevel(d, "bored", -45);
  assert.ok(!net.edgeProblems(cross).some((p) => p.includes("same level")));
});

test("removing a station takes its track with it", () => {
  const net = new Network(emptyState(), flatCity(), null);
  const a = net.placeStation(0, 0, 0, "bored", -20);
  const b = net.placeStation(1500, 0, 0, "bored", -20);
  net.connect(station(net, a.id), station(net, b.id), opts);
  net.removeStation(b.id);
  assert.equal(net.edges.size, 2, "only A's own platform track is left");
  assert.equal(net.nodes.size, 3);
});

test("a depot links to a station and a route can reach it", () => {
  const state = emptyState();
  const net = new Network(state, flatCity(), null);
  const a = net.placeStation(0, 0, 0, "bored", -20);
  const b = net.placeStation(1500, 0, 0, "bored", -20);
  net.connect(station(net, a.id), station(net, b.id), opts);
  const d = net.placeDepot(-900, 0, 0);
  net.setStationLevel(a, "cut", -6);
  net.connect({ type: "depot", depot: d.id, x: 0, y: 0 }, station(net, a.id), { kind: "cut", tracks: 2, level: 0 });
  net.buildPlanned(true);
  assert.equal(net.routeReady(route([a.id, b.id])), null);
});
