import { existsSync, mkdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CACHE_DIR } from "./paths";

export function cacheDir(...parts: string[]): string {
  const dir = join(CACHE_DIR, ...parts);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function cachePath(...parts: string[]): string {
  const p = join(CACHE_DIR, ...parts);
  mkdirSync(dirname(p), { recursive: true });
  return p;
}

export function isCached(path: string): boolean {
  return existsSync(path) && statSync(path).size > 0;
}

/** Downloads url to path unless it is already there. Returns false on 404. */
export async function download(url: string, path: string, retries = 3): Promise<boolean> {
  if (isCached(path)) return true;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 404 || res.status === 403) return false;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = new Uint8Array(await res.arrayBuffer());
      const part = `${path}.part`;
      writeFileSync(part, body);
      renameSync(part, path);
      return true;
    } catch (err) {
      if (attempt >= retries) throw new Error(`Download failed: ${url}: ${(err as Error).message}`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

/** Runs async jobs with a fixed number of workers. */
export async function runPool<T>(items: T[], workers: number, job: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await job(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(workers, items.length) }, worker));
}
