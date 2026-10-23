import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const CACHE_DIR = join(ROOT, ".cache", "citygen");
export const CONFIG_DIR = join(ROOT, "tools", "citygen", "cities");
export const OUTPUT_DIR = join(ROOT, "public", "cities");
