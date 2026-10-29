// Balance numbers. Everything a mod might want to change lives here.

export type BuildKind = "bored" | "cut" | "elevated" | "grade";
export type TrackCount = 1 | 2 | 4;

export interface TrainType {
  id: string;
  name: string;
  carLength: number; // m
  minCars: number;
  maxCars: number;
  maxSpeed: number; // m/s
  accel: number; // m/s²
  decel: number; // m/s²
  capacityPerCar: number; // standing at 4 people/m²
  crushFactor: number;
  minRadius: number; // m
  carCost: number;
  doorsPerCar: number;
}

export const TRAIN_TYPES: TrainType[] = [
  { id: "compact", name: "Compact", carLength: 13, minCars: 2, maxCars: 6, maxSpeed: 80 / 3.6, accel: 1.2, decel: 1.2, capacityPerCar: 140, crushFactor: 1.5, minRadius: 100, carCost: 1.8e6, doorsPerCar: 2 },
  { id: "standard", name: "Standard", carLength: 19.5, minCars: 4, maxCars: 9, maxSpeed: 90 / 3.6, accel: 1.0, decel: 1.1, capacityPerCar: 220, crushFactor: 1.5, minRadius: 200, carCost: 2.5e6, doorsPerCar: 4 },
  { id: "long", name: "Long", carLength: 22, minCars: 6, maxCars: 10, maxSpeed: 100 / 3.6, accel: 0.9, decel: 1.0, capacityPerCar: 280, crushFactor: 1.5, minRadius: 300, carCost: 3.2e6, doorsPerCar: 4 },
  { id: "express", name: "Express", carLength: 24, minCars: 4, maxCars: 12, maxSpeed: 130 / 3.6, accel: 0.8, decel: 0.9, capacityPerCar: 240, crushFactor: 1.4, minRadius: 500, carCost: 4.0e6, doorsPerCar: 3 },
];

export function trainType(id: string): TrainType {
  return TRAIN_TYPES.find((t) => t.id === id) ?? TRAIN_TYPES[1];
}

export const KIND_DEFAULT_LEVEL: Record<BuildKind, number> = { bored: -25, cut: -8, elevated: 8, grade: 0 };
export const KIND_LEVEL_RANGE: Record<BuildKind, [number, number]> = {
  bored: [-80, -12],
  cut: [-14, -4],
  elevated: [5, 20],
  grade: [0, 0],
};

export const COSTS = {
  // per km of double track
  trackPerKm: { bored: 150e6, cut: 100e6, elevated: 65e6, grade: 30e6 } as Record<BuildKind, number>,
  boredPerMetreDepth: 3e6, // per km, for every metre below 15 m
  bridgePerKm: 120e6,
  trackCountFactor: { 1: 0.7, 2: 1, 4: 1.8 } as Record<TrackCount, number>,
  station: { bored: 100e6, cut: 60e6, elevated: 40e6, grade: 18e6 } as Record<BuildKind, number>,
  stationPerMetreDepth: 2e6,
  stationSideFactor: 1.1,
  stationRefLength: 150,
  depot: 150e6,
  demolitionPerM2: 3000,
  trainHour: 200, // crew, power and wear for one train for an hour
  carHour: 40, // and for each of its cars
  trackMaintPerKmYear: 400e3,
  stationMaintYear: 1e6,
  depotMaintYear: 3e6,
  fare: 2,
  budgetPerResidentYear: 300,
  loanRate: 0.05,
};

// Construction pace in days.
// Far quicker than real life (a real boring machine manages 10-25 m a day), so a line
// opens within weeks of game time rather than years.
export const BUILD_TIME = {
  tbmMetresPerDay: 125,
  daysPerKm: { cut: 25, elevated: 18, grade: 10 } as Record<Exclude<BuildKind, "bored">, number>,
  station: { bored: 30, cut: 20, elevated: 14, grade: 7 } as Record<BuildKind, number>,
  depot: 20,
  startingTbms: 2,
  tbmCost: 25e6,
};

// Track corridor half-width by number of tracks, for demolition checks.
export const CORRIDOR_HALF_WIDTH: Record<TrackCount, number> = { 1: 4, 2: 6, 4: 11 };
export const TUNNEL_RADIUS = 3.5;
export const MAX_GRADIENT = 0.04;
export const MIN_CURVE_RADIUS = 100; // tightest curve any train type can take
export const MIN_HEADWAY = 90; // s; one signalling level for the whole network
export const TRANSFER_LINK_DISTANCE = 200; // m between stations that link automatically
export const RIVER_CLEARANCE_LEVEL = -15; // tunnels under water must be at least this deep

export interface Period {
  name: string;
  start: number; // minutes after midnight
}

export const DEFAULT_PERIODS: Period[] = [
  { name: "Early", start: 5 * 60 + 30 },
  { name: "Morning peak", start: 7 * 60 },
  { name: "Midday", start: 10 * 60 },
  { name: "Evening peak", start: 16 * 60 },
  { name: "Evening", start: 19 * 60 + 30 },
  { name: "Late", start: 22 * 60 },
];

export const DEFAULT_HEADWAYS: number[] = [360, 150, 240, 150, 300, 480];

export const LINE_COLOURS = [
  "#d6342c", "#2f7d32", "#1d5fbf", "#00a6d6", "#8b5a2b", "#f08a00",
  "#7b3fa0", "#f3c300", "#9aa0a6", "#00a383", "#e5007d", "#5b6abf",
];

// Okabe–Ito plus two extras; distinguishable with the common types of colour blindness.
export const LINE_COLOURS_SAFE = ["#e69f00", "#56b4e9", "#009e73", "#f0e442", "#0072b2", "#d55e00", "#cc79a7", "#000000", "#999999", "#882255"];
