import type { StyleSpecification, LayerSpecification, LightSpecification, SkySpecification } from "maplibre-gl";

export type Theme = "light" | "dark";

interface Palette {
  earth: string;
  residential: string;
  commercial: string;
  industrial: string;
  civic: string;
  hospital: string;
  plaza: string;
  grass: string;
  park: string;
  wood: string;
  scrub: string;
  cemetery: string;
  pitch: string;
  farmland: string;
  sand: string;
  water: string;
  waterEdge: string;
  waterLabel: string;
  roadMinor: string;
  roadMajor: string;
  roadPrimary: string;
  roadCasing: string;
  primaryCasing: string;
  roadHighway: string;
  highwayCasing: string;
  roadOverview: string;
  primaryOverview: string;
  highwayOverview: string;
  roadPedestrian: string;
  pedestrianCasing: string;
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
    earth: "#e8e6e0",
    residential: "#e6e3dc",
    commercial: "#e8e4df",
    industrial: "#e1dfdc",
    civic: "#eae5d9",
    hospital: "#e9e3e1",
    plaza: "#f1eee7",
    grass: "#d2e0c4",
    park: "#dbe2cc",
    wood: "#bbd1b2",
    scrub: "#ccd9be",
    cemetery: "#cddccf",
    pitch: "#cadfcf",
    farmland: "#e8e5d0",
    sand: "#efe5d0",
    water: "#a8c4d6",
    waterEdge: "#90aec3",
    waterLabel: "#476479",
    roadMinor: "#f7f6f2",
    roadMajor: "#faf8f4",
    roadPrimary: "#faf5e8",
    roadCasing: "#cbc9c2",
    primaryCasing: "#cbc3b3",
    roadHighway: "#f6ead4",
    highwayCasing: "#cdbb9e",
    roadOverview: "#cbc9c2",
    primaryOverview: "#cbc3b3",
    highwayOverview: "#cdbb9e",
    roadPedestrian: "#f1eee7",
    pedestrianCasing: "#d7d2c9",
    path: "#f5f3ef",
    rail: "#b2b1ab",
    buildingLow: "#d3cec4",
    buildingMid: "#dcd8cf",
    buildingHigh: "#ecebe8",
    shadow: "#2b303c",
    shadowOpacity: 0.24,
    hillShadow: "#857f70",
    hillHighlight: "#faf9f5",
    boundary: "#bdbab3",
    label: "#4a4842",
    labelMuted: "#76736b",
    labelHalo: "#efede7",
    sky: "#d7e2ec",
    horizon: "#e9e9e4",
  },
  dark: {
    earth: "#1b1d21",
    residential: "#1d1f23",
    commercial: "#201f22",
    industrial: "#1e2123",
    civic: "#21211f",
    hospital: "#211f22",
    plaza: "#232528",
    grass: "#1d2921",
    park: "#1e2620",
    wood: "#19251e",
    scrub: "#1e261f",
    cemetery: "#1d2523",
    pitch: "#1d2a25",
    farmland: "#21211d",
    sand: "#252320",
    water: "#0c1b28",
    waterEdge: "#1c3346",
    waterLabel: "#6b8ba2",
    roadMinor: "#2b2e33",
    roadMajor: "#353941",
    roadPrimary: "#3b4047",
    roadCasing: "#121417",
    primaryCasing: "#121417",
    roadHighway: "#4c4438",
    highwayCasing: "#161310",
    roadOverview: "#33363d",
    primaryOverview: "#3b4047",
    highwayOverview: "#4c4438",
    roadPedestrian: "#282a2e",
    pedestrianCasing: "#181a1c",
    path: "#33353a",
    rail: "#3e4046",
    buildingLow: "#26282e",
    buildingMid: "#31343b",
    buildingHigh: "#444852",
    shadow: "#04060a",
    shadowOpacity: 0.32,
    hillShadow: "#000000",
    hillHighlight: "#454d5c",
    boundary: "#41444b",
    label: "#b8babe",
    labelMuted: "#83868c",
    labelHalo: "#1b1d21",
    sky: "#0c1017",
    horizon: "#1e232b",
  },
};

const SRC = "base";
const DEM = "dem";
const FONT = ["Noto Sans Regular"];
const FONT_MEDIUM = ["Noto Sans Medium"];
const FONT_ITALIC = ["Noto Sans Italic"];

// The sun sits to the south-south-west: buildings are lit from there and throw their shadows
// the other way. Shadows are cast from a lower, late-afternoon sun so they read at city scale.
const SUN_AZIMUTH = 210;
const SUN_FROM_ZENITH = 40;
export const SHADOW_SUN = { azimuth: SUN_AZIMUTH, fromZenith: 45 };
// Solid, so the shadows drawn under the buildings never show through them.
export const BUILDING_OPACITY: any = ["interpolate", ["linear"], ["zoom"], 13, 0, 14, 1];

const kind: any = ["get", "kind"];
const detail: any = ["get", "kind_detail"];
const notTunnel: any = ["!=", ["get", "is_tunnel"], true];
const isBridge: any = ["==", ["get", "is_bridge"], true];
// Protomaps marks driveways and parking aisles to appear one zoom later than the street they hang off.
const dueAtZoom: any = ["<=", ["coalesce", ["get", "min_zoom"], 0], ["zoom"]];

// Every street sorted into one of seven classes, lowest first.
const ROAD_CLASS: any = [
  "match",
  kind,
  "highway",
  "trunk",
  "major_road",
  ["match", detail, ["trunk", "trunk_link"], "trunk", ["primary", "primary_link"], "primary", ["secondary", "secondary_link"], "secondary", "tertiary"],
  "minor_road",
  ["match", detail, ["service", "driveway", "alley", "parking_aisle"], "service", "minor"],
  "path",
  "pedestrian",
  "minor",
];
const isStreet: any = [
  "any",
  ["in", kind, ["literal", ["highway", "major_road", "minor_road"]]],
  // "other" also holds stray lamp posts and platforms drawn as lines.
  ["all", ["==", kind, "other"], ["==", detail, "living_street"]],
  ["all", ["==", kind, "path"], ["==", detail, "pedestrian"]],
];

// Carriageway widths in pixels. Up to z15 they are cartographic; from z16 they double with each
// zoom like the map itself, at roughly half the real width (0.67 m per pixel at z16 in Moscow), so
// streets keep pace with the extruded buildings instead of thinning to hairlines between them.
const ROAD_ZOOMS = [8, 10, 12, 14, 15, 16, 18, 19];
const ROAD_WIDTHS: Record<string, number[]> = {
  trunk: [0.8, 1.4, 2.4, 4.6, 7, 13, 52, 104],
  primary: [0.5, 1.1, 2, 4, 6, 12, 48, 96],
  secondary: [0, 0.6, 1.4, 3.2, 5, 10, 40, 80],
  tertiary: [0, 0.4, 1, 2.6, 4.2, 8.5, 34, 68],
  minor: [0, 0, 0.4, 1.6, 3, 6.5, 27, 54],
  pedestrian: [0, 0, 0, 1.4, 2.6, 6, 24, 48],
  service: [0, 0, 0, 0.8, 1.5, 3.5, 15, 30],
};
// How far a casing shows beyond each side of its road. Below z12 streets are single lines.
const CASING_EDGE = [0, 0, 0.4, 0.6, 0.7, 0.9, 1.4, 1.8];

function roadWidth(casing: boolean): any {
  const link: any = ["case", ["==", ["get", "is_link"], true], 0.6, 1];
  const stops: any[] = [];
  ROAD_ZOOMS.forEach((z, i) => {
    const byClass: any[] = ["match", ROAD_CLASS];
    for (const [cls, w] of Object.entries(ROAD_WIDTHS)) byClass.push(cls, w[i] === 0 ? 0 : ["+", ["*", link, w[i]], casing ? 2 * CASING_EDGE[i] : 0]);
    byClass.push(0);
    stops.push(z, byClass);
  });
  return ["interpolate", ["exponential", 2], ["zoom"], ...stops];
}

const roadLayout: any = {
  "line-cap": "round",
  "line-join": "round",
  "line-sort-key": ["match", ROAD_CLASS, "service", 0, "pedestrian", 1, "minor", 2, "tertiary", 3, "secondary", 4, "primary", 5, 6],
};

function roadColour(c: Palette): any {
  return ["match", ROAD_CLASS, "trunk", c.roadHighway, "primary", c.roadPrimary, ["secondary", "tertiary"], c.roadMajor, "pedestrian", c.roadPedestrian, c.roadMinor];
}

function casingColour(c: Palette): any {
  return ["match", ROAD_CLASS, "trunk", c.highwayCasing, "primary", c.primaryCasing, "pedestrian", c.pedestrianCasing, c.roadCasing];
}

// Zoomed out, streets are single quiet lines (a shade darker than the ground in the light theme);
// from z13 they open up into pale, cased carriageways.
function streetColour(c: Palette): any {
  const overview: any = ["match", ROAD_CLASS, "trunk", c.highwayOverview, "primary", c.primaryOverview, c.roadOverview];
  return ["interpolate", ["linear"], ["zoom"], 12, overview, 13.5, roadColour(c)];
}
const casingFadeIn: any = ["interpolate", ["linear"], ["zoom"], 12, 0, 13.5, 1];

// The basemap stays quiet: no POIs, and no metro, light rail or tram, since the player
// builds the network from scratch. Only main-line rail is drawn, with yards and sidings lighter.
const railMain: any = ["all", ["==", kind, "rail"], ["in", detail, ["literal", ["rail", "narrow_gauge", "preserved"]]], ["!", ["has", "service"]], notTunnel];
const railService: any = [
  "all",
  ["==", kind, "rail"],
  ["any", ["in", detail, ["literal", ["yard", "spur", "siding"]]], ["all", ["==", detail, "rail"], ["has", "service"]]],
  notTunnel,
];

function layers(c: Palette, withDem: boolean): LayerSpecification[] {
  const name: any = ["coalesce", ["get", "name"], ["get", "name:en"]];
  const landuse = (id: string, kinds: string[], color: string, minzoom = 0, outline?: string): LayerSpecification => ({
    id,
    type: "fill",
    source: SRC,
    "source-layer": "landuse",
    minzoom,
    filter: ["in", kind, ["literal", kinds]],
    paint: outline ? { "fill-color": color, "fill-outline-color": outline } : { "fill-color": color },
  });
  const out: LayerSpecification[] = [
    { id: "background", type: "background", paint: { "background-color": c.earth } },
    { id: "earth", type: "fill", source: SRC, "source-layer": "earth", paint: { "fill-color": c.earth } },
    // Whole districts and grounds first, then what lies inside them: lawns, woods and pitches in
    // parks and school yards, squares in the middle of blocks.
    landuse("landuse-residential", ["residential"], c.residential, 11),
    landuse("landuse-commercial", ["commercial", "retail"], c.commercial, 11),
    landuse("landuse-industrial", ["industrial", "railway", "military", "brownfield", "aerodrome", "runway", "apron", "dam"], c.industrial),
    landuse("landuse-civic", ["school", "kindergarten", "college", "university"], c.civic, 12),
    landuse("landuse-hospital", ["hospital"], c.hospital, 12),
    landuse("landuse-farmland", ["farmland", "allotments"], c.farmland),
    landuse("landuse-cemetery", ["cemetery"], c.cemetery),
    landuse("landuse-park", ["park", "garden", "nature_reserve", "national_park", "protected_area", "zoo", "golf_course", "recreation_ground"], c.park),
    landuse("landuse-wood", ["forest", "wood"], c.wood),
    landuse("landuse-scrub", ["scrub", "wetland"], c.scrub),
    landuse("landuse-grass", ["grass", "meadow", "grassland", "village_green", "playground", "dog_park"], c.grass),
    landuse("landuse-pitch", ["pitch"], c.pitch, 13),
    landuse("landuse-sand", ["beach", "sand"], c.sand),
    landuse("landuse-plaza", ["pedestrian", "pier"], c.plaza, 13, c.pedestrianCasing),
    landuse("landuse-platform", ["platform"], c.plaza, 14, c.roadCasing),
    {
      id: "landcover-wood",
      type: "fill",
      source: SRC,
      "source-layer": "landcover",
      filter: ["in", kind, ["literal", ["forest"]]],
      paint: { "fill-color": c.wood },
    },
  ];
  if (withDem) {
    out.push({
      id: "hillshade",
      type: "hillshade",
      source: DEM,
      paint: {
        // Shades only the slopes turned from the sun, leaving flat ground and its colours alone. The
        // terrain is 30 m data that picks up the city itself as noise, so it fades once the view is
        // closer than the river valleys and the Vorobyovy Gory.
        "hillshade-method": "igor",
        "hillshade-exaggeration": ["interpolate", ["linear"], ["zoom"], 10, 0.5, 12, 0.3, 13.5, 0.12, 16, 0.06],
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
      // A soft band just inside the shore, like the shade under an embankment wall. Kept narrower
      // than the tiles' 16 px clip buffer so polygon seams at tile edges never show.
      id: "water-bank",
      type: "line",
      source: SRC,
      "source-layer": "water",
      minzoom: 12,
      filter: ["all", ["==", ["geometry-type"], "Polygon"], ["!", ["in", kind, ["literal", ["swimming_pool", "fountain"]]]]],
      paint: {
        "line-color": c.waterEdge,
        "line-opacity": 0.4,
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1.5, 15, 4, 18, 10],
        "line-offset": ["interpolate", ["linear"], ["zoom"], 12, 0.75, 15, 2, 18, 5],
        "line-blur": ["interpolate", ["linear"], ["zoom"], 12, 0.75, 15, 2, 18, 5],
      },
    },
    {
      id: "water-edge",
      type: "line",
      source: SRC,
      "source-layer": "water",
      minzoom: 11,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "line-color": c.waterEdge, "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.4, 14, 0.8, 16, 1.2, 18, 1.8] },
    },
    {
      // Moscow's buried rivers and brooks (the Neglinnaya, the Presnya...) carry a negative layer from
      // z14; below that the tiles cannot tell, so brooks wait until then.
      id: "water-line",
      type: "line",
      source: SRC,
      "source-layer": "water",
      filter: [
        "all",
        ["==", ["geometry-type"], "LineString"],
        [">=", ["coalesce", ["get", "layer"], 0], 0],
        ["any", ["in", kind, ["literal", ["river", "canal"]]], [">=", ["zoom"], 14]],
      ],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": c.water,
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          10,
          ["match", kind, ["river", "canal"], 0.8, 0.3],
          15,
          ["match", kind, ["river", "canal"], 3, "stream", 1.4, 0.8],
          18,
          ["match", kind, ["river", "canal"], 8, "stream", 3.5, 1.6],
        ],
      },
    },
    {
      // Road tunnels as faint dashed edges; minor and service tunnels are left out.
      id: "roads-tunnel",
      type: "line",
      source: SRC,
      "source-layer": "roads",
      minzoom: 13,
      filter: ["all", ["==", ["get", "is_tunnel"], true], ["in", ROAD_CLASS, ["literal", ["trunk", "primary", "secondary", "tertiary"]]]],
      paint: { "line-color": c.roadCasing, "line-width": 0.8, "line-gap-width": roadWidth(false), "line-dasharray": [4, 3] },
    },
    {
      id: "paths",
      type: "line",
      source: SRC,
      "source-layer": "roads",
      minzoom: 15,
      filter: ["all", ["==", kind, "path"], ["in", detail, ["literal", ["footway", "path", "cycleway", "track", "bridleway"]]], notTunnel],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": c.path, "line-width": ["interpolate", ["exponential", 2], ["zoom"], 15, 0.6, 16, 1.1, 18, 5, 19, 9] },
    },
    {
      id: "paths-steps",
      type: "line",
      source: SRC,
      "source-layer": "roads",
      minzoom: 16,
      filter: ["all", ["==", kind, "path"], ["==", detail, "steps"], notTunnel],
      paint: { "line-color": c.path, "line-width": ["interpolate", ["exponential", 2], ["zoom"], 16, 2, 18, 6, 19, 10], "line-dasharray": [0.3, 0.3] },
    },
    {
      id: "roads-casing",
      type: "line",
      source: SRC,
      "source-layer": "roads",
      minzoom: 12,
      filter: ["all", isStreet, notTunnel, ["!", isBridge], dueAtZoom],
      layout: roadLayout,
      paint: { "line-color": casingColour(c), "line-width": roadWidth(true), "line-opacity": casingFadeIn },
    },
    {
      id: "roads",
      type: "line",
      source: SRC,
      "source-layer": "roads",
      filter: ["all", isStreet, notTunnel, ["!", isBridge], dueAtZoom],
      layout: roadLayout,
      paint: { "line-color": streetColour(c), "line-width": roadWidth(false) },
    },
    {
      id: "rail",
      type: "line",
      source: SRC,
      "source-layer": "roads",
      minzoom: 10,
      filter: ["any", railMain, ["all", railService, [">=", ["zoom"], 13]]],
      paint: {
        "line-color": c.rail,
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.6, 14, ["case", railService, 0.6, 1.1], 18, ["case", railService, 1.2, 2.2]],
      },
    },
    {
      // Sleepers, so main lines read as track rather than as one more grey street.
      id: "rail-ties",
      type: "line",
      source: SRC,
      "source-layer": "roads",
      minzoom: 15,
      filter: railMain,
      paint: { "line-color": c.rail, "line-width": ["interpolate", ["exponential", 2], ["zoom"], 15, 4, 18, 9, 19, 14], "line-dasharray": [0.2, 1.8] },
    },
    {
      id: "bridges-casing",
      type: "line",
      source: SRC,
      "source-layer": "roads",
      minzoom: 13,
      filter: ["all", isStreet, isBridge, dueAtZoom],
      layout: roadLayout,
      paint: { "line-color": casingColour(c), "line-width": roadWidth(true), "line-opacity": casingFadeIn },
    },
    {
      id: "bridges",
      type: "line",
      source: SRC,
      "source-layer": "roads",
      minzoom: 13,
      filter: ["all", isStreet, isBridge, dueAtZoom],
      layout: roadLayout,
      paint: { "line-color": streetColour(c), "line-width": roadWidth(false) },
    },
    {
      id: "boundaries",
      type: "line",
      source: SRC,
      "source-layer": "boundaries",
      maxzoom: 14,
      filter: ["<=", detail, 4],
      paint: {
        "line-color": c.boundary,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.8, 13, 1.4],
        "line-dasharray": [5, 2, 1, 2],
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 12, 1, 14, 0],
      },
    },
    {
      id: "buildings",
      type: "fill-extrusion",
      source: SRC,
      "source-layer": "buildings",
      minzoom: 13,
      // Softened corners, small enough that kiosks keep their shape.
      layout: { "fill-extrusion-rounded-corner-distance": 0.7 },
      paint: {
        "fill-extrusion-color": ["interpolate", ["linear"], ["coalesce", ["get", "height"], 9], 0, c.buildingLow, 40, c.buildingMid, 150, c.buildingHigh],
        "fill-extrusion-height": ["coalesce", ["get", "height"], 9],
        "fill-extrusion-base": ["coalesce", ["get", "min_height"], 0],
        "fill-extrusion-opacity": BUILDING_OPACITY,
        "fill-extrusion-vertical-gradient": true,
      },
    },
    {
      // Rivers and canals along their course; buried rivers are left unnamed.
      id: "water-labels",
      type: "symbol",
      source: SRC,
      "source-layer": "water",
      minzoom: 12,
      filter: [
        "all",
        ["==", ["geometry-type"], "LineString"],
        ["has", "name"],
        [">=", ["coalesce", ["get", "layer"], 0], 0],
        ["any", ["in", kind, ["literal", ["river", "canal"]]], [">=", ["zoom"], 15]],
      ],
      layout: {
        "text-field": name,
        "text-font": FONT_ITALIC,
        "text-size": ["interpolate", ["linear"], ["zoom"], 12, 11, 16, 13],
        "text-letter-spacing": 0.08,
        "symbol-placement": "line",
        "symbol-spacing": 500,
        "text-max-angle": 25,
      },
      paint: { "text-color": c.waterLabel, "text-halo-color": ["match", kind, ["river", "canal"], c.water, c.labelHalo], "text-halo-width": 1 },
    },
    {
      // Ponds and lakes, from their label points.
      id: "water-point-labels",
      type: "symbol",
      source: SRC,
      "source-layer": "water",
      minzoom: 13,
      filter: [
        "all",
        ["==", ["geometry-type"], "Point"],
        ["has", "name"],
        ["in", kind, ["literal", ["water", "lake", "bay", "reservoir", "basin"]]],
        ["<=", ["coalesce", ["get", "min_zoom"], 0], ["+", ["zoom"], 1]],
      ],
      layout: { "text-field": name, "text-font": FONT_ITALIC, "text-size": 11.5, "text-max-width": 7, "text-letter-spacing": 0.04 },
      paint: { "text-color": c.waterLabel, "text-halo-color": c.water, "text-halo-width": 1 },
    },
    {
      id: "road-labels",
      type: "symbol",
      source: SRC,
      "source-layer": "roads",
      minzoom: 13,
      filter: [
        "all",
        ["has", "name"],
        isStreet,
        notTunnel,
        ["any", ["in", ROAD_CLASS, ["literal", ["trunk", "primary", "secondary", "tertiary"]]], [">=", ["zoom"], 15]],
      ],
      layout: {
        "text-field": name,
        "text-font": FONT,
        "text-size": ["interpolate", ["linear"], ["zoom"], 13, 10, 16, 11.5, 18, 13],
        "text-letter-spacing": 0.02,
        "symbol-placement": "line",
        "symbol-spacing": 300,
        "text-max-angle": 30,
        "symbol-sort-key": ["match", ROAD_CLASS, "trunk", 0, "primary", 1, "secondary", 2, "tertiary", 3, 4],
      },
      paint: { "text-color": c.labelMuted, "text-halo-color": c.labelHalo, "text-halo-width": 1.2 },
    },
    {
      id: "place-labels",
      type: "symbol",
      source: SRC,
      "source-layer": "places",
      // OSM has many placeholder "Квартал 532"-style blocks and housing-estate names in Moscow;
      // they're noise on a city map, and so is the city's own name once inside it.
      filter: [
        "all",
        ["in", kind, ["literal", ["locality", "neighbourhood", "macrohood"]]],
        ["<=", ["coalesce", ["get", "min_zoom"], 0], ["+", ["zoom"], ["match", detail, "suburb", 1.5, 0.5]]],
        ["!=", ["index-of", "квартал", ["downcase", ["coalesce", ["get", "name"], ""]]], 0],
        ["!", ["in", "жилой комплекс", ["downcase", ["coalesce", ["get", "name"], ""]]]],
        ["any", ["!=", detail, "city"], ["<", ["zoom"], 10]],
      ],
      layout: {
        "text-field": name,
        "text-font": ["match", detail, "suburb", ["literal", FONT_MEDIUM], ["literal", FONT]],
        "text-size": ["interpolate", ["linear"], ["zoom"], 10, ["match", detail, "suburb", 11.5, 10.5], 14, ["match", detail, "suburb", 15, 12.5]],
        "text-transform": ["match", detail, "suburb", "uppercase", "none"],
        "text-letter-spacing": ["match", detail, "suburb", 0.1, 0.02],
        "text-max-width": 8,
        "symbol-sort-key": ["match", detail, ["city", "suburb"], 0, "neighbourhood", 1, 2],
      },
      paint: {
        "text-color": ["match", detail, ["city", "suburb"], c.label, c.labelMuted],
        "text-halo-color": c.labelHalo,
        "text-halo-width": 1.6,
        "text-halo-blur": 0.4,
      },
    },
  );
  return out;
}

export function lightFor(theme: Theme): LightSpecification {
  return { anchor: "map", position: [1.15, SUN_AZIMUTH, SUN_FROM_ZENITH], color: "#ffffff", intensity: theme === "dark" ? 0.36 : 0.45 };
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
