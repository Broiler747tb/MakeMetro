import { test } from "node:test";
import assert from "node:assert/strict";
import { Demand, PURPOSES, catchments, stationTrips } from "../src/sim/demand";
import { simulateDay } from "../src/sim/assign";
import { DISTRICTS } from "../src/sim/districts";
import type { DayKind, DaySpec, GridData, SimNetwork } from "../src/sim/protocol";

// A round city: offices and nightlife in the middle, a factory belt to the east,
// homes in a ring around them and a forest park beyond.
function city(): GridData {
  const cols = 80, rows = 80, cell = 250;
  const n = cols * rows;
  const z = () => new Float32Array(n);
  const g: GridData = { x0: -10000, y0: -10000, cellSize: cell, cols, rows, centre: [0, 0], residents: z(), jobs: z(), jobsIndustry: z(), education: z(), retail: z(), nature: z(), nightlife: z() };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = g.x0 + (c + 0.5) * cell, y = g.y0 + (r + 0.5) * cell;
      const d = Math.hypot(x, y);
      const i = r * cols + c;
      const factory = Math.hypot(x - 6000, y) < 1500 ? 2500 : 0;
      g.residents[i] = factory ? 50 : 1200 * Math.exp(-((d - 5000) ** 2) / (2 * 2000 ** 2));
      g.jobsIndustry[i] = factory;
      g.jobs[i] = 5000 * Math.exp(-(d ** 2) / (2 * 2000 ** 2)) + factory;
      g.education[i] = g.residents[i] * 0.2;
      g.retail[i] = g.jobs[i] * 0.3;
      g.nightlife[i] = 3000 * Math.exp(-(d ** 2) / (2 * 1200 ** 2));
      g.nature[i] = d > 8000 ? 400 : 0;
    }
  }
  return g;
}

function line(headway: number, capacity = 1300): SimNetwork {
  const stations = [];
  for (let k = -8; k <= 8; k++) stations.push({ id: k + 100, x: k * 1000, y: 0, level: -20, entrances: [] as [number, number][] });
  const stops = stations.map((s) => s.id);
  return {
    stations,
    routes: [{ id: 1, stops, runTimes: stops.slice(1).map(() => 90), legLengths: stops.slice(1).map(() => 1000), capacity, crush: capacity * 1.5, doors: 24, headways: { weekday: new Array(6).fill(headway), weekend: new Array(6).fill(headway) }, satisfaction: 0.7 }],
    periods: [330, 420, 600, 960, 1170, 1320],
    walkRange: 1000,
    fares: { mode: "flat", base: 2, perKm: 0, zoneWidth: 8000, perZone: 0 },
    removed: [],
  };
}

function spec(kind: DayKind, previous: DayKind, open = 330, close = 1500, month = 6): DaySpec {
  const service: number[] = [];
  const tonight: number[] = [];
  for (let h = 0; h < 24; h++) {
    const m = h * 60 + 30;
    service.push((m >= open && m < close) || m + 1440 < close ? 1 : 0);
    tonight.push(close > 1440 + m ? 1 : 0);
  }
  return { kind, previous, month, service, tonight };
}

const demand = new Demand(city());

function day(net: SimNetwork, d: DaySpec) {
  const c = catchments(demand, net);
  return simulateDay(net, c, stationTrips(demand, net, c, d.kind, d.month), stationTrips(demand, net, c, d.previous, d.month), d, new Float32Array([0.7]));
}

test("a weekday line carries riders, peaking at rush hour", () => {
  const r = day(line(180), spec("weekday", "weekday"));
  assert.ok(r.trips > 10000, `trips ${r.trips}`);
  const peak = r.hourly.indexOf(Math.max(...r.hourly));
  assert.ok((peak >= 6 && peak <= 9) || (peak >= 16 && peak <= 19), `peak hour ${peak}`);
  assert.ok(r.trips <= r.potential);
});

test("nobody rides while the metro is closed", () => {
  const r = day(line(180), spec("weekday", "weekday"));
  for (const h of [2, 3, 4]) assert.equal(r.hourly[h], 0);
});

test("tiny trains get crowded and leave people behind", () => {
  const roomy = day(line(180), spec("weekday", "weekday")).routes[0];
  const packed = day(line(900, 80), spec("weekday", "weekday")).routes[0];
  assert.ok(Math.max(...packed.maxLoad) > Math.max(...roomy.maxLoad));
  assert.ok(packed.leftBehind > 0);
  assert.ok(packed.satisfaction < roomy.satisfaction);
});

test("factories draw their workers from sleeper districts", () => {
  const ind = PURPOSES.indexOf("industry");
  const office = PURPOSES.indexOf("office");
  const sleeper = demand.districts.indexOf(DISTRICTS.indexOf("sleeper"));
  const zone = demand.districts.indexOf(DISTRICTS.indexOf("industrial"));
  assert.ok(sleeper >= 0 && zone >= 0, "both district kinds exist");
  assert.ok(demand.homeWeight[ind][sleeper] > demand.homeWeight[ind][zone]);
  assert.ok(demand.homeWeight[office][zone] < 0.5 * demand.homeWeight[office][sleeper], "few office commuters from the factory zone");
});

test("Sundays send people out to the parks and into the centre at night", () => {
  const net = line(180);
  const c = catchments(demand, net);
  const sum = (kind: DayKind, p: string) => stationTrips(demand, net, c, kind, 6)[PURPOSES.indexOf(p as never)].reduce((a, b) => a + b, 0);
  assert.ok(sum("sunday", "nature") > 3 * sum("weekday", "nature"));
  assert.ok(sum("sunday", "nightlife") > sum("weekday", "nightlife"));
  assert.ok(sum("sunday", "office") < 0.2 * sum("weekday", "office"));
});

test("summer outings outnumber winter ones", () => {
  const net = line(180);
  const c = catchments(demand, net);
  const nature = PURPOSES.indexOf("nature");
  const july = stationTrips(demand, net, c, "sunday", 6)[nature].reduce((a, b) => a + b, 0);
  const january = stationTrips(demand, net, c, "sunday", 0)[nature].reduce((a, b) => a + b, 0);
  assert.ok(july > 2 * january);
});

test("late weekend trains carry people home after midnight, and earn more nights out", () => {
  const late = day(line(180), spec("sunday", "saturday", 360, 26 * 60));
  const early = day(line(180), spec("sunday", "saturday", 360, 23 * 60));
  assert.ok(late.hourly[0] + late.hourly[1] > 0, "Saturday night's crowd going home");
  assert.equal(early.hourly[0] + early.hourly[1], 0);
  assert.ok(late.trips > early.trips);
});
