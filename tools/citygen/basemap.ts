import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { cacheDir, isCached } from "./cache";
import type { CityConfig } from "./config";

const BUILDS_URL = "https://build-metadata.protomaps.dev/builds.json";
const BUILD_BASE = "https://build.protomaps.com";

/** `go install` names the binary go-pmtiles; release archives name it pmtiles. */
function pmtilesBinary(): string {
  if (process.env.PMTILES_BIN) return process.env.PMTILES_BIN;
  const ext = process.platform === "win32" ? ".exe" : "";
  for (const name of [`go-pmtiles${ext}`, `pmtiles${ext}`]) {
    if (!spawnSync(name, ["--help"], { stdio: "ignore" }).error) return name;
  }
  const gobin = join(process.env.GOPATH ?? join(homedir(), "go"), "bin", `go-pmtiles${ext}`);
  if (existsSync(gobin)) return gobin;
  throw new Error(
    "go-pmtiles not found. Install it with `go install github.com/protomaps/go-pmtiles@latest` or set PMTILES_BIN.",
  );
}

async function latestBuild(): Promise<string> {
  const res = await fetch(BUILDS_URL);
  if (!res.ok) throw new Error(`${BUILDS_URL}: HTTP ${res.status}`);
  const builds = (await res.json()) as { key: string }[];
  const dates = builds
    .map((b) => /^(\d{8})\.pmtiles$/.exec(b.key)?.[1])
    .filter((d): d is string => d !== undefined)
    .sort();
  if (dates.length === 0) throw new Error(`No builds listed at ${BUILDS_URL}`);
  return dates[dates.length - 1];
}

/** Returns the path of a cached extract of the city's bbox, extracting it first if needed. */
export async function ensureBasemap(config: CityConfig, refresh: boolean): Promise<{ path: string; build: string }> {
  const suffix = `_${config.bbox.join("_")}_z${config.maxzoom}.pmtiles`;
  const dir = cacheDir("basemap");

  let build = config.basemapBuild;
  if (!build && !refresh) {
    const cached = readdirSync(dir)
      .filter((f) => f.endsWith(suffix) && /^\d{8}_/.test(f))
      .sort();
    if (cached.length > 0) build = cached[cached.length - 1].slice(0, 8);
  }
  build ??= await latestBuild();

  const path = join(dir, `${build}${suffix}`);
  if (isCached(path)) return { path, build };

  const part = `${path}.part`;
  rmSync(part, { force: true });
  console.log(`Extracting basemap from Protomaps build ${build} (zoom 0-${config.maxzoom})`);
  const run = spawnSync(
    pmtilesBinary(),
    ["extract", `${BUILD_BASE}/${build}.pmtiles`, part, `--bbox=${config.bbox.join(",")}`, `--maxzoom=${config.maxzoom}`],
    { stdio: "inherit" },
  );
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`go-pmtiles extract exited with status ${run.status}`);
  renameSync(part, path);
  return { path, build };
}
