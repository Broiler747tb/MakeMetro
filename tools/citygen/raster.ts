import type { Ring } from "./geometry";

/** A byte raster in local metres. Row 0 is the south edge. */
export class Raster {
  readonly data: Uint8Array;

  constructor(
    readonly x0: number,
    readonly y0: number,
    readonly res: number,
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8Array(width * height);
  }

  at(x: number, y: number): number {
    const i = Math.floor((x - this.x0) / this.res);
    const j = Math.floor((y - this.y0) / this.res);
    if (i < 0 || j < 0 || i >= this.width || j >= this.height) return 0;
    return this.data[j * this.width + i];
  }

  /**
   * Scanline fill of a polygon given as rings (outer and holes, even-odd rule).
   * A pixel is filled when its centre is inside.
   */
  fill(rings: Ring[], value: number) {
    let ymin = Infinity;
    let ymax = -Infinity;
    for (const r of rings) {
      for (let k = 1; k < r.length; k += 2) {
        if (r[k] < ymin) ymin = r[k];
        if (r[k] > ymax) ymax = r[k];
      }
    }
    const j0 = Math.max(0, Math.ceil((ymin - this.y0) / this.res - 0.5));
    const j1 = Math.min(this.height - 1, Math.ceil((ymax - this.y0) / this.res - 0.5) - 1);
    if (j1 < j0) return;

    const rows: number[][] = Array.from({ length: j1 - j0 + 1 }, () => []);
    for (const r of rings) {
      const n = r.length / 2;
      for (let a = n - 1, b = 0; b < n; a = b++) {
        const ax = r[2 * a];
        const ay = r[2 * a + 1];
        const bx = r[2 * b];
        const by = r[2 * b + 1];
        if (ay === by) continue;
        const lo = Math.min(ay, by);
        const hi = Math.max(ay, by);
        const ja = Math.max(j0, Math.ceil((lo - this.y0) / this.res - 0.5));
        const jb = Math.min(j1, Math.ceil((hi - this.y0) / this.res - 0.5) - 1);
        for (let j = ja; j <= jb; j++) {
          const yc = this.y0 + (j + 0.5) * this.res;
          rows[j - j0].push(ax + ((yc - ay) / (by - ay)) * (bx - ax));
        }
      }
    }

    for (let j = j0; j <= j1; j++) {
      const xs = rows[j - j0].sort((p, q) => p - q);
      const base = j * this.width;
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] - this.x0) / this.res - 0.5));
        const i1 = Math.min(this.width - 1, Math.ceil((xs[k + 1] - this.x0) / this.res - 0.5) - 1);
        if (i1 >= i0) this.data.fill(value, base + i0, base + i1 + 1);
      }
    }
  }
}
