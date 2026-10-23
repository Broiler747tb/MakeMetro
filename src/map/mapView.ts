import { Map as MapLibre, addProtocol, setWorkerUrl, AttributionControl, type LayerSpecification } from "maplibre-gl";
import { PMTiles, Protocol } from "pmtiles";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre finds its worker relative to its own module, which bundling breaks; point at it directly.
import maplibreWorker from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import type { City } from "../city/pack";
import { KeptSource } from "../city/store";
import { buildStyle, lightFor, skyFor, themedLayers, type Theme } from "./style";

const pmtiles = new Protocol();
let protocolsReady = false;
let keptCity: City | null = null;

function setupProtocols() {
  if (protocolsReady) return;
  setWorkerUrl(maplibreWorker);
  addProtocol("pmtiles", pmtiles.tile);
  // Terrain tiles come from the kept copy of the city when there is one.
  addProtocol("kept", async (params, abort) => {
    const url = params.url.slice("kept://".length);
    if (!keptCity) throw new Error("no city");
    return { data: await keptCity.store.fetchKept(url, abort.signal) };
  });
  protocolsReady = true;
}

export function createMap(container: HTMLElement, city: City, theme: Theme, reducedMotion: boolean): MapLibre {
  setupProtocols();
  keptCity = city;
  const source = new KeptSource(city.store, city.manifest.basemap);
  pmtiles.add(new PMTiles(source));
  // Joined as text: going through URL would escape the {z}/{x}/{y} placeholders.
  const dem = city.manifest.dem ? { ...city.manifest.dem, tiles: `kept://${city.store.url("")}${city.manifest.dem.tiles}` } : undefined;
  const [w, s, e, n] = city.manifest.bbox;
  const map = new MapLibre({
    container,
    style: buildStyle(theme, { basemap: `pmtiles://${source.getKey()}`, dem, bounds: city.manifest.bbox }),
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
    fadeDuration: reducedMotion ? 0 : 150,
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
  for (const layer of themedLayers(theme, !!map.getSource("dem")) as LayerSpecification[]) {
    if (!map.getLayer(layer.id)) continue;
    const paint = (layer as { paint?: Record<string, unknown> }).paint ?? {};
    for (const [k, v] of Object.entries(paint)) map.setPaintProperty(layer.id, k as Parameters<MapLibre["setPaintProperty"]>[1], v as Parameters<MapLibre["setPaintProperty"]>[2]);
  }
  map.setLight(lightFor(theme));
  map.setSky(skyFor(theme));
}
