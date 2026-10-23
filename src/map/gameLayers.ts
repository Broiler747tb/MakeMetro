import type { GeoJSONSource, ImageSource, Map as MapLibre } from "maplibre-gl";
import type { Game } from "../game/game";
import type { Theme } from "./style";
import { trainType } from "../game/data";
import { boxAround, type Vec2 } from "../game/geometry";
import { DEPOT_LENGTH, DEPOT_WIDTH, platformWidth } from "../game/network";

type Feature = GeoJSON.Feature;
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

const ids = {
  track: "mm-track",
  routes: "mm-routes",
  stations: "mm-stations",
  footprints: "mm-footprints",
  depots: "mm-depots",
  entrances: "mm-entrances",
  preview: "mm-preview",
  demolish: "mm-demolish",
  overlay: "mm-overlay",
  highlight: "mm-highlight",
  handles: "mm-handles",
};

export const LAYER_IDS = {
  trackHit: "mm-track-hit",
  stations: "mm-stations-circle",
  entrances: "mm-entrances-circle",
  routes: "mm-routes-line",
  handles: "mm-handles-point",
  /** The 3D layer goes just under this, so stations and labels stay on top of trains. */
  above3d: "mm-entrances-circle",
};

export type RouteOverlay = "none" | "flows" | "crowding";

export type Handle =
  | { kind: "rotate"; owner: "station" | "depot"; id: number; x: number; y: number; cx: number; cy: number }
  | { kind: "bend"; edge: number; index: number; x: number; y: number };

interface Colours {
  track: string;
  trackPlanned: string;
  stationFill: string;
  stationStroke: string;
  platform: string;
  platformEdge: string;
  yard: string;
  label: string;
  halo: string;
  preview: string;
  bad: string;
}

const COLOURS: Record<Theme, Colours> = {
  light: {
    track: "#7f8287",
    trackPlanned: "#9da0a5",
    stationFill: "#ffffff",
    stationStroke: "#2a2b2e",
    platform: "#cfd1d4",
    platformEdge: "#6e7176",
    yard: "#d9d6cf",
    label: "#202124",
    halo: "#f4f4f2",
    preview: "#2a2b2e",
    bad: "#d13b2f",
  },
  dark: {
    track: "#6c7077",
    trackPlanned: "#5a5e65",
    stationFill: "#f1f1ef",
    stationStroke: "#0f1012",
    platform: "#3b3e44",
    platformEdge: "#8a8e95",
    yard: "#2d2c29",
    label: "#e9e9e7",
    halo: "#17181a",
    preview: "#e9e9e7",
    bad: "#ff6a5c",
  },
};

const plannedOpacity = (built: number, planned: number) => ["case", ["==", ["get", "status"], "planned"], planned, built] as never;

export class GameLayers {
  private routeOverlay: RouteOverlay = "none";
  private hour = 8;

  constructor(
    private map: MapLibre,
    private game: Game,
    private theme: Theme,
  ) {
    for (const id of Object.values(ids)) {
      if (id !== ids.overlay) map.addSource(id, { type: "geojson", data: EMPTY });
    }
    this.addLayers();
    this.update();
  }

  private c(): Colours {
    return COLOURS[this.theme];
  }

  private addLayers() {
    const map = this.map;
    const c = this.c();
    const before = map.getLayer("water-labels") ? "water-labels" : undefined;
    map.addLayer({ id: "mm-demolish-fill", type: "fill", source: ids.demolish, paint: { "fill-color": c.bad, "fill-opacity": 0.45 } }, before);
    map.addLayer({
      id: "mm-footprints-fill",
      type: "fill",
      source: ids.footprints,
      paint: {
        "fill-color": ["case", ["==", ["get", "kind"], "depot"], c.yard, c.platform],
        "fill-opacity": plannedOpacity(0.95, 0.5),
      },
    });
    map.addLayer({
      id: "mm-footprints-line",
      type: "line",
      source: ids.footprints,
      paint: {
        "line-color": ["case", ["get", "bad"], c.bad, c.platformEdge],
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 16, 1.5],
        "line-opacity": plannedOpacity(1, 0.8),
      },
    });
    map.addLayer({
      id: "mm-track-built",
      type: "line",
      source: ids.track,
      filter: ["==", ["get", "status"], "built"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": c.track, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.5, 16, 4] },
    });
    map.addLayer({
      id: "mm-track-building",
      type: "line",
      source: ids.track,
      filter: ["==", ["get", "status"], "building"],
      paint: { "line-color": c.track, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.5, 16, 4], "line-dasharray": [2, 1] },
    });
    map.addLayer({
      id: "mm-track-planned",
      type: "line",
      source: ids.track,
      filter: ["==", ["get", "status"], "planned"],
      paint: {
        "line-color": ["case", ["get", "bad"], c.bad, c.trackPlanned],
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.5, 16, 4],
        "line-dasharray": [1, 1.5],
      },
    });
    map.addLayer({ id: LAYER_IDS.trackHit, type: "line", source: ids.track, paint: { "line-color": "#000", "line-opacity": 0, "line-width": 14 } });
    map.addLayer({
      id: LAYER_IDS.routes,
      type: "line",
      source: ids.routes,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["get", "color"],
        "line-width": ["interpolate", ["linear"], ["zoom"], 9, ["*", 2, ["get", "w"]], 16, ["*", 6, ["get", "w"]]],
        "line-offset": ["interpolate", ["linear"], ["zoom"], 9, ["*", ["get", "off"], 2.4], 16, ["*", ["get", "off"], 6.5]],
        "line-opacity": ["case", ["get", "running"], 1, 0.45],
      },
    });
    map.addLayer({
      id: "mm-highlight-line",
      type: "line",
      source: ids.highlight,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": c.preview, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 6, 16, 12], "line-opacity": 0.18 },
    });
    map.addLayer({
      id: "mm-preview-fill",
      type: "fill",
      source: ids.preview,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": ["case", ["get", "bad"], c.bad, c.platform], "fill-opacity": 0.6 },
    });
    map.addLayer({
      id: "mm-preview-line",
      type: "line",
      source: ids.preview,
      filter: ["in", ["geometry-type"], ["literal", ["LineString", "Polygon"]]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["case", ["get", "bad"], c.bad, c.preview],
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2, 16, 4],
        "line-dasharray": [2, 1],
      },
    });
    map.addLayer({
      id: "mm-preview-points",
      type: "circle",
      source: ids.preview,
      filter: ["==", ["geometry-type"], "Point"],
      paint: { "circle-radius": 4, "circle-color": c.stationFill, "circle-stroke-color": ["case", ["get", "bad"], c.bad, c.preview], "circle-stroke-width": 2 },
    });
    map.addLayer({
      id: LAYER_IDS.entrances,
      type: "circle",
      source: ids.entrances,
      minzoom: 14.5,
      paint: { "circle-radius": 3.5, "circle-color": c.stationStroke, "circle-stroke-color": c.stationFill, "circle-stroke-width": 1.5 },
    });
    map.addLayer({
      id: LAYER_IDS.stations,
      type: "circle",
      source: ids.stations,
      paint: {
        // A dot when zoomed out; up close the platform itself shows where the station is.
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, ["case", ["get", "interchange"], 4, 3], 13, ["case", ["get", "interchange"], 7, 5.5], 16, ["case", ["get", "interchange"], 5, 4]],
        "circle-color": c.stationFill,
        "circle-stroke-color": c.stationStroke,
        "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 9, 1.2, 16, 2],
        "circle-opacity": plannedOpacity(1, 0.7),
        "circle-stroke-opacity": plannedOpacity(1, 0.5),
      },
    });
    map.addLayer({
      id: "mm-stations-label",
      type: "symbol",
      source: ids.stations,
      minzoom: 11.5,
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Medium"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 12, 11, 16, 13],
        "text-anchor": "left",
        "text-offset": [0.9, 0],
        "text-max-width": 9,
        "text-optional": true,
      },
      paint: { "text-color": c.label, "text-halo-color": c.halo, "text-halo-width": 1.5 },
    });
    map.addLayer({
      id: "mm-depots-label",
      type: "symbol",
      source: ids.depots,
      minzoom: 12.5,
      layout: { "text-field": "Depot", "text-font": ["Noto Sans Regular"], "text-size": 11 },
      paint: { "text-color": c.label, "text-halo-color": c.halo, "text-halo-width": 1.5 },
    });
    map.addLayer({
      id: "mm-handles-arm",
      type: "line",
      source: ids.handles,
      filter: ["==", ["geometry-type"], "LineString"],
      paint: { "line-color": c.preview, "line-width": 1.5, "line-dasharray": [2, 2] },
    });
    map.addLayer({
      id: LAYER_IDS.handles,
      type: "circle",
      source: ids.handles,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": ["case", ["==", ["get", "kind"], "rotate"], 7, 5],
        "circle-color": ["case", ["==", ["get", "kind"], "rotate"], c.preview, c.stationFill],
        "circle-stroke-color": ["case", ["==", ["get", "kind"], "rotate"], c.stationFill, c.preview],
        "circle-stroke-width": 2,
      },
    });
  }

  setTheme(theme: Theme) {
    this.theme = theme;
    const c = this.c();
    const m = this.map;
    m.setPaintProperty("mm-demolish-fill", "fill-color", c.bad);
    m.setPaintProperty("mm-footprints-fill", "fill-color", ["case", ["==", ["get", "kind"], "depot"], c.yard, c.platform]);
    m.setPaintProperty("mm-footprints-line", "line-color", ["case", ["get", "bad"], c.bad, c.platformEdge]);
    m.setPaintProperty("mm-track-built", "line-color", c.track);
    m.setPaintProperty("mm-track-building", "line-color", c.track);
    m.setPaintProperty("mm-track-planned", "line-color", ["case", ["get", "bad"], c.bad, c.trackPlanned]);
    m.setPaintProperty("mm-highlight-line", "line-color", c.preview);
    m.setPaintProperty("mm-preview-fill", "fill-color", ["case", ["get", "bad"], c.bad, c.platform]);
    m.setPaintProperty("mm-preview-line", "line-color", ["case", ["get", "bad"], c.bad, c.preview]);
    m.setPaintProperty("mm-preview-points", "circle-color", c.stationFill);
    m.setPaintProperty("mm-preview-points", "circle-stroke-color", ["case", ["get", "bad"], c.bad, c.preview]);
    m.setPaintProperty(LAYER_IDS.entrances, "circle-color", c.stationStroke);
    m.setPaintProperty(LAYER_IDS.entrances, "circle-stroke-color", c.stationFill);
    m.setPaintProperty(LAYER_IDS.stations, "circle-color", c.stationFill);
    m.setPaintProperty(LAYER_IDS.stations, "circle-stroke-color", c.stationStroke);
    m.setPaintProperty("mm-handles-arm", "line-color", c.preview);
    m.setPaintProperty(LAYER_IDS.handles, "circle-color", ["case", ["==", ["get", "kind"], "rotate"], c.preview, c.stationFill]);
    m.setPaintProperty(LAYER_IDS.handles, "circle-stroke-color", ["case", ["==", ["get", "kind"], "rotate"], c.stationFill, c.preview]);
    for (const id of ["mm-stations-label", "mm-depots-label"]) {
      m.setPaintProperty(id, "text-color", c.label);
      m.setPaintProperty(id, "text-halo-color", c.halo);
    }
  }

  private line(pts: number[], props: Record<string, unknown>): Feature {
    const proj = this.game.city.proj;
    const coords: [number, number][] = [];
    for (let i = 0; i < pts.length; i += 2) coords.push(proj.toLngLat(pts[i], pts[i + 1]));
    return { type: "Feature", properties: props, geometry: { type: "LineString", coordinates: coords } };
  }

  private point(x: number, y: number, props: Record<string, unknown>): Feature {
    return { type: "Feature", properties: props, geometry: { type: "Point", coordinates: this.game.city.proj.toLngLat(x, y) } };
  }

  private polygon(ring: Vec2[], props: Record<string, unknown>): Feature {
    const proj = this.game.city.proj;
    const coords = ring.map(([x, y]) => proj.toLngLat(x, y));
    coords.push(coords[0]);
    return { type: "Feature", properties: props, geometry: { type: "Polygon", coordinates: [coords] } };
  }

  private set(id: string, features: Feature[]) {
    (this.map.getSource(id) as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features });
  }

  setRouteOverlay(mode: RouteOverlay, hour: number) {
    this.routeOverlay = mode;
    this.hour = hour;
    this.updateRoutes();
  }

  update() {
    const g = this.game;
    const net = g.net;
    const track: Feature[] = [];
    for (const e of net.edges.values()) {
      // Platform track is drawn as part of the platform.
      if (e.platform !== undefined) continue;
      const bad = e.status === "planned" && net.edgeProblems(e).length > 0;
      track.push(this.line(e.pts, { id: e.id, kind: e.kind, status: e.status, bad }));
    }
    this.set(ids.track, track);

    const servedBy = new Map<number, number>();
    for (const r of g.state.routes) for (const s of r.stops) servedBy.set(s, (servedBy.get(s) ?? 0) + 1);
    const stations: Feature[] = [];
    const footprints: Feature[] = [];
    const entrances: Feature[] = [];
    for (const st of net.stations.values()) {
      const nearby = [...net.stations.values()].some((o) => o.id !== st.id && Math.hypot(o.x - st.x, o.y - st.y) < 200);
      stations.push(this.point(st.x, st.y, { id: st.id, name: st.name, status: st.status, interchange: (servedBy.get(st.id) ?? 0) > 1 || nearby }));
      const bad = st.status === "planned" && net.stationProblems(st).length > 0;
      footprints.push(this.polygon(boxAround(st.x, st.y, st.heading, st.platformLength, platformWidth(st)), { kind: "station", id: st.id, status: st.status, bad }));
      st.entrances.forEach(([ex, ey], i) => entrances.push(this.point(ex, ey, { station: st.id, index: i })));
    }
    const depots: Feature[] = [];
    for (const d of net.depots.values()) {
      footprints.push(this.polygon(boxAround(d.x, d.y, d.heading, DEPOT_LENGTH, DEPOT_WIDTH), { kind: "depot", id: d.id, status: d.status, bad: false }));
      depots.push(this.point(d.x, d.y, { id: d.id, status: d.status }));
    }
    this.set(ids.stations, stations);
    this.set(ids.footprints, footprints);
    this.set(ids.entrances, entrances);
    this.set(ids.depots, depots);
    this.updateRoutes();
  }

  updateRoutes() {
    const g = this.game;
    const net = g.net;
    // Which routes use each edge, so parallel lines sit side by side.
    const onEdge = new Map<number, number[]>();
    const paths = new Map<number, ReturnType<typeof net.routePath>>();
    for (const r of g.state.routes) {
      const p = net.routePath(r);
      paths.set(r.id, p);
      for (const l of new Set(p.legs.flat().map((x) => x.edge))) {
        const list = onEdge.get(l) ?? [];
        list.push(r.id);
        onEdge.set(l, list);
      }
    }
    const stats = new Map(g.today?.routes.map((r) => [r.id, r]) ?? []);
    const features: Feature[] = [];
    for (const r of g.state.routes) {
      const running = g.compiled.has(r.id);
      const s = stats.get(r.id);
      const path = paths.get(r.id)!;
      const linkFlows = s ? linkFlowByEdge(path.legs, r.stops.length, s.linkFlow, this.hour) : null;
      const c = g.compiled.get(r.id);
      const minute = this.hour * 60 + 30;
      const hw = c && g.inService(g.day * 86400 + minute * 60) ? g.effectiveHeadway(c, g.isWeekend(), periodIndex(g, minute)) : 0;
      const hourlyCapacity = hw > 0 ? (3600 / hw) * trainType(r.trainType).capacityPerCar * r.cars : 0;
      for (const l of path.legs.flat()) {
        const e = net.edges.get(l.edge)!;
        const users = onEdge.get(l.edge)!;
        const off = users.indexOf(r.id) - (users.length - 1) / 2;
        let w = 1;
        let color = r.color;
        if (this.routeOverlay !== "none" && linkFlows) {
          const flow = linkFlows.get(l.edge) ?? 0;
          if (this.routeOverlay === "flows") w = 0.6 + Math.min(3, Math.sqrt(flow / 4000));
          else color = hourlyCapacity > 0 ? loadColour(flow / hourlyCapacity) : "#8a8d92";
        }
        // Offsets are relative to the edge's own direction, so every route draws it the same way.
        features.push(this.line(e.pts, { route: r.id, color, off, w, running }));
      }
    }
    this.set(ids.routes, features);
  }

  highlightRoute(routeId: number | null) {
    const r = routeId === null ? undefined : this.game.net.routes.get(routeId);
    if (!r) {
      this.set(ids.highlight, []);
      return;
    }
    const legs = this.game.net.routePath(r).legs.flat();
    this.set(
      ids.highlight,
      legs.map((l) => this.line(this.game.net.edges.get(l.edge)!.pts, {})),
    );
  }

  setPreview(lines: { pts: number[]; bad: boolean }[], points: { x: number; y: number; bad: boolean }[], polys: { ring: Vec2[]; bad: boolean }[]) {
    this.set(ids.preview, [
      ...polys.map((p) => this.polygon(p.ring, { bad: p.bad })),
      ...lines.map((l) => this.line(l.pts, { bad: l.bad })),
      ...points.map((p) => this.point(p.x, p.y, { bad: p.bad })),
    ]);
  }

  setHandles(handles: Handle[]) {
    const features: Feature[] = [];
    for (const hd of handles) {
      if (hd.kind === "rotate") {
        features.push(this.line([hd.cx, hd.cy, hd.x, hd.y], { kind: "arm" }));
        features.push(this.point(hd.x, hd.y, { kind: "rotate", owner: hd.owner, id: hd.id }));
      } else {
        features.push(this.point(hd.x, hd.y, { kind: "bend", edge: hd.edge, index: hd.index }));
      }
    }
    this.set(ids.handles, features);
  }

  setDemolition(buildingIds: number[]) {
    const b = this.game.net.buildings;
    if (!b) return;
    const proj = this.game.city.proj;
    this.set(
      ids.demolish,
      buildingIds.map((i) => {
        const ring = b.ring(i);
        const coords: [number, number][] = [];
        for (let k = 0; k < ring.length; k += 2) coords.push(proj.toLngLat(ring[k], ring[k + 1]));
        if (coords.length) coords.push(coords[0]);
        return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [coords] } } as Feature;
      }),
    );
  }

  // ---- grid overlays -----------------------------------------------------------

  showGridOverlay(values: ArrayLike<number> | null, ramp: (v: number, i: number) => [number, number, number, number]) {
    const map = this.map;
    if (!values) {
      if (map.getLayer("mm-overlay-raster")) map.removeLayer("mm-overlay-raster");
      if (map.getSource(ids.overlay)) map.removeSource(ids.overlay);
      return;
    }
    const g = this.game.city.grid;
    const canvas = document.createElement("canvas");
    canvas.width = g.cols;
    canvas.height = g.rows;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(g.cols, g.rows);
    for (let r = 0; r < g.rows; r++) {
      for (let c = 0; c < g.cols; c++) {
        const i = r * g.cols + c;
        const [R, G, B, A] = ramp(values[i], i);
        const o = ((g.rows - 1 - r) * g.cols + c) * 4; // image rows run north to south
        img.data[o] = R;
        img.data[o + 1] = G;
        img.data[o + 2] = B;
        img.data[o + 3] = A;
      }
    }
    ctx.putImageData(img, 0, 0);
    const url = canvas.toDataURL();
    const proj = this.game.city.proj;
    const x1 = g.x0 + g.cols * g.cellSize;
    const y1 = g.y0 + g.rows * g.cellSize;
    const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
      proj.toLngLat(g.x0, y1),
      proj.toLngLat(x1, y1),
      proj.toLngLat(x1, g.y0),
      proj.toLngLat(g.x0, g.y0),
    ];
    const src = map.getSource(ids.overlay) as ImageSource | undefined;
    if (src) {
      src.updateImage({ url, coordinates });
    } else {
      map.addSource(ids.overlay, { type: "image", url, coordinates });
      map.addLayer(
        { id: "mm-overlay-raster", type: "raster", source: ids.overlay, paint: { "raster-opacity": 0.75, "raster-resampling": "linear", "raster-fade-duration": 0 } },
        "mm-footprints-fill",
      );
    }
  }
}

function periodIndex(g: Game, minute: number): number {
  const ps = g.state.periods;
  let p = ps.length - 1;
  for (let i = 0; i < ps.length; i++) if (ps[i].start <= minute) p = i;
  return p;
}

/** Busiest-direction flow on each edge of a route for one hour. */
function linkFlowByEdge(legs: { edge: number }[][], stops: number, linkFlow: Float32Array, hour: number): Map<number, number> {
  const out = new Map<number, number>();
  const m = stops;
  legs.forEach((legEdges, k) => {
    // Direction 0 link k runs stop k -> k+1; direction 1 covers the same stretch as its link m-2-k.
    const f0 = linkFlow[k * 24 + hour] ?? 0;
    const f1 = linkFlow[(m - 1 + (m - 2 - k)) * 24 + hour] ?? 0;
    const f = Math.max(f0, f1);
    for (const l of legEdges) out.set(l.edge, Math.max(out.get(l.edge) ?? 0, f));
  });
  return out;
}

export function loadColour(lf: number): string {
  if (lf < 0.6) return "#3b9c5a";
  if (lf < 0.85) return "#9bbf3a";
  if (lf < 1.0) return "#e5b622";
  if (lf < 1.25) return "#e67a22";
  return "#d13b2f";
}
