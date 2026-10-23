import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR } from "./paths";
import type { BBox } from "./projection";

export interface CityConfig {
  id: string;
  name: string;
  bbox: BBox;
  /** City centre as [lon, lat]. Defaults to the bbox centre. */
  centre?: [number, number];
  /** Jobs as a share of residents. */
  jobsPerResident: number;
  /** School and university places as a share of residents. */
  studentsPerResident: number;
  cellSize: number;
  maxzoom: number;
  /** Spacing of street name points along named roads, metres. */
  streetNameSpacing: number;
  /** Protomaps build date (YYYYMMDD). Defaults to the newest cached extract, else the newest build. */
  basemapBuild?: string;
}

const DEFAULTS = {
  jobsPerResident: 0.55,
  studentsPerResident: 0.18,
  cellSize: 250,
  maxzoom: 15,
  streetNameSpacing: 150,
};

export function configPath(id: string): string {
  return join(CONFIG_DIR, `${id}.json`);
}

export function loadConfig(id: string): CityConfig {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`City id must be lowercase letters, digits and dashes: ${id}`);
  const raw = JSON.parse(readFileSync(configPath(id), "utf8"));
  const config: CityConfig = { ...DEFAULTS, ...raw };
  if (config.id !== id) throw new Error(`${configPath(id)} has id "${config.id}"`);
  const [w, s, e, n] = config.bbox ?? [];
  const valid = [w, s, e, n].every(Number.isFinite) && w < e && s < n && s > -85 && n < 85;
  if (!valid) throw new Error(`Bad bbox in ${configPath(id)}: expected [west, south, east, north]`);
  if (config.centre !== undefined) {
    const [lon, lat] = config.centre;
    if (![lon, lat].every(Number.isFinite) || Math.abs(lat) >= 85 || Math.abs(lon) > 180) {
      throw new Error(`Bad centre in ${configPath(id)}: expected [lon, lat]`);
    }
  }
  return config;
}
