// New layers go at the end, so readers that index planes by position keep working.
export const GRID_LAYERS = [
  "residents",
  "jobs",
  "education",
  "retail",
  "leisure",
  "elevation",
  "water",
  "built",
  "jobsIndustry",
  "nature",
  "nightlife",
] as const;

export type GridLayer = (typeof GRID_LAYERS)[number];

/** Regular grid over the bbox in local metres. Row 0 is the south edge, column 0 the west edge. */
export class Grid {
  readonly cols: number;
  readonly rows: number;
  readonly layers: Record<GridLayer, Float32Array>;

  constructor(
    readonly x0: number,
    readonly y0: number,
    width: number,
    height: number,
    readonly cellSize: number,
  ) {
    this.cols = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    const n = this.cols * this.rows;
    this.layers = Object.fromEntries(GRID_LAYERS.map((name) => [name, new Float32Array(n)])) as Record<
      GridLayer,
      Float32Array
    >;
  }

  get size(): number {
    return this.cols * this.rows;
  }

  /** Index of the cell containing (x, y), or -1 outside the grid. */
  cellAt(x: number, y: number): number {
    const c = Math.floor((x - this.x0) / this.cellSize);
    const r = Math.floor((y - this.y0) / this.cellSize);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }

  centre(index: number): [number, number] {
    const c = index % this.cols;
    const r = Math.floor(index / this.cols);
    return [this.x0 + (c + 0.5) * this.cellSize, this.y0 + (r + 0.5) * this.cellSize];
  }

  add(layer: GridLayer, x: number, y: number, value: number) {
    const i = this.cellAt(x, y);
    if (i >= 0) this.layers[layer][i] += value;
  }

  sum(layer: GridLayer): number {
    let s = 0;
    for (const v of this.layers[layer]) s += v;
    return s;
  }

  /** Scales a layer so that it sums to `total`. */
  normalise(layer: GridLayer, total: number) {
    const s = this.sum(layer);
    if (s <= 0) return;
    const k = total / s;
    const data = this.layers[layer];
    for (let i = 0; i < data.length; i++) data[i] *= k;
  }
}
