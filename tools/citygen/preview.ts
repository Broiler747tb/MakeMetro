import { writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import type { Grid, GridLayer } from "./grid";

// Dark blue through teal and yellow to white.
const RAMP: [number, number, number][] = [
  [12, 14, 40],
  [32, 70, 130],
  [30, 150, 140],
  [240, 210, 60],
  [255, 255, 245],
];

function colour(t: number): [number, number, number] {
  const f = Math.min(1, Math.max(0, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(f));
  const k = f - i;
  const a = RAMP[i];
  const b = RAMP[i + 1];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/** Maps a layer to 0..1: square root up to the 99.5th percentile for counts, linear for the rest. */
function scaler(grid: Grid, layer: GridLayer): (v: number) => number {
  const data = grid.layers[layer];
  if (layer === "elevation") {
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of data) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    return (v) => (v - lo) / (hi - lo || 1);
  }
  if (layer === "water" || layer === "built") return (v) => v;
  const sorted = Float32Array.from(data).filter((v) => v > 0).sort();
  const top = sorted[Math.floor(sorted.length * 0.995)] ?? 1;
  return (v) => (v > 0 ? Math.sqrt(v / top) : 0);
}

/** Writes the given layers side by side into one PNG, north up, `zoom` pixels per cell. */
export function writePreview(path: string, grid: Grid, layers: GridLayer[], zoom = 2) {
  const gap = 4;
  const panel = grid.cols * zoom;
  const png = new PNG({ width: layers.length * (panel + gap) - gap, height: grid.rows * zoom });
  png.data.fill(255);
  layers.forEach((layer, k) => {
    const scale = scaler(grid, layer);
    const data = grid.layers[layer];
    for (let y = 0; y < png.height; y++) {
      const r = grid.rows - 1 - Math.floor(y / zoom);
      for (let x = 0; x < panel; x++) {
        const [red, green, blue] = colour(scale(data[r * grid.cols + Math.floor(x / zoom)]));
        const o = (y * png.width + k * (panel + gap) + x) * 4;
        png.data[o] = red;
        png.data[o + 1] = green;
        png.data[o + 2] = blue;
        png.data[o + 3] = 255;
      }
    }
  });
  writeFileSync(path, PNG.sync.write(png));
}
