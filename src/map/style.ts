import type { StyleSpecification, LayerSpecification } from "maplibre-gl";

export type Theme = "light" | "dark";

interface Palette {
  earth: string;
  park: string;
  wood: string;
  residential: string;
  industrial: string;
  water: string;
  waterLine: string;
  roadMinor: string;
  roadMajor: string;
  roadHighway: string;
  roadCasing: string;
  rail: string;
  building: string;
  buildingTop: string;
  boundary: string;
  label: string;
  labelMuted: string;
  labelHalo: string;
}

const palettes: Record<Theme, Palette> = {
  light: {
    earth: "#eeeeec",
    park: "#dfe7d8",
    wood: "#d7e1cf",
    residential: "#e9e9e6",
    industrial: "#e6e4e1",
    water: "#c6d5e0",
    waterLine: "#b3c5d3",
    roadMinor: "#fbfbfa",
    roadMajor: "#ffffff",
    roadHighway: "#ffffff",
    roadCasing: "#d9d9d5",
    rail: "#c8c8c3",
    building: "#e0dfdb",
    buildingTop: "#e4e3df",
    boundary: "#c4c4bf",
    label: "#5a5a56",
    labelMuted: "#8c8c87",
    labelHalo: "#eeeeec",
  },
  dark: {
    earth: "#17181a",
    park: "#1b221e",
    wood: "#1a211c",
    residential: "#191a1c",
    industrial: "#1b1b1d",
    water: "#131c25",
    waterLine: "#1a2632",
    roadMinor: "#24262a",
    roadMajor: "#2c2e33",
    roadHighway: "#34373c",
    roadCasing: "#17181a",
    rail: "#2a2c30",
    building: "#222326",
    buildingTop: "#26272a",
    boundary: "#33353a",
    label: "#a4a6aa",
    labelMuted: "#6e7075",
    labelHalo: "#17181a",
  },
};

const SRC = "base";
const FONT = ["Noto Sans Regular"];
const FONT_MEDIUM = ["Noto Sans Medium"];

// The basemap stays quiet: no POIs, and no metro, light rail or tram, since the player
// builds the network from scratch.
const notUrbanRail: any = ["!", ["in", ["get", "kind_detail"], ["literal", ["subway", "light_rail", "tram", "monorail", "funicular"]]]];

function layers(c: Palette): LayerSpecification[] {
  const name: any = ["coalesce", ["get", "name"], ["get", "name:en"]];
  return [
    { id: "background", type: "background", paint: { "background-color": c.earth } },
    { id: "earth", type: "fill", source: SRC, "source-layer": "earth", paint: { "fill-color": c.earth } },
    {
      id: "landuse-park",
      type: "fill",
      source: SRC,
      "source-layer": "landuse",
      filter: ["in", ["get", "kind"], ["literal", ["park", "garden", "cemetery", "golf_course", "grass", "meadow", "nature_reserve", "national_park", "protected_area", "recreation_ground", "playground", "village_green", "allotments"]]],
      paint: { "fill-color": c.park },
    },
    {
      id: "landuse-wood",
      type: "fill",
      source: SRC,
      "source-layer": "landuse",
      filter: ["in", ["get", "kind"], ["literal", ["forest", "wood"]]],
      paint: { "fill-color": c.wood },
    },
    {
      id: "landcover-wood",
      type: "fill",
      source: SRC,
      "source-layer": "landcover",
      filter: ["in", ["get", "kind"], ["literal", ["forest"]]],
      paint: { "fill-color": c.wood },
    },
    {
      id: "landuse-industrial",
      type: "fill",
      source: SRC,
      "source-layer": "landuse",
      filter: ["in", ["get", "kind"], ["literal", ["industrial", "railway", "military", "brownfield", "aerodrome", "runway", "apron"]]],
      paint: { "fill-color": c.industrial },
    },
    { id: "water", type: "fill", source: SRC, "source-layer": "water", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": c.water } },
    {
      id: "water-line",
      type: "line",
      source: SRC,
      "source-layer": "water",
      filter: ["==", ["geometry-type"], "LineString"],
      paint: { "line-color": c.waterLine, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.5, 15, 2] },
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
      filter: ["in", ["get", "kind"], ["literal", ["major_road", "highway"]]],
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
        "fill-extrusion-color": ["interpolate", ["linear"], ["coalesce", ["get", "height"], 9], 0, c.building, 120, c.buildingTop],
        "fill-extrusion-height": ["coalesce", ["get", "height"], 9],
        "fill-extrusion-base": ["coalesce", ["get", "min_height"], 0],
        "fill-extrusion-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0, 14, 0.9],
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
      paint: { "text-color": c.labelMuted, "text-halo-color": c.labelHalo, "text-halo-width": 1.2 },
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
  ];
}

export function buildStyle(theme: Theme, basemapUrl: string): StyleSpecification {
  return {
    version: 8,
    glyphs: `${location.origin}${import.meta.env.BASE_URL}fonts/{fontstack}/{range}.pbf`,
    sources: {
      [SRC]: { type: "vector", url: `pmtiles://${basemapUrl}`, attribution: '<a href="https://openstreetmap.org/copyright">© OpenStreetMap</a> · <a href="https://protomaps.com">Protomaps</a>' },
    },
    layers: layers(palettes[theme]),
  };
}

export function paletteFor(theme: Theme): Palette {
  return palettes[theme];
}
