import type { Features, NamedLine, Point } from "./collect";
import { lineLength, pointAlong } from "./geometry";

export interface NamePoint {
  n: string;
  en?: string;
  x: number;
  y: number;
  k: "street" | "place" | "poi";
  /** Prominence from 1 (a lane, a small chapel) to 10 (a city). */
  r: number;
}

const STREET_RANK: Record<string, number> = {
  motorway: 7,
  trunk: 7,
  primary: 6,
  secondary: 5,
  tertiary: 4,
  pedestrian: 4,
  residential: 2,
  living_street: 2,
  unclassified: 2,
  service: 1,
};

const STREET_KINDS = new Set(["highway", "major_road", "minor_road"]);
// The path and "other" kinds also carry footways and railway platforms.
const MINOR_STREETS = new Set(["pedestrian", "living_street", "alley"]);

const PLACE_RANK: Record<string, number> = {
  city: 10,
  town: 8,
  suburb: 7,
  quarter: 4,
  borough: 7,
  neighbourhood: 5,
  village: 5,
  hamlet: 3,
  locality: 2,
};

/** Base prominence of landmark POI kinds; anything else is not a landmark. */
const LANDMARK_RANK: Record<string, number> = {
  aerodrome: 6,
  stadium: 6,
  zoo: 6,
  museum: 5,
  theatre: 5,
  university: 5,
  castle: 5,
  monastery: 5,
  exhibition_centre: 5,
  theme_park: 5,
  park: 4,
  attraction: 4,
  manor: 4,
  mall: 4,
  marketplace: 4,
  department_store: 4,
  planetarium: 4,
  aquarium: 4,
  water_park: 4,
  townhall: 4,
  garden: 3,
  place_of_worship: 3,
  cinema: 3,
  arts_centre: 3,
  hospital: 3,
  college: 3,
  cemetery: 3,
  monument: 3,
  events_venue: 3,
  gallery: 2,
  library: 2,
  courthouse: 2,
  memorial: 2,
  viewpoint: 2,
  ruins: 2,
  sports_centre: 2,
  ice_rink: 2,
  research_institute: 2,
  hotel: 2,
};

/** POI kinds that mark rail and metro stations and their parts. */
const STATION_KINDS = new Set([
  "station",
  "halt",
  "train_station",
  "train_station_entrance",
  "subway_entrance",
  "platform",
]);

// Catches station buildings tagged as something else, e.g. a terminal mapped as an attraction.
const STATION_WORDS = /(метро|станция|вокзал|платформа|metro|subway|railway station|train station|bahnhof)/i;

function normalise(name: string): string {
  return name
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/(?<!\p{L})(станция|метро|платформа|ст\.|м\.|о\.п\.)/gu, "")
    .replace(/[«»"'.,()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Remembers named points to keep one per name within `radius`. */
class Thinner {
  private seen = new Map<string, [number, number][]>();
  constructor(private radius: number) {}

  near(name: string, x: number, y: number): boolean {
    const gx = Math.floor(x / this.radius);
    const gy = Math.floor(y / this.radius);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = this.seen.get(`${name}|${gx + dx}|${gy + dy}`);
        if (list?.some(([px, py]) => Math.hypot(px - x, py - y) < this.radius)) return true;
      }
    }
    return false;
  }

  add(name: string, x: number, y: number) {
    const key = `${name}|${Math.floor(x / this.radius)}|${Math.floor(y / this.radius)}`;
    let list = this.seen.get(key);
    if (!list) this.seen.set(key, (list = []));
    list.push([x, y]);
  }

  accept(name: string, x: number, y: number): boolean {
    if (this.near(name, x, y)) return false;
    this.add(name, x, y);
    return true;
  }
}

function entry(n: string, en: string | undefined, x: number, y: number, k: NamePoint["k"], r: number): NamePoint {
  const p: NamePoint = { n, x: Math.round(x), y: Math.round(y), k, r };
  if (en && en !== n) p.en = en;
  return p;
}

function streetRank(road: NamedLine): number | undefined {
  if (STREET_KINDS.has(road.kind)) return road.detail.endsWith("_link") ? 1 : (STREET_RANK[road.detail] ?? 1);
  if (MINOR_STREETS.has(road.detail)) return STREET_RANK[road.detail] ?? 2;
  return undefined;
}

function streets(roads: NamedLine[], spacing: number, inside: (x: number, y: number) => boolean): NamePoint[] {
  const ranked = roads
    .map((road) => ({ road, rank: streetRank(road) }))
    .filter((r): r is { road: NamedLine; rank: number } => r.rank !== undefined)
    .sort((a, b) => b.rank - a.rank);
  // Dual carriageways and tile cuts give the same name twice within a few metres.
  const thin = new Thinner(spacing * 0.6);
  const out: NamePoint[] = [];
  for (const { road, rank } of ranked) {
    const len = lineLength(road.line);
    const count = Math.max(1, Math.round(len / spacing));
    for (let i = 0; i < count; i++) {
      const [x, y] = pointAlong(road.line, ((i + 0.5) * len) / count);
      if (inside(x, y) && thin.accept(road.name, x, y)) out.push(entry(road.name, road.nameEn, x, y, "street", rank));
    }
  }
  return out;
}

function places(points: Point[], inside: (x: number, y: number) => boolean): NamePoint[] {
  const out: NamePoint[] = [];
  for (const p of points) {
    const rank = PLACE_RANK[p.detail ?? p.kind];
    if (p.name && rank && inside(p.x, p.y)) out.push(entry(p.name, p.nameEn, p.x, p.y, "place", rank));
  }
  return out;
}

/**
 * Station features never become name points. A landmark that shares a
 * station's name is dropped only near that station, where it is usually the
 * station building itself; a park the station is named after stays.
 */
function landmarks(points: Point[], inside: (x: number, y: number) => boolean): NamePoint[] {
  const stations = new Thinner(300);
  for (const p of points) if (p.name && STATION_KINDS.has(p.kind)) stations.add(normalise(p.name), p.x, p.y);
  const candidates = points
    .map((p) => ({ p, base: LANDMARK_RANK[p.kind] }))
    .filter(({ p, base }) => {
      if (!p.name || !base || !inside(p.x, p.y)) return false;
      // Minor kinds only count when the basemap shows them early.
      if (p.minZoom > (base >= 3 ? 16 : 15)) return false;
      return !STATION_WORDS.test(p.name) && !stations.near(normalise(p.name), p.x, p.y);
    })
    .map(({ p, base }) => ({ p, rank: Math.min(10, Math.max(1, base + Math.max(0, 16 - p.minZoom))) }))
    .sort((a, b) => b.rank - a.rank);
  const thin = new Thinner(200);
  return candidates
    .filter(({ p }) => thin.accept(p.name!, p.x, p.y))
    .map(({ p, rank }) => entry(p.name!, p.nameEn, p.x, p.y, "poi", rank));
}

export function buildNames(
  features: Features,
  streetSpacing: number,
  bounds: [number, number, number, number],
): NamePoint[] {
  const inside = (x: number, y: number) => x >= bounds[0] && y >= bounds[1] && x < bounds[2] && y < bounds[3];
  return [
    ...places(features.places, inside),
    ...landmarks(features.pois, inside),
    ...streets(features.roads, streetSpacing, inside),
  ];
}
