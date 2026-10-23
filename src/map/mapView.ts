import { Map as MapLibre, addProtocol, setWorkerUrl, AttributionControl, type LayerSpecification } from "maplibre-gl";
import { Protocol } from "pmtiles";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre finds its worker relative to its own module, which bundling breaks; point at it directly.
import maplibreWorker from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import type { City } from "../city/pack";
import { buildStyle, type Theme } from "./style";

let protocolReady = false;

export function createMap(container: HTMLElement, city: City, theme: Theme, reducedMotion: boolean): MapLibre {
  if (!protocolReady) {
    setWorkerUrl(maplibreWorker);
    const protocol = new Protocol();
    addProtocol("pmtiles", protocol.tile);
    protocolReady = true;
  }
  const basemap = new URL(city.baseUrl + city.manifest.basemap, location.href).href;
  const [w, s, e, n] = city.manifest.bbox;
  const map = new MapLibre({
    container,
    style: buildStyle(theme, basemap),
    center: city.manifest.center,
    zoom: 11,
    pitch: 0,
    maxPitch: 75,
    maxBounds: [
      [w - 0.3, s - 0.2],
      [e + 0.3, n + 0.2],
    ],
    minZoom: 8,
    maxZoom: 19,
    attributionControl: false,
    fadeDuration: reducedMotion ? 0 : 200,
    canvasContextAttributes: { antialias: true },
  });
  map.addControl(
    new AttributionControl({
      compact: true,
      customAttribution: city.manifest.attribution.filter((a) => !/OpenStreetMap|Protomaps/i.test(a)),
    }),
    "bottom-right",
  );
  return map;
}

/** Switches the basemap colours without rebuilding the style, so game layers stay put. */
export function applyTheme(map: MapLibre, theme: Theme) {
  const fresh = buildStyle(theme, "pmtiles://unused").layers as LayerSpecification[];
  for (const layer of fresh) {
    if (!map.getLayer(layer.id)) continue;
    const paint = (layer as { paint?: Record<string, unknown> }).paint ?? {};
    for (const [k, v] of Object.entries(paint)) map.setPaintProperty(layer.id, k as Parameters<MapLibre["setPaintProperty"]>[1], v as Parameters<MapLibre["setPaintProperty"]>[2]);
  }
}
