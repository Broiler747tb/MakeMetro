import type { BuildKind, Period, TrackCount } from "./data";
import type { Vec2 } from "./geometry";

export type Status = "planned" | "building" | "built";

export interface TrackNode {
  id: number;
  x: number;
  y: number;
  level: number; // metres relative to the ground; negative is below
  // Direction the track must take through this node. At a platform end ("port") it points
  // away from the platform and only that way; elsewhere either way along it.
  dir?: Vec2;
  port?: boolean;
}

export interface TrackEdge {
  id: number;
  a: number;
  b: number;
  bends: Vec2[]; // points the player pulled the track through, from a to b
  pts: number[]; // flat polyline from node a to node b, worked out from the nodes and bends
  kind: BuildKind;
  tracks: TrackCount;
  status: Status;
  daysLeft: number;
  platform?: number; // station id when this is a station's own platform track
}

export type PlatformLayout = "island" | "side";

export interface Station {
  id: number;
  name: string;
  x: number;
  y: number;
  heading: number; // radians, direction of the platform
  level: number;
  kind: BuildKind;
  node: number; // centre of the platform, where trains stop
  ports: [number, number]; // nodes at the platform ends: behind and ahead along the heading
  aimed: boolean; // the player has turned it by hand, so connections leave it alone
  platformLength: number;
  layout: PlatformLayout;
  entrances: Vec2[];
  status: Status;
  daysLeft: number;
}

export interface Depot {
  id: number;
  x: number;
  y: number;
  heading: number; // radians, from the yard towards its track connection
  node: number; // where the depot's track connects, at the front of the yard
  capacity: number; // cars
  status: Status;
  daysLeft: number;
}

export interface Headways {
  weekday: number[]; // seconds per period, 0 = no service
  weekend: number[];
}

export interface Route {
  id: number;
  name: string;
  color: string;
  stops: number[]; // station ids in order; trains run both ways and turn back at the ends
  trainType: string;
  cars: number;
  headways: Headways;
}

export interface FareRules {
  mode: "flat" | "distance" | "zones";
  perKm: number; // distance mode
  zoneWidth: number; // zones mode: rings around the centre, metres wide
  perZone: number; // zones mode: added for each ring crossed
}

export interface Loan {
  principal: number;
  balance: number;
  rate: number; // per year
  takenAt: number; // game seconds
}

export interface DayRecord {
  day: number;
  weekend: boolean;
  riders: number;
  revenue: number;
  operating: number;
  satisfaction: number;
}

export interface GameState {
  format: 2;
  cityId: string;
  startDate: string; // ISO date of game day 0, a Monday
  time: number; // game seconds since 00:00 of day 0
  money: number;
  yearBudget: number;
  loans: Loan[];
  sandbox: { unlimitedMoney: boolean; instantBuild: boolean };
  fare: number; // flat fare, and the base fare for the other modes
  fares: FareRules;
  periods: Period[];
  // Minutes after midnight; close may run past 24h into the next morning.
  serviceHours: { open: number; close: number };
  weekendHours: { open: number; close: number }; // Saturdays and Sundays
  units: "metric" | "imperial";
  walkRange: number; // metres people will walk to a station
  nodes: TrackNode[];
  edges: TrackEdge[];
  stations: Station[];
  depots: Depot[];
  routes: Route[];
  demolished: number[];
  tbms: number;
  satisfaction: Record<number, number>; // route id -> 0..1
  fleet: Record<number, number>; // route id -> trains owned
  history: DayRecord[];
  nextId: number;
  gameOver: boolean;
}
