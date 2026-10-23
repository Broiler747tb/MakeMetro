export type BBox = [west: number, south: number, east: number, north: number];

export interface Projection {
  lon0: number;
  lat0: number;
  mPerDegLon: number;
  mPerDegLat: number;
}

const DEG = Math.PI / 180;

// Series for the length of a degree on the WGS84 ellipsoid at latitude phi.
export function metresPerDegree(lat: number): { lon: number; lat: number } {
  const phi = lat * DEG;
  return {
    lat: 111132.954 - 559.822 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi),
    lon: 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi) + 0.118 * Math.cos(5 * phi),
  };
}

export function projectionFor(bbox: BBox): Projection {
  const lon0 = (bbox[0] + bbox[2]) / 2;
  const lat0 = (bbox[1] + bbox[3]) / 2;
  const m = metresPerDegree(lat0);
  return { lon0, lat0, mPerDegLon: m.lon, mPerDegLat: m.lat };
}

export function toLocal(p: Projection, lon: number, lat: number): [number, number] {
  return [(lon - p.lon0) * p.mPerDegLon, (lat - p.lat0) * p.mPerDegLat];
}

export function toLonLat(p: Projection, x: number, y: number): [number, number] {
  return [p.lon0 + x / p.mPerDegLon, p.lat0 + y / p.mPerDegLat];
}

export function lonToTileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * 2 ** z;
}

export function latToTileY(lat: number, z: number): number {
  const s = Math.sin(lat * DEG);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 2 ** z;
}

export function tileXToLon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

export function tileYToLat(y: number, z: number): number {
  const n = Math.PI * (1 - (2 * y) / 2 ** z);
  return Math.atan(Math.sinh(n)) / DEG;
}

/** Inclusive tile index range covering the bbox at zoom z. */
export function tileRange(bbox: BBox, z: number) {
  const max = 2 ** z - 1;
  const clamp = (v: number) => Math.min(max, Math.max(0, Math.floor(v)));
  return {
    minX: clamp(lonToTileX(bbox[0], z)),
    maxX: clamp(lonToTileX(bbox[2], z)),
    minY: clamp(latToTileY(bbox[3], z)),
    maxY: clamp(latToTileY(bbox[1], z)),
  };
}
