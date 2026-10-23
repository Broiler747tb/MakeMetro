export interface ProjectionParams {
  lon0: number;
  lat0: number;
  mPerDegLon: number;
  mPerDegLat: number;
}

/** Local metres around the city centre: x east, y north. */
export class Projection {
  constructor(readonly p: ProjectionParams) {}

  toLocal(lon: number, lat: number): [number, number] {
    return [(lon - this.p.lon0) * this.p.mPerDegLon, (lat - this.p.lat0) * this.p.mPerDegLat];
  }

  toLngLat(x: number, y: number): [number, number] {
    return [this.p.lon0 + x / this.p.mPerDegLon, this.p.lat0 + y / this.p.mPerDegLat];
  }
}
