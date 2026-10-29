// Messages between the game and the simulation worker.

export interface SimStation {
  id: number;
  x: number;
  y: number;
  level: number;
  entrances: [number, number][];
}

export interface SimRoute {
  id: number;
  stops: number[]; // station ids
  runTimes: number[]; // seconds between consecutive stops
  legLengths: number[];
  capacity: number; // people per train at 4/m²
  crush: number; // people per train when packed
  doors: number;
  headways: { weekday: number[]; weekend: number[] };
  satisfaction: number;
  fare?: number; // the route's own boarding fare, in place of the network's
}

export interface SimFares {
  mode: "flat" | "distance" | "zones";
  base: number; // charged by every route boarded, unless it has its own fare
  perKm: number; // distance mode, per km ridden
  zoneWidth: number;
  perZone: number; // zones mode, per ring crossed
}

export interface SimNetwork {
  stations: SimStation[];
  routes: SimRoute[];
  periods: number[]; // start minute of each period
  walkRange: number;
  centre: [number, number]; // zone rings are counted from here
  fares: SimFares;
  removed: { x: number; y: number; residents: number; jobs: number }[]; // demolished buildings
}

export interface GridData {
  x0: number;
  y0: number;
  cellSize: number;
  cols: number;
  rows: number;
  centre: [number, number]; // city centre, local metres
  residents: Float32Array;
  jobs: Float32Array;
  jobsIndustry: Float32Array;
  education: Float32Array;
  retail: Float32Array;
  nature: Float32Array;
  nightlife: Float32Array;
}

export type DayKind = "weekday" | "saturday" | "sunday";

/** What a simulated day looks like from the outside: its kind, season and when trains run. */
export interface DaySpec {
  kind: DayKind;
  previous: DayKind; // whose night-out trips home spill into this morning
  month: number; // 0-11
  service: number[]; // 24 hours, 1 when trains run (including a late close carried over from yesterday)
  tonight: number[]; // first hours after midnight, 1 when today's late close still has trains running
}

export interface RouteDayStats {
  id: number;
  boardings: Float32Array; // per hour
  maxLoad: Float32Array; // per hour, load factor of the busiest link
  leftBehind: number;
  satisfaction: number; // 0..1 after today's update
  avgSpeed: number; // km/h including dwell
  // Flow per hour on each link: [dir 0 links..., dir 1 links...] x 24
  linkFlow: Float32Array;
  dwell: Float32Array; // seconds per stop at the busiest hour, dir 0 then dir 1
  fares: number; // what riders paid this route today
}

export interface StationDayStats {
  id: number;
  entries: Float32Array;
  exits: Float32Array;
  transfers: number;
}

export interface DayResult {
  kind: DayKind;
  trips: number;
  potential: number; // trips that could ride if service were perfect
  hourly: Float32Array;
  revenue: Float32Array; // fares taken per hour
  routes: RouteDayStats[];
  stations: StationDayStats[];
  computeMs: number;
}

export type ToWorker =
  | { type: "init"; grid: GridData }
  | { type: "network"; network: SimNetwork }
  | { type: "day"; day: DaySpec; seq: number; commit: boolean } // commit: keep the satisfaction update
  | { type: "travelTime"; x: number; y: number; hour: number; day: DaySpec; seq: number }
  // A day with other fares, for a preview; routeFares maps route id to its own fare or null for the network's.
  | { type: "forecast"; fares: SimFares; routeFares: Record<number, number | null>; day: DaySpec; seq: number };

export type FromWorker =
  | { type: "ready" }
  | { type: "day"; seq: number; result: DayResult }
  | { type: "travelTime"; seq: number; minutes: Float32Array; cols: number; rows: number; x0: number; y0: number; cellSize: number }
  | { type: "forecast"; seq: number; trips: number; fares: number; routes: { id: number; riders: number; fares: number }[] }
  | { type: "error"; message: string };
