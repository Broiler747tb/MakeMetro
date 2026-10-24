import type { StyleSpecification, LayerSpecification, LightSpecification, SkySpecification } from "maplibre-gl";

export type Theme = "light" | "dark";

interface Palette {
  earth: string;
  residential: string;
  commercial: string;
  industrial: string;
  grass: string;
  park: string;
  wood: string;
  water: string;
  waterEdge: string;
  roadMinor: string;
  roadMajor: string;
  roadCasing: string;
  roadHighway: string;
  highwayCasing: string;
  path: string;
  rail: string;
  buildingLow: string;
  buildingMid: string;
  buildingHigh: string;
  shadow: string;
  shadowOpacity: number;
  hillShadow: string;
  hillHighlight: string;
  boundary: string;
  label: string;
  labelMuted: string;
  labelHalo: string;
  sky: string;
  horizon: string;
}

const palettes: Record<Theme, Palette> = {
  light: {
    earth: "#ecebe6",
    residential: "#e7e5df",
    commercial: "#ebe5df",
    industrial: "#e3e0dc",
    grass: "#dce6cf",
    park: "#cfe0c1",
    wood: "#bed4ae",
    water: "#a8c7dc",
    waterEdge: "#8fb2cb",
    roadMinor: "#ffffff",
    roadMajor: "#ffffff",
    roadCasing: "#d4d2cb",
    roadHighway: "#fbf1dc",
    highwayCasing: "#dcc89f",
    path: "#c9c6bd",
    rail: "#b9b7b0",
    buildingLow: "#d9d6cf",
    buildingMid: "#e2dfd9",
    buildingHigh: "#ece9e4",
    shadow: "#2e3340",
    shadowOpacity: 0.22,
    hillShadow: "#6f6857",
    hillHighlight: "#ffffff",
    boundary: "#c4c2bb",
    label: "#4d4b46",
    labelMuted: "#86837b",
    labelHalo: "#f1f0eb",
    sky: "#d9e4ee",
    horizon: "#eef1f2",
  },
  dark: {
    earth: "#1b1d21",
    residential: "#1d1f24",
    commercial: "#211f24",
    industrial: "#1f2024",
    grass: "#1f2722",
    park: "#1e2a22",
    wood: "#1a2620",
    water: "#0f1d2b",
    waterEdge: "#1c3348",
    roadMinor: "#2a2d33",
    roadMajor: "#353942",
    roadCasing: "#16181b",
    roadHighway: "#45413a",
    highwayCasing: "#16181b",
    path: "#30343a",
    rail: "#34373d",
    buildingLow: "#2b2d33",
    buildingMid: "#32353b",
    buildingHigh: "#3d4048",
    shadow: "#000000",
    shadowOpacity: 0.38,
    hillShadow: "#000000",
    hillHighlight: "#4a5262",
    boundary: "#383b41",
    label: "#b8babe",
    labelMuted: "#7d8086",
    labelHalo: "#1b1d21",
    sky: "#0d1118",
    horizon: "#20252d",
  },
};

const SRC = "base";
const DEM = "dem";
const FONT = ["Noto Sans Regular"];
const FONT_MEDIUM = ["Noto Sans Medium"];

// The sun sits to the south-south-west: buildings are lit from there and throw their shadows
// the other way. Shadows are cast from a lower, late-afternoon sun so they read at city scale.
const SUN_AZIMUTH = 210;
const SUN_FROM_ZENITH = 35;
export const SHADOW_SUN = { azimuth: SUN_AZIMUTH, fromZenith: 45 };
// Solid, so the shadows drawn under the buildings never show through them.
export const BUILDING_OPACITY: any = ["interpolate", ["linear"], ["zoom"], 13, 0, 14, 1];

// The basemap stays quiet: no POIs, and no metro, light rail or tram, since the player
// builds the network from scratch.
const notUrbanRail: any = ["!", ["in", ["get", "kind_detail"], ["literal", ["subway", "light_rail", "tram", "monorail", "funicular"]]]];

function layers(c: Palette, withDem: boolean): LayerSpecification[] {
  const name: any = ["coalesce", ["get", "name"], ["get", "name:en"]];
  const landuse = (id: string, kinds: string[], color: string, minzoom = 0): LayerSpecification => ({
    id,
    type: "fill",
    source: SRC,
    "source-layer": "landuse",
    minzoom,
    filter: ["in", ["get", "kind"], ["literal", kinds]],
    paint: { "fill-color": color },
  });
  const out: LayerSpecification[] = [
    { id: "background", type: "background", paint: { "background-color": c.earth } },
    { id: "earth", type: "fill", source: SRC, "source-layer": "earth", paint: { "fill-color": c.earth } },
    landuse("landuse-residential", ["residential"], c.residential, 11),
    landuse("landuse-commercial", ["commercial", "retail"], c.commercial, 11),
    landuse("landuse-industrial", ["industrial", "railway", "military", "brownfield", "aerodrome", "runway", "apron"], c.industrial),
    landuse("landuse-grass", ["grass", "meadow", "grassland", "village_green", "allotments", "cemetery", "golf_course", "recreation_ground", "playground"], c.grass),
    landuse("landuse-park", ["park", "garden", "nature_reserve", "national_park", "protected_area"], c.park),
    landuse("landuse-wood", ["forest", "wood"], c.wood),
    {
      id: "landcover-wood",
      type: "fill",
      source: SRC,
      "source-layer": "landcover",
      filter: ["in", ["get", "kind"], ["literal", ["forest"]]],
      paint: { "fill-color": c.wood },
    },
  ];
  if (withDem) {
    out.push({
      id: "hillshade",
      type: "hillshade",
      source: DEM,
      paint: {
        "hillshade-exaggeration": 0.45,
        "hillshade-shadow-color": c.hillShadow,
        "hillshade-highlight-color": c.hillHighlight,
        "hillshade-accent-color": c.hillShadow,
        "hillshade-illumination-direction": SUN_AZIMUTH,
        "hillshade-illumination-anchor": "map",
      },
    } as LayerSpecification);
  }
  out.push(
    { id: "water", type: "fill", source: SRC, "source-layer": "water", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": c.water } },
    {
      id: "water-edge",
      type: "line",
      source: SRC,
      "source-layer": "water",
      minzoom: 11,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "line-color": c.waterEdge, "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.4, 16, 1.4] },
    },
    {
      id: "water-line",
      type: "line",
      source: SRC,
      "source-layer": "water",
      filter: ["==", ["geometry-type"], "LineString"],
      paint: { "line-color": c.water, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.6, 15, 2.5] },
    },
    {
      id: "paths",
      type: "line",
      source: SRC,
      "source-layer": "roads",
      minzoom: 15,
      filter: ["==", ["get", "kind"], "path"],
      paint: { "line-color": c.path, "line-width": ["interpolate", ["linear"], ["zoom"], 15, 0.6, 18, 2], "line-dasharray": [2, 1.5] },
    },
    {
      id: "roads-minor-casing",
      type: "line",
      source: SRC,
      "source-layer": "roads",
      minzoom: 14,
      filter: ["in", ["get", "kind"], ["literal", ["minor_road", "other"]]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": c.roadCasing, "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 14, 2.2, 18, 15] },
    },
    {
      id: "roads-minor",
      type: "line",
      source: SRC,
      "source-layer": "roads",
      minzoom: 12,
      filter: ["in", ["get", "kind"], ["literal", ["minor_road", "other"]]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": c.roadMinor, "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 12, 0.4, 15, 3, 18, 12] },
    },
    {
      id: "roads-major-casing",
      type: "line",
      source: SRC,
      "source-layer": "roads",
      minzoom: 11,
      filter: ["==", ["get", "kind"], "major_road"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": c.roadCasing, "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 11, 1.2, 15, 7, 18, 22] },
    },
    {
      id: "roads-major",
      type: "line",
      source: SRC,
      "source-layer": "roads",
      filter: ["==", ["get", "kind"], "major_road"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": c.roadMajor, "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 8, 0.4, 15, 5, 18, 18] },
    },
    {
      id: "roads-highway-casing",
      type: "line",
      source: SRC,
      "source-layer": "roads",
      minzoom: 9,
      filter: ["==", ["get", "kind"], "highway"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": c.highwayCasing, "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 9, 1.4, 15, 8, 18, 24] },
    },
    {
      id: "roads-highway",
      type: "line",
      source: SRC,
      "source-layer": "roads",
      filter: ["==", ["get", "kind"], "highway"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": c.roadHighway, "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 7, 0.6, 15, 6, 18, 20] },
    },
    {
      id: "rail",
      type: "line",
      source: SRC,
      "source-layer": "roads",
      minzoom: 10,
      filter: ["all", ["==", ["get", "kind"], "rail"], notUrbanRail],
      paint: { "line-color": c.rail, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.5, 16, 2], "line-dasharray": [3, 2] },
    },
    {
      id: "boundaries",
      type: "line",
      source: SRC,
      "source-layer": "boundaries",
      filter: ["<=", ["get", "kind_detail"], 4],
      paint: { "line-color": c.boundary, "line-width": 0.8, "line-dasharray": [4, 3] },
    },
    {
      id: "buildings",
      type: "fill-extrusion",
      source: SRC,
      "source-layer": "buildings",
      minzoom: 13,
      paint: {
        "fill-extrusion-color": ["interpolate", ["linear"], ["coalesce", ["get", "height"], 9], 0, c.buildingLow, 40, c.buildingMid, 150, c.buildingHigh],
        "fill-extrusion-height": ["coalesce", ["get", "height"], 9],
        "fill-extrusion-base": ["coalesce", ["get", "min_height"], 0],
        "fill-extrusion-opacity": BUILDING_OPACITY,
        "fill-extrusion-vertical-gradient": true,
      },
    },
    {
      id: "water-labels",
      type: "symbol",
      source: SRC,
      "source-layer": "water",
      minzoom: 12,
      filter: ["has", "name"],
      layout: { "text-field": name, "text-font": ["Noto Sans Italic"], "text-size": 12, "symbol-placement": "line", "symbol-spacing": 400 },
      paint: { "text-color": c.waterEdge, "text-halo-color": c.labelHalo, "text-halo-width": 1.2 },
    },
    {
      id: "road-labels",
      type: "symbol",
      source: SRC,
      "source-layer": "roads",
      minzoom: 14,
      filter: ["all", ["has", "name"], ["in", ["get", "kind"], ["literal", ["major_road", "minor_road", "highway"]]]],
      layout: { "text-field": name, "text-font": FONT, "text-size": 11, "symbol-placement": "line", "symbol-spacing": 350 },
      paint: { "text-color": c.labelMuted, "text-halo-color": c.labelHalo, "text-halo-width": 1.2 },
    },
    {
      id: "place-labels",
      type: "symbol",
      source: SRC,
      "source-layer": "places",
      // OSM has many placeholder "Квартал 532"-style blocks in Moscow; they're noise on a city map.
      filter: [
        "all",
        ["in", ["get", "kind"], ["literal", ["locality", "neighbourhood", "macrohood"]]],
        ["<=", ["coalesce", ["get", "min_zoom"], 0], ["+", ["zoom"], 0.5]],
        ["!=", ["index-of", "квартал", ["downcase", ["coalesce", ["get", "name"], ""]]], 0],
      ],
      layout: {
        "text-field": name,
        "text-font": FONT_MEDIUM,
        "text-size": ["interpolate", ["linear"], ["zoom"], 9, 11, 14, 14],
        "text-transform": "uppercase",
        "text-letter-spacing": 0.06,
        "text-max-width": 8,
      },
      paint: { "text-color": c.label, "text-halo-color": c.labelHalo, "text-halo-width": 1.4 },
    },
  );
  return out;
}

export function lightFor(theme: Theme): LightSpecification {
  return { anchor: "map", position: [1.15, SUN_AZIMUTH, SUN_FROM_ZENITH], color: "#ffffff", intensity: theme === "dark" ? 0.3 : 0.4 };
}

export function shadowFor(theme: Theme): { color: string; opacity: number } {
  const c = palettes[theme];
  return { color: c.shadow, opacity: c.shadowOpacity };
}

export function skyFor(theme: Theme): SkySpecification {
  const c = palettes[theme];
  return {
    "sky-color": c.sky,
    "horizon-color": c.horizon,
    "fog-color": c.earth,
    "sky-horizon-blend": 0.7,
    "horizon-fog-blend": 0.8,
    "fog-ground-blend": 0.75,
    "atmosphere-blend": 0,
  };
}

export interface StyleSources {
  basemap: string; // pmtiles:// URL
  dem?: { tiles: string; encoding: "terrarium" | "mapbox"; minzoom: number; maxzoom: number };
  bounds: [number, number, number, number];
}

export function buildStyle(theme: Theme, src: StyleSources): StyleSpecification {
  const sources: StyleSpecification["sources"] = {
    [SRC]: { type: "vector", url: src.basemap, attribution: '<a href="https://openstreetmap.org/copyright">© OpenStreetMap</a> · <a href="https://protomaps.com">Protomaps</a>' },
  };
  if (src.dem) {
    // The pack only has terrain for the city itself.
    sources[DEM] = { type: "raster-dem", tiles: [src.dem.tiles], encoding: src.dem.encoding, tileSize: 256, minzoom: src.dem.minzoom, maxzoom: src.dem.maxzoom, bounds: src.bounds };
  }
  return {
    version: 8,
    glyphs: `${location.origin}${import.meta.env.BASE_URL}fonts/{fontstack}/{range}.pbf`,
    light: lightFor(theme),
    sky: skyFor(theme),
    sources,
    layers: layers(palettes[theme], !!src.dem),
  };
}

/** The same layers with another theme's colours, for switching without rebuilding the map. */
export function themedLayers(theme: Theme, withDem: boolean): LayerSpecification[] {
  return layers(palettes[theme], withDem);
}
