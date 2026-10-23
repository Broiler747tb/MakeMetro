import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ensureBasemap } from "./basemap";
import { applyParts, assembleBuildings, BuildingIndex, estimateFloorArea } from "./buildings";
import { cachePath } from "./cache";
import { collectFeatures } from "./collect";
import { loadConfig } from "./config";
import { distributeAttractions, distributeJobs, distributeResidents } from "./demand";
import { Elevation } from "./elevation";
import { Grid, GRID_LAYERS } from "./grid";
import { classifyBuildings, paintLand } from "./landuse";
import { buildNames } from "./names";
import { distributeNature } from "./nature";
import { writeBuildings, writeGrid, writeJson, writeNames } from "./pack";
import { OUTPUT_DIR, ROOT } from "./paths";
import { loadPopulation } from "./population";
import { writePreview } from "./preview";
import { projectionFor, toLocal } from "./projection";
import { fillBuilt, fillElevation, fillWater } from "./surface";
import { WorldPixels } from "./tiles";
import { KIND_CODE, POI_WEIGHTS } from "./weights";

/** Landuse and water rasters have this many pixels along each grid cell side. */
const RASTER_SUBDIVISIONS = 25;

const ATTRIBUTION = [
  "© OpenStreetMap contributors",
  "Protomaps",
  "GHSL – European Commission, JRC",
  "Terrain Tiles: Mapzen et al.",
];

const timings: [string, number][] = [];

async function step<T>(label: string, run: () => T | Promise<T>): Promise<T> {
  const t0 = performance.now();
  console.log(`${label}...`);
  const result = await run();
  timings.push([label, (performance.now() - t0) / 1000]);
  return result;
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const mb = (path: string) => `${(statSync(path).size / 1e6).toFixed(1)} MB`;

async function main() {
  const args = process.argv.slice(2);
  const id = args.find((a) => !a.startsWith("--"));
  if (!id) {
    console.error("Usage: npm run city -- <id> [--refresh-basemap]");
    process.exit(1);
  }
  const config = loadConfig(id);
  const proj = projectionFor(config.bbox);
  const [w, s, e, n] = config.bbox;
  const [x0, y0] = toLocal(proj, w, s);
  const [x1, y1] = toLocal(proj, e, n);
  const bounds: [number, number, number, number] = [x0, y0, x1, y1];
  // The projection origin is the bbox centre.
  const centre = config.centre ? toLocal(proj, ...config.centre) : ([0, 0] as [number, number]);
  const grid = new Grid(x0, y0, x1 - x0, y1 - y0, config.cellSize);
  const world = new WorldPixels(proj, config.maxzoom);

  const basemap = await step("Basemap", () => ensureBasemap(config, args.includes("--refresh-basemap")));
  const population = await step("Population", () => loadPopulation(config.bbox));
  const elevation = await step("Elevation", () => Elevation.load(config.bbox));

  const features = await step("Reading tiles", () => collectFeatures(basemap.path, config.bbox, world));
  // Edge tiles reach past the bbox.
  const inBounds = (p: { x: number; y: number }) => p.x >= x0 && p.y >= y0 && p.x < x1 && p.y < y1;
  features.pois = features.pois.filter(inBounds);
  features.places = features.places.filter(inBounds);
  const { buildings, stats, index, partsUsed } = await step("Joining buildings", () => {
    const assembled = assembleBuildings(features.buildings, world, bounds);
    const index = new BuildingIndex(assembled.buildings, x0, y0, x1 - x0);
    const partsUsed = applyParts(assembled.buildings, features.parts, index);
    return { ...assembled, index, partsUsed };
  });
  features.buildings.clear();
  features.parts.clear();

  const land = await step("Painting landuse", () => paintLand(features, grid, RASTER_SUBDIVISIONS));
  const poiBuilding = await step("Classifying buildings", () => {
    const inside = Int32Array.from(features.pois, (p) => (POI_WEIGHTS[p.kind] ? index.find(p.x, p.y) : -1));
    classifyBuildings(buildings, land.landuse, features.pois, inside);
    for (const b of buildings) b.floorArea = estimateFloorArea(b);
    return inside;
  });

  const housed = await step("Residents", () => distributeResidents(buildings, population, grid, proj, config.bbox));
  const residents = grid.sum("residents");
  await step("Jobs and attractions", () => {
    distributeJobs(buildings, features.pois, poiBuilding, grid, residents * config.jobsPerResident);
    distributeAttractions(buildings, features.pois, land.landuse, grid, {
      education: residents * config.studentsPerResident,
      retail: residents,
      leisure: residents,
      nightlife: residents,
    });
  });
  await step("Nature", () => distributeNature(land, grid, centre, residents));
  await step("Terrain, water, built", () => {
    fillElevation(grid, elevation, proj);
    fillWater(grid, land.water);
    fillBuilt(grid, buildings);
  });
  const names = await step("Names", () => buildNames(features, config.streetNameSpacing, bounds));

  const outDir = join(OUTPUT_DIR, id);
  mkdirSync(outDir, { recursive: true });
  const files = await step("Writing", () => {
    const basemapOut = join(outDir, "basemap.pmtiles");
    copyFileSync(basemap.path, basemapOut);
    const totals = {
      residents: Math.round(residents),
      jobs: Math.round(grid.sum("jobs")),
      education: Math.round(grid.sum("education")),
      buildings: buildings.length,
      jobsIndustry: Math.round(grid.sum("jobsIndustry")),
      nature: Math.round(grid.sum("nature")),
      nightlife: Math.round(grid.sum("nightlife")),
    };
    const manifest = writeJson(outDir, "city.json", {
      format: 1,
      id: config.id,
      name: config.name,
      bbox: config.bbox,
      center: [proj.lon0, proj.lat0],
      // The city's own centre, in local metres; the game measures "downtown" and "the edge" from it.
      centre: centre,
      projection: proj,
      basemap: "basemap.pmtiles",
      maxzoom: config.maxzoom,
      grid: {
        file: "grid.bin",
        x0,
        y0,
        cellSize: config.cellSize,
        cols: grid.cols,
        rows: grid.rows,
        layers: GRID_LAYERS,
      },
      buildings: "buildings.bin",
      names: "names.json",
      totals,
      attribution: ATTRIBUTION,
      generated: new Date().toISOString(),
    });
    writePreview(cachePath(id, "residents-jobs.png"), grid, ["residents", "jobs"]);
    writePreview(cachePath(id, "industry-nature-nightlife.png"), grid, ["jobsIndustry", "nature", "nightlife"]);
    writePreview(cachePath(id, "layers.png"), grid, [...GRID_LAYERS], 1);
    return [
      manifest,
      basemapOut,
      writeGrid(outDir, grid),
      writeBuildings(outDir, buildings),
      writeNames(outDir, names),
    ];
  });

  const byKind = new Map<number, number>();
  for (const b of buildings) byKind.set(KIND_CODE[b.use], (byKind.get(KIND_CODE[b.use]) ?? 0) + 1);
  const heightKnown = buildings.filter((b) => b.heightKnown).length;
  const nameKinds = { street: 0, place: 0, poi: 0 };
  for (const p of names) nameKinds[p.k]++;
  const jobs = grid.sum("jobs");
  const industry = grid.sum("jobsIndustry");

  console.log(`
${config.name} (${config.id}), grid ${grid.cols} x ${grid.rows} at ${config.cellSize} m
Sources: Protomaps build ${basemap.build}, ${population.tiles.join(", ")}, ${elevation.tileCount} terrain tiles
Tiles read: ${fmt(features.tiles)}
Residents: ${fmt(residents)} (GHSL in bbox ${fmt(housed.total)}, ${fmt(housed.unhoused)} not matched to buildings)
Jobs: ${fmt(jobs)} (industrial ${fmt(industry)}, ${((100 * industry) / jobs).toFixed(1)}%)   Education places: ${fmt(grid.sum("education"))}
Nature: ${fmt(grid.sum("nature"))}   Nightlife: ${fmt(grid.sum("nightlife"))} (both scaled to the resident total)
Buildings: ${fmt(buildings.length)} (${fmt(heightKnown)} with height, ${fmt(partsUsed)} parts used; joined across tiles ${fmt(stats.joined)}, join failed ${fmt(stats.joinFailed)})
  by kind: ${[...byKind].sort((a, b) => a[0] - b[0]).map(([k, c]) => `${k}=${fmt(c)}`).join(" ")}
Names: ${fmt(names.length)} (${fmt(nameKinds.street)} street, ${fmt(nameKinds.place)} place, ${fmt(nameKinds.poi)} poi)
Files:
${files.map((f) => `  ${relative(ROOT, f).replace(/\\/g, "/")}  ${mb(f)}`).join("\n")}
Timings:
${timings.map(([label, sec]) => `  ${label.padEnd(24)} ${sec.toFixed(1)} s`).join("\n")}
  ${"total".padEnd(24)} ${timings.reduce((t, [, sec]) => t + sec, 0).toFixed(1)} s`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
