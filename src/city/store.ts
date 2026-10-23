import { FetchSource, type RangeResponse, type Source } from "pmtiles";

// City packs are kept in the browser's Cache Storage, one cache per city and pack version,
// so a city is downloaded once and then opens from disk.
const PREFIX = "makemetro-city-";

function cacheName(cityId: string, version: string): string {
  return `${PREFIX}${cityId}-${version}`;
}

/** Headers worth keeping: the type only, since a body arriving compressed is stored decoded. */
function keptHeaders(res: Response): HeadersInit {
  return { "content-type": res.headers.get("content-type") ?? "application/octet-stream" };
}

/** Wraps a response body so bytes read are reported as they stream past. */
function counted(res: Response, onProgress?: (fraction: number) => void): Response {
  const total = Number(res.headers.get("content-length")) || 0;
  if (!res.body || !onProgress || !total) return res;
  let got = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      got += chunk.byteLength;
      onProgress(Math.min(1, got / total));
      controller.enqueue(chunk);
    },
  });
  return new Response(res.body.pipeThrough(counter), { headers: keptHeaders(res) });
}

export class CityStore {
  private cache: Cache | null = null;
  private kept = new Map<string, Blob>();

  private constructor(
    readonly cityId: string,
    readonly version: string,
    readonly baseUrl: string,
  ) {}

  static async open(cityId: string, version: string, baseUrl: string): Promise<CityStore> {
    const store = new CityStore(cityId, version, baseUrl);
    if (!("caches" in globalThis)) return store;
    try {
      const name = cacheName(cityId, version);
      store.cache = await caches.open(name);
      // A newer pack of the same city replaces the old one.
      for (const key of await caches.keys()) {
        if (key.startsWith(`${PREFIX}${cityId}-`) && key !== name) await caches.delete(key);
      }
    } catch (err) {
      console.warn("city storage unavailable", err);
    }
    return store;
  }

  /** The newest kept copy of a file from any version of this city, for when the network is down. */
  static async anyKept(cityId: string, url: string): Promise<Response | null> {
    if (!("caches" in globalThis)) return null;
    for (const key of (await caches.keys()).filter((k) => k.startsWith(`${PREFIX}${cityId}-`)).sort().reverse()) {
      const hit = await (await caches.open(key)).match(url);
      if (hit) return hit;
    }
    return null;
  }

  url(file: string): string {
    return new URL(this.baseUrl + file, location.href).href;
  }

  async has(file: string): Promise<boolean> {
    return !!(await this.cache?.match(this.url(file)));
  }

  /** A whole file: from disk if it's kept, otherwise downloaded and kept. */
  async get(file: string, onProgress?: (fraction: number) => void): Promise<ArrayBuffer> {
    const url = this.url(file);
    const hit = await this.cache?.match(url);
    if (hit) {
      onProgress?.(1);
      return hit.arrayBuffer();
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    const body = await counted(res, onProgress).arrayBuffer();
    try {
      await this.cache?.put(url, new Response(body, { headers: keptHeaders(res) }));
    } catch (err) {
      console.warn(`couldn't keep ${file}`, err);
    }
    return body;
  }

  /**
   * Downloads a large file straight into storage without holding it in memory, unless it's
   * already there. Afterwards it can be read in pieces with `slice`.
   */
  async keep(file: string, onProgress?: (fraction: number) => void): Promise<boolean> {
    if (!this.cache) return false;
    const url = this.url(file);
    let hit = await this.cache.match(url);
    if (!hit) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      await this.cache.put(url, counted(res, onProgress));
      hit = await this.cache.match(url);
      if (!hit) return false;
    }
    onProgress?.(1);
    this.kept.set(file, await hit.blob());
    return true;
  }

  /** Picks up a file kept on an earlier visit, without downloading anything. */
  async restore(file: string): Promise<boolean> {
    const hit = await this.cache?.match(this.url(file));
    if (hit) this.kept.set(file, await hit.blob());
    return !!hit;
  }

  isKept(file: string): boolean {
    return this.kept.has(file);
  }

  async slice(file: string, offset: number, length: number): Promise<ArrayBuffer | null> {
    const blob = this.kept.get(file);
    return blob ? blob.slice(offset, offset + length).arrayBuffer() : null;
  }

  /** Small files fetched by URL (terrain tiles): from disk, or from the network and kept. */
  async fetchKept(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
    const hit = await this.cache?.match(url);
    if (hit) return hit.arrayBuffer();
    const res = await fetch(url, { signal });
    // A missing file can come back as a page rather than a 404, depending on the server.
    if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) throw new Error(`${url}: not found`);
    const body = await res.arrayBuffer();
    this.cache?.put(url, new Response(body, { headers: keptHeaders(res) })).catch(() => {});
    return body;
  }

  /** Bytes kept for this city across all versions. */
  static async usage(cityId: string): Promise<number> {
    if (!("caches" in globalThis)) return 0;
    let total = 0;
    for (const key of (await caches.keys()).filter((k) => k.startsWith(`${PREFIX}${cityId}-`))) {
      const cache = await caches.open(key);
      for (const req of await cache.keys()) {
        total += (await (await cache.match(req))?.blob())?.size ?? 0;
      }
    }
    return total;
  }

  static async forget(cityId: string): Promise<void> {
    if (!("caches" in globalThis)) return;
    for (const key of (await caches.keys()).filter((k) => k.startsWith(`${PREFIX}${cityId}-`))) await caches.delete(key);
  }
}

/** Map tiles from the kept copy of the basemap when there is one, from the network until then. */
export class KeptSource implements Source {
  private remote: FetchSource;

  constructor(
    private store: CityStore,
    private file: string,
  ) {
    this.remote = new FetchSource(store.url(file));
  }

  getKey(): string {
    return this.store.url(this.file);
  }

  async getBytes(offset: number, length: number, signal?: AbortSignal, etag?: string): Promise<RangeResponse> {
    const local = await this.store.slice(this.file, offset, length);
    if (local) return { data: local };
    return this.remote.getBytes(offset, length, signal, etag);
  }
}
