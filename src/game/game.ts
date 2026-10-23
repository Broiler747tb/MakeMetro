import type { City } from "../city/pack";
import type { Buildings } from "../city/buildings";
import { BUILD_TIME, COSTS, DEFAULT_HEADWAYS, DEFAULT_PERIODS, LINE_COLOURS, MIN_HEADWAY, trainType } from "./data";
import type { GameState, Route } from "./model";
import { Network } from "./network";
import { compileRoute, makeTrip, tripEnd, trainsFor, type CompiledRoute, type Trip } from "./service";
import type { DayKind, DayResult, DaySpec, FromWorker, SimNetwork, ToWorker } from "../sim/protocol";

// Game seconds per real second. The top speed runs a whole day each second.
export const SPEEDS = [0, 60, 600, 86400];
export const DAY = 86400;
const MAX_STEP = 6 * 3600; // never advance more than this in one frame
const HISTORY_DAYS = 400;
const UNDO_LIMIT = 100;

type GameEvent = "network" | "time" | "day" | "money" | "log" | "speed" | "gameover";

export interface LogEntry {
  time: number;
  text: string;
  important: boolean;
}

export function newGameState(city: City): GameState {
  const budget = Math.round((city.manifest.totals.residents * COSTS.budgetPerResidentYear) / 1e6) * 1e6;
  return {
    format: 2,
    cityId: city.id,
    startDate: "2026-01-05",
    time: 6 * 3600,
    money: budget,
    yearBudget: budget,
    loans: [],
    sandbox: { unlimitedMoney: false, instantBuild: false },
    fare: COSTS.fare,
    fares: { mode: "flat", perKm: 0.1, zoneWidth: 8000, perZone: 0.5 },
    periods: DEFAULT_PERIODS.map((p) => ({ ...p })),
    serviceHours: { open: 5 * 60 + 30, close: 25 * 60 },
    weekendHours: { open: 6 * 60, close: 26 * 60 },
    units: "metric",
    walkRange: 1000,
    nodes: [],
    edges: [],
    stations: [],
    depots: [],
    routes: [],
    demolished: [],
    tbms: BUILD_TIME.startingTbms,
    satisfaction: {},
    fleet: {},
    history: [],
    nextId: 1,
    gameOver: false,
  };
}

interface Snapshot {
  nodes: GameState["nodes"];
  edges: GameState["edges"];
  stations: GameState["stations"];
  depots: GameState["depots"];
  routes: GameState["routes"];
  nextId: number;
}

export class Game {
  readonly net: Network;
  speed = 1;
  compiled = new Map<number, CompiledRoute>();
  trips: Trip[] = [];
  today: DayResult | null = null;
  logEntries: LogEntry[] = [];
  /** Running totals for the current day. */
  dayTally = { riders: 0, revenue: 0, operating: 0 };
  private yearTally = { profit: 0, satSum: 0, days: 0 };
  private nextDeparture = new Map<string, number>();
  private listeners = new Map<GameEvent, Set<() => void>>();
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private worker: Worker;
  private daySeq = 0;
  private networkTimer = 0;
  private negativeDays = 0;
  private readonly baseBudget: number;
  readyRoutes = new Map<number, string | null>(); // route id -> why it can't run yet
  plannedCost = 0;
  /** Routes that can't run as often as planned because the track is full. */
  overCapacity = new Set<number>();
  private trackSqueeze = new Map<string, number>();

  constructor(
    readonly state: GameState,
    readonly city: City,
    buildings: Buildings | null,
  ) {
    this.net = new Network(state, city, buildings);
    this.baseBudget = city.manifest.totals.residents * COSTS.budgetPerResidentYear;
    this.worker = new Worker(new URL("../sim/worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => this.onWorker(ev.data);
    const g = city.grid;
    this.post({
      type: "init",
      grid: {
        x0: g.x0,
        y0: g.y0,
        cellSize: g.cellSize,
        cols: g.cols,
        rows: g.rows,
        centre: city.manifest.centre ?? [0, 0],
        residents: g.layers.residents.slice(),
        jobs: g.layers.jobs.slice(),
        jobsIndustry: g.layers.jobsIndustry.slice(),
        education: g.layers.education.slice(),
        retail: g.layers.retail.slice(),
        nature: g.layers.nature.slice(),
        nightlife: g.layers.nightlife.slice(),
      },
    });
    this.networkChanged(true);
  }

  // ---- events ---------------------------------------------------------------

  on(ev: GameEvent, fn: () => void): () => void {
    let set = this.listeners.get(ev);
    if (!set) this.listeners.set(ev, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit(ev: GameEvent) {
    this.listeners.get(ev)?.forEach((fn) => fn());
  }

  log(text: string, important = false) {
    this.logEntries.push({ time: this.state.time, text, important });
    if (this.logEntries.length > 200) this.logEntries.shift();
    this.emit("log");
  }

  private post(msg: ToWorker) {
    this.worker.postMessage(msg);
  }

  private travelTimeCallbacks = new Map<number, (m: Float32Array) => void>();

  requestTravelTime(x: number, y: number, done: (minutes: Float32Array) => void) {
    const seq = ++this.daySeq;
    this.travelTimeCallbacks.set(seq, done);
    this.post({ type: "travelTime", x, y, hour: Math.floor(this.minuteOfDay() / 60), day: this.daySpec(), seq });
  }

  private onWorker(msg: FromWorker) {
    switch (msg.type) {
      case "day":
        this.today = msg.result;
        if (this.pendingCommit === msg.seq) this.applySatisfaction(msg.result);
        this.applyDwell(msg.result);
        this.dayBusy = false;
        if (this.dayWaiting) {
          const commit = this.dayWaiting.commit;
          this.dayWaiting = null;
          this.requestDay(commit);
        }
        this.emit("day");
        break;
      case "travelTime":
        this.travelTimeCallbacks.get(msg.seq)?.(msg.minutes);
        this.travelTimeCallbacks.delete(msg.seq);
        break;
      case "error":
        console.error("simulation:", msg.message);
        this.dayBusy = false;
        break;
    }
  }

  private pendingCommit = -1;
  private dayBusy = false;
  private dayWaiting: { commit: boolean } | null = null;

  /**
   * Asks the worker to simulate today. At top speed days can come faster than a big network
   * simulates, so while one is running only the latest request is kept, never a backlog.
   */
  private requestDay(commit: boolean) {
    if (this.dayBusy) {
      this.dayWaiting = { commit: commit || (this.dayWaiting?.commit ?? false) };
      return;
    }
    this.dayBusy = true;
    const seq = ++this.daySeq;
    if (commit) this.pendingCommit = seq;
    this.post({ type: "day", day: this.daySpec(), seq, commit });
  }

  private applySatisfaction(r: DayResult) {
    for (const rs of r.routes) this.state.satisfaction[rs.id] = rs.satisfaction;
  }

  private applyDwell(r: DayResult) {
    for (const rs of r.routes) {
      const c = this.compiled.get(rs.id);
      if (!c) continue;
      const m = c.route.stops.length;
      for (let k = 0; k < m - 1; k++) {
        c.dwell[0][k] = rs.dwell[k] || c.dwell[0][k];
        c.dwell[1][k] = rs.dwell[m - 1 + k] || c.dwell[1][k];
      }
    }
  }

  // ---- calendar -------------------------------------------------------------

  get day(): number {
    return Math.floor(this.state.time / DAY);
  }

  minuteOfDay(t = this.state.time): number {
    return Math.floor((t % DAY) / 60);
  }

  date(t = this.state.time): Date {
    const d = new Date(this.state.startDate + "T00:00:00Z");
    d.setUTCSeconds(d.getUTCSeconds() + t);
    return d;
  }

  isWeekend(t = this.state.time): boolean {
    return this.dayKind(Math.floor(t / DAY)) !== "weekday";
  }

  dayKind(day: number): DayKind {
    const dow = ((day % 7) + 7) % 7; // day 0 is a Monday
    return dow === 5 ? "saturday" : dow === 6 ? "sunday" : "weekday";
  }

  /** Today as the simulation sees it: what kind of day, which month, and when trains run. */
  daySpec(day = this.day): DaySpec {
    const start = day * DAY;
    const service: number[] = [];
    const tonight: number[] = [];
    const late = this.hoursFor(day).close;
    for (let h = 0; h < 24; h++) {
      service.push(this.inService(start + h * 3600 + 1800) ? 1 : 0);
      tonight.push(late - this.hoursFor(day).open >= 1440 || late > 1440 + h * 60 + 30 ? 1 : 0);
    }
    return { kind: this.dayKind(day), previous: this.dayKind(day - 1), month: this.date(start).getUTCMonth(), service, tonight };
  }

  // ---- editing and undo -----------------------------------------------------

  private snapshot(): string {
    const s = this.state;
    const snap: Snapshot = { nodes: s.nodes, edges: s.edges, stations: s.stations, depots: s.depots, routes: s.routes, nextId: s.nextId };
    return JSON.stringify(snap);
  }

  private restore(json: string) {
    const snap: Snapshot = JSON.parse(json);
    const s = this.state;
    // Construction moves on while you plan; keep current progress for anything that still exists.
    const keep = <T extends { id: number; status: string; daysLeft: number }>(restored: T[], current: T[]) => {
      const now = new Map(current.map((x) => [x.id, x]));
      for (const r of restored) {
        const c = now.get(r.id);
        if (c && c.status !== "planned") {
          r.status = c.status;
          r.daysLeft = c.daysLeft;
        }
      }
      return restored;
    };
    s.edges = keep(snap.edges, s.edges);
    s.stations = keep(snap.stations, s.stations);
    s.depots = keep(snap.depots, s.depots);
    s.nodes = snap.nodes;
    s.routes = snap.routes;
    s.nextId = Math.max(s.nextId, snap.nextId);
    this.net.reindex();
  }

  /** Runs a planning edit with undo support. */
  edit<T>(fn: () => T): T {
    const before = this.snapshot();
    const out = fn();
    if (this.snapshot() !== before) {
      this.undoStack.push(before);
      if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
      this.redoStack = [];
      this.networkChanged();
    }
    return out;
  }

  /** For edits spread over a mouse drag: take a snapshot first, then commit it at the end. */
  beginEdit(): string {
    return this.snapshot();
  }

  commitEdit(before: string) {
    if (this.snapshot() === before) return;
    this.undoStack.push(before);
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.networkChanged();
  }

  canUndo() {
    return this.undoStack.length > 0;
  }
  canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    const snap = this.undoStack.pop();
    if (!snap) return;
    this.redoStack.push(this.snapshot());
    this.restore(snap);
    this.networkChanged();
  }

  redo() {
    const snap = this.redoStack.pop();
    if (!snap) return;
    this.undoStack.push(this.snapshot());
    this.restore(snap);
    this.networkChanged();
  }

  clearHistory() {
    this.undoStack = [];
    this.redoStack = [];
  }

  // ---- money ----------------------------------------------------------------

  canAfford(cost: number): boolean {
    return this.state.sandbox.unlimitedMoney || this.state.money >= cost;
  }

  spend(amount: number, quiet = false) {
    if (this.state.sandbox.unlimitedMoney) return;
    this.state.money -= amount;
    if (!quiet) this.emit("money");
  }

  maxLoan(): number {
    const owed = this.state.loans.reduce((a, l) => a + l.balance, 0);
    return Math.max(0, this.state.yearBudget * 2 - owed);
  }

  takeLoan(amount: number) {
    amount = Math.min(amount, this.maxLoan());
    if (amount <= 0) return;
    this.state.loans.push({ principal: amount, balance: amount, rate: COSTS.loanRate, takenAt: this.state.time });
    this.state.money += amount;
    this.log(`Borrowed ${Math.round(amount / 1e6)}M at ${(COSTS.loanRate * 100).toFixed(0)}%.`);
    this.emit("money");
  }

  repayLoans(amount: number) {
    for (const l of this.state.loans) {
      const pay = Math.min(amount, l.balance, Math.max(0, this.state.money));
      l.balance -= pay;
      this.state.money -= pay;
      amount -= pay;
    }
    this.state.loans = this.state.loans.filter((l) => l.balance > 1);
    this.emit("money");
  }

  /** Starts construction of all planned work. */
  /** Building outlines arrive after the game starts; until then nothing can be built. */
  buildingsReady = false;
  buildingsProgress = 0;

  setBuildings(b: Buildings | null) {
    this.net.buildings = b;
    this.buildingsReady = true;
    this.networkChanged();
  }

  build(): string | null {
    if (!this.buildingsReady) return "Still loading the city's buildings. Try again in a moment.";
    const cost = this.net.plannedCost();
    if (cost <= 0) return null;
    const problems = this.net.plannedProblems();
    if (problems.length) return `Fix the plans first. ${problems[0]}`;
    if (!this.canAfford(cost)) return `Not enough money: this costs ${Math.round(cost / 1e6)}M.`;
    const knocked = this.net.buildPlanned(this.state.sandbox.instantBuild);
    this.spend(cost);
    this.clearHistory();
    if (knocked.length) this.log(`Construction started. ${knocked.length} building${knocked.length === 1 ? "" : "s"} demolished.`);
    else this.log("Construction started.");
    this.networkChanged();
    return null;
  }

  // ---- routes and trains ----------------------------------------------------

  newRoute(): Route {
    const used = new Set(this.state.routes.map((r) => r.color));
    const color = LINE_COLOURS.find((c) => !used.has(c)) ?? LINE_COLOURS[this.state.routes.length % LINE_COLOURS.length];
    const r: Route = {
      id: this.state.nextId++,
      name: `Line ${this.state.routes.length + 1}`,
      color,
      stops: [],
      trainType: "standard",
      cars: 6,
      headways: { weekday: DEFAULT_HEADWAYS.slice(), weekend: DEFAULT_HEADWAYS.map((h) => Math.round(h * 1.5)) },
    };
    this.state.routes.push(r);
    this.state.satisfaction[r.id] = 0.7;
    return r;
  }

  /** Headway actually run: longer than planned when trains or track capacity run short. */
  effectiveHeadway(c: CompiledRoute, weekend: boolean, period: number): number {
    const planned = (weekend ? c.route.headways.weekend : c.route.headways.weekday)[period] ?? 0;
    if (planned <= 0) return 0;
    const fleet = this.state.fleet[c.route.id] ?? 0;
    if (fleet <= 0) return 0;
    const squeeze = this.trackSqueeze.get(`${c.route.id}:${weekend ? 1 : 0}:${period}`) ?? 1;
    return Math.max(planned * squeeze, c.cycle / fleet, MIN_HEADWAY);
  }

  /** Track capacity per direction in trains per hour. Single track shares one line both ways. */
  private edgeCapacity(edgeId: number): number {
    const e = this.net.edges.get(edgeId)!;
    if (e.tracks === 4) return (2 * 3600) / MIN_HEADWAY;
    if (e.tracks === 2) return 3600 / MIN_HEADWAY;
    const crossing = this.net.edgeLength(e) / 15 + 30;
    return 3600 / (2 * crossing + 60) / 2;
  }

  /** How much each route has to stretch its headway so shared track isn't over capacity. */
  private computeTrackSqueeze() {
    this.trackSqueeze.clear();
    this.overCapacity.clear();
    const edgesOf = new Map<number, number[]>();
    for (const c of this.compiled.values()) {
      edgesOf.set(c.route.id, [...new Set(this.net.routePath(c.route).legs.flat().map((l) => l.edge))]);
    }
    for (const weekend of [false, true]) {
      for (let p = 0; p < this.state.periods.length; p++) {
        const load = new Map<number, number>();
        for (const c of this.compiled.values()) {
          const hw = (weekend ? c.route.headways.weekend : c.route.headways.weekday)[p] ?? 0;
          if (hw <= 0) continue;
          for (const e of edgesOf.get(c.route.id)!) load.set(e, (load.get(e) ?? 0) + 3600 / Math.max(MIN_HEADWAY, hw));
        }
        for (const c of this.compiled.values()) {
          let worst = 1;
          for (const e of edgesOf.get(c.route.id)!) worst = Math.max(worst, (load.get(e) ?? 0) / this.edgeCapacity(e));
          if (worst > 1.001) {
            this.trackSqueeze.set(`${c.route.id}:${weekend ? 1 : 0}:${p}`, worst);
            this.overCapacity.add(c.route.id);
          }
        }
      }
    }
  }

  private periodAt(minute: number): number {
    const ps = this.state.periods;
    let p = ps.length - 1;
    for (let i = 0; i < ps.length; i++) if (ps[i].start <= minute) p = i;
    return p;
  }

  private buyTrains() {
    let depotCars = 0;
    for (const d of this.net.depots.values()) if (d.status === "built") depotCars += d.capacity;
    let usedCars = 0;
    for (const r of this.state.routes) usedCars += (this.state.fleet[r.id] ?? 0) * r.cars;
    for (const c of this.compiled.values()) {
      const r = c.route;
      let need = 0;
      for (const hw of [...r.headways.weekday, ...r.headways.weekend]) need = Math.max(need, trainsFor(c, hw > 0 ? Math.max(90, hw) : 0));
      const have = this.state.fleet[r.id] ?? 0;
      if (need <= have) continue;
      const tt = trainType(r.trainType);
      const room = Math.floor((depotCars - usedCars) / r.cars);
      const affordable = this.state.sandbox.unlimitedMoney ? Infinity : Math.floor(Math.max(0, this.state.money) / (tt.carCost * r.cars));
      const buy = Math.max(0, Math.min(need - have, room, affordable));
      if (buy > 0) {
        this.state.fleet[r.id] = have + buy;
        usedCars += buy * r.cars;
        this.spend(buy * r.cars * tt.carCost);
        this.log(`${r.name}: bought ${buy} train${buy === 1 ? "" : "s"}.`);
      }
      if (have + buy < need) {
        const why = room < need - have ? "depot space" : "money";
        this.log(`${r.name} is short of trains (${have + buy} of ${need}); not enough ${why}.`, true);
      }
    }
  }

  // ---- network sync -----------------------------------------------------------

  networkChanged(immediate = false) {
    this.compiled.clear();
    this.readyRoutes.clear();
    for (const r of this.state.routes) {
      const why = this.net.routeReady(r);
      this.readyRoutes.set(r.id, why);
      if (why) continue;
      const c = compileRoute(this.net, r);
      if (c) this.compiled.set(r.id, c);
    }
    this.trips = this.trips.filter((t) => this.compiled.has(t.route));
    for (const key of [...this.nextDeparture.keys()]) {
      if (!this.compiled.has(Number(key.split(":")[0]))) this.nextDeparture.delete(key);
    }
    this.computeTrackSqueeze();
    this.buyTrains();
    this.plannedCost = this.net.plannedCost();
    this.emit("network");
    clearTimeout(this.networkTimer);
    const send = () => {
      this.post({ type: "network", network: this.simNetwork() });
      this.requestDay(false);
    };
    if (immediate) send();
    else this.networkTimer = window.setTimeout(send, 250);
  }

  simNetwork(): SimNetwork {
    const stations = [...this.net.stations.values()]
      .filter((s) => s.status === "built")
      .map((s) => ({ id: s.id, x: s.x, y: s.y, level: s.level, entrances: s.entrances }));
    const routes = [...this.compiled.values()].map((c) => {
      const tt = c.tt;
      const periods = this.state.periods.length;
      const eff = (weekend: boolean) => Array.from({ length: periods }, (_, p) => this.effectiveHeadway(c, weekend, p));
      return {
        id: c.route.id,
        stops: c.route.stops,
        runTimes: c.runTimes,
        legLengths: c.lengths,
        capacity: tt.capacityPerCar * c.route.cars,
        crush: tt.capacityPerCar * tt.crushFactor * c.route.cars,
        doors: tt.doorsPerCar * c.route.cars,
        headways: { weekday: eff(false), weekend: eff(true) },
        satisfaction: this.state.satisfaction[c.route.id] ?? 0.7,
      };
    });
    const b = this.net.buildings;
    const removed = b
      ? this.state.demolished.map((i) => {
          const [x, y] = b.centroid(i);
          return { x, y, residents: b.residents(i), jobs: b.jobs(i) };
        })
      : [];
    return {
      stations,
      routes,
      periods: this.state.periods.map((p) => p.start),
      walkRange: this.state.walkRange,
      fares: { ...this.state.fares, base: this.state.fare },
      removed,
    };
  }

  // ---- time -------------------------------------------------------------------

  setSpeed(s: number) {
    this.speed = Math.max(0, Math.min(SPEEDS.length - 1, s));
    this.emit("speed");
  }

  tick(realSeconds: number) {
    if (this.state.gameOver || this.speed === 0) return;
    let dt = Math.min(MAX_STEP, realSeconds * SPEEDS[this.speed]);
    while (dt > 0) {
      // Step to the next hour boundary so accounting and days stay exact.
      const t = this.state.time;
      const nextHour = (Math.floor(t / 3600) + 1) * 3600;
      const step = Math.min(dt, nextHour - t);
      this.advance(step);
      dt -= step;
      if (nextHour - this.state.time < 1e-6) {
        this.state.time = nextHour;
        if (nextHour % DAY === 0) this.newDay();
      }
    }
    this.emit("time");
  }

  private advance(dt: number) {
    const s = this.state;
    const t0 = s.time;
    s.time += dt;
    const hour = Math.floor((t0 % DAY) / 3600);
    const frac = dt / 3600;

    // Fares
    if (this.today) {
      const riders = this.today.hourly[hour] * frac;
      const fares = this.today.revenue[hour] * frac;
      this.dayTally.riders += riders;
      this.dayTally.revenue += fares;
      if (!s.sandbox.unlimitedMoney) s.money += fares;
    }

    this.runTrains(t0, s.time);

    // Running costs for trains in service
    let opHour = 0;
    for (const trip of this.trips) {
      if (trip.start > s.time || tripEnd(trip) < t0) continue;
      const c = this.compiled.get(trip.route);
      if (c) opHour += COSTS.trainHour + c.route.cars * COSTS.carHour;
    }
    const op = opHour * frac;
    this.dayTally.operating += op;
    this.spend(op, true);

    this.progressConstruction(dt / DAY);
  }

  private runTrains(t0: number, t1: number) {
    for (const c of this.compiled.values()) {
      for (const dir of [0, 1] as const) {
        const key = `${c.route.id}:${dir}`;
        let next = this.nextDeparture.get(key);
        if (next === undefined) {
          // A route that just opened starts with trains already spread along it.
          next = t0 - c.cycle / 2;
        }
        let guard = 0;
        while (next <= t1 && guard++ < 5000) {
          const minute = this.minuteOfDay(next);
          const weekend = this.isWeekend(next);
          const hw = this.inService(next) ? this.effectiveHeadway(c, weekend, this.periodAt(minute)) : 0;
          if (hw > 0) {
            const trip = makeTrip(c, dir, next);
            if (tripEnd(trip) >= t0) this.trips.push(trip);
            next += hw;
          } else {
            next += 60;
          }
        }
        this.nextDeparture.set(key, next);
      }
    }
    this.trips = this.trips.filter((t) => tripEnd(t) >= t1);
  }

  hoursFor(day: number): { open: number; close: number } {
    return ((day % 7) + 7) % 7 >= 5 ? this.state.weekendHours : this.state.serviceHours;
  }

  /** Whether trains run at a game time; a late close carries on into the next morning. */
  inService(t: number): boolean {
    const day = Math.floor(t / DAY);
    const minute = (t - day * DAY) / 60;
    const today = this.hoursFor(day);
    if (today.close - today.open >= 1440) return true;
    if (minute >= today.open && minute < today.close) return true;
    return minute + 1440 < this.hoursFor(day - 1).close;
  }

  private progressConstruction(days: number) {
    let changed = false;
    // Bored tunnels need a boring machine; the oldest jobs get them first.
    let freeTbms = this.state.tbms;
    const edges = [...this.net.edges.values()].filter((e) => e.status === "building" && e.platform === undefined).sort((a, b) => a.id - b.id);
    for (const e of edges) {
      if (e.kind === "bored") {
        if (freeTbms <= 0) continue;
        freeTbms--;
      }
      e.daysLeft -= days;
      if (e.daysLeft <= 0) {
        e.status = "built";
        e.daysLeft = 0;
        changed = true;
      }
    }
    for (const st of this.net.stations.values()) {
      if (st.status !== "building") continue;
      st.daysLeft -= days;
      if (st.daysLeft <= 0) {
        st.status = "built";
        st.daysLeft = 0;
        for (const e of this.net.edges.values()) if (e.platform === st.id) Object.assign(e, { status: "built", daysLeft: 0 });
        changed = true;
        this.log(`${st.name} station is finished.`);
      }
    }
    for (const d of this.net.depots.values()) {
      if (d.status !== "building") continue;
      d.daysLeft -= days;
      if (d.daysLeft <= 0) {
        d.status = "built";
        d.daysLeft = 0;
        changed = true;
        this.log("A depot is finished.");
      }
    }
    if (changed) {
      const before = new Set([...this.compiled.keys()]);
      this.networkChanged();
      for (const id of this.compiled.keys()) {
        if (!before.has(id)) this.log(`${this.net.routes.get(id)?.name} opens.`, true);
      }
    }
  }

  /** Tunnel jobs waiting for a boring machine. */
  waitingForTbm(): number {
    const building = [...this.net.edges.values()].filter((e) => e.status === "building" && e.kind === "bored" && e.platform === undefined).length;
    return Math.max(0, building - this.state.tbms);
  }

  buyTbm(): boolean {
    if (!this.canAfford(BUILD_TIME.tbmCost)) return false;
    this.spend(BUILD_TIME.tbmCost);
    this.state.tbms++;
    this.log(`Bought a tunnel boring machine. You now have ${this.state.tbms}.`);
    return true;
  }

  private newDay() {
    const s = this.state;
    // Close the books on yesterday.
    let trackKm = 0;
    for (const e of this.net.edges.values()) if (e.status === "built") trackKm += this.net.edgeLength(e) / 1000;
    const stations = [...this.net.stations.values()].filter((x) => x.status === "built").length;
    const depots = [...this.net.depots.values()].filter((x) => x.status === "built").length;
    const maint = (trackKm * COSTS.trackMaintPerKmYear + stations * COSTS.stationMaintYear + depots * COSTS.depotMaintYear) / 365;
    let interest = 0;
    for (const l of s.loans) interest += (l.balance * l.rate) / 365;
    this.spend(maint + interest);

    const sats = Object.values(s.satisfaction);
    const avgSat = sats.length ? sats.reduce((a, b) => a + b, 0) / sats.length : 0;
    s.history.push({
      day: this.day - 1,
      weekend: this.isWeekend(s.time - 1),
      riders: Math.round(this.dayTally.riders),
      revenue: this.dayTally.revenue,
      operating: this.dayTally.operating + maint + interest,
      satisfaction: avgSat,
    });
    if (s.history.length > HISTORY_DAYS) s.history.shift();
    this.yearTally.profit += this.dayTally.revenue - this.dayTally.operating - maint - interest;
    this.yearTally.satSum += avgSat;
    this.yearTally.days++;
    this.dayTally = { riders: 0, revenue: 0, operating: 0 };

    const d = this.date();
    if (d.getUTCMonth() === 0 && d.getUTCDate() === 1) this.newYear();

    if (!s.sandbox.unlimitedMoney) {
      this.negativeDays = s.money < 0 ? this.negativeDays + 1 : 0;
      if (this.negativeDays === 1) this.log("You're out of money. Take a loan or cut costs within 30 days.", true);
      if (this.negativeDays >= 30) {
        s.gameOver = true;
        this.log("The city has taken the metro away from you. Game over.", true);
        this.emit("gameover");
      }
    }

    this.requestDay(true);
    this.emit("money");
  }

  private newYear() {
    const s = this.state;
    const y = this.yearTally;
    const sat = y.days ? y.satSum / y.days : 0;
    const growth = 1 + Math.min(0.5, Math.max(0, y.profit / s.yearBudget)) + 0.1 * sat;
    const next = Math.max(this.baseBudget, s.yearBudget * growth * (sat < 0.4 ? 0.9 : 1));
    s.yearBudget = Math.round(next / 1e6) * 1e6;
    if (!s.sandbox.unlimitedMoney) s.money += s.yearBudget;
    this.log(`New year. The city gives you ${Math.round(s.yearBudget / 1e6)}M.`, true);
    this.yearTally = { profit: 0, satSum: 0, days: 0 };
  }

  dispose() {
    this.worker.terminate();
  }
}

