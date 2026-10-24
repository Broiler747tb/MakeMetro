import * as THREE from "three";
import type { Map as MapLibre } from "maplibre-gl";
import type { Game } from "../game/game";
import type { Buildings } from "../city/buildings";
import { SHADOW_SUN, shadowFor, type Theme } from "../map/style";

const CHUNK = 500; // m
const MIN_ZOOM = 14;
// Shadows are kept within this distance of the view centre at zoom 15, twice as far per zoom level out.
const RADIUS_AT_Z15 = 3500;
const MAX_RADIUS = 9000;
// Time per frame spent building chunks, so moving the camera never stalls.
const BUILD_BUDGET_MS = 4;

const vertexShader = /* glsl */ `
uniform vec2 centre;
varying float dist;
void main() {
  dist = distance(position.xy, centre);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // Every shadow lands at the same depth, so where two overlap the second one fails the depth
  // test and the ground is darkened once.
  p.z = 0.0;
  gl_Position = p;
}`;

const fragmentShader = /* glsl */ `
uniform vec3 colour;
uniform float opacity;
uniform float radius;
varying float dist;
void main() {
  gl_FragColor = vec4(colour, opacity * (1.0 - smoothstep(radius * 0.75, radius, dist)));
}`;

/**
 * Ground shadows: each building's outline swept away from the sun by its height. Only the walls
 * facing away from the sun are swept, since the rest of the shadow lies under the building.
 */
export class Shadows {
  readonly group = new THREE.Group();
  private material: THREE.ShaderMaterial;
  private chunks = new Map<number, THREE.Mesh | null>();
  private byChunk: Map<number, number[]> | null = null;
  private pending: number[] = [];
  private lastKey = "";
  private baseOpacity = 0;
  // Shadow offset per metre of height, in local metres (y north).
  private dx: number;
  private dy: number;

  constructor(
    private map: MapLibre,
    private game: Game,
    theme: Theme,
  ) {
    const away = ((SHADOW_SUN.azimuth + 180) * Math.PI) / 180;
    const length = Math.tan((SHADOW_SUN.fromZenith * Math.PI) / 180);
    this.dx = Math.sin(away) * length;
    this.dy = Math.cos(away) * length;
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        centre: { value: new THREE.Vector2() },
        radius: { value: 0 },
        colour: { value: new THREE.Color() },
        opacity: { value: 0 },
      },
      transparent: true,
      depthTest: true,
      depthWrite: true,
      depthFunc: THREE.LessDepth,
      side: THREE.DoubleSide,
    });
    this.setTheme(theme);
  }

  setTheme(theme: Theme) {
    const { color, opacity } = shadowFor(theme);
    this.material.uniforms.colour.value.set(color);
    this.baseOpacity = opacity;
  }

  /** Brings the shadows up to date with the view. Returns true while chunks are still being built. */
  frame(): boolean {
    const buildings = this.game.net.buildings;
    const zoom = this.map.getZoom();
    if (!buildings || zoom < MIN_ZOOM) {
      this.group.visible = false;
      return false;
    }
    this.group.visible = true;
    this.material.uniforms.opacity.value = this.baseOpacity * Math.min(1, (zoom - MIN_ZOOM) / 0.5);

    const centre = this.map.getCenter();
    const [cx, cy] = this.game.city.proj.toLocal(centre.lng, centre.lat);
    const radius = Math.min(MAX_RADIUS, RADIUS_AT_Z15 * 2 ** (15 - zoom));
    const step = radius / 4;
    const key = `${Math.round(cx / step)}:${Math.round(cy / step)}:${Math.round(zoom * 2)}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.plan(buildings, cx, cy, radius);
    }

    const t0 = performance.now();
    while (this.pending.length && performance.now() - t0 < BUILD_BUDGET_MS) {
      const k = this.pending.shift()!;
      const mesh = this.build(buildings, k);
      if (mesh) this.group.add(mesh);
      this.chunks.set(k, mesh);
    }
    return this.pending.length > 0;
  }

  /** Picks the chunks to show around the view, nearest first, and drops ones that fell well outside it. */
  private plan(buildings: Buildings, cx: number, cy: number, radius: number) {
    if (!this.byChunk) this.byChunk = chunkIndex(buildings);
    const reach = radius + CHUNK * 0.71;
    const wanted: { k: number; d: number }[] = [];
    for (let gx = Math.floor((cx - reach) / CHUNK); gx <= Math.floor((cx + reach) / CHUNK); gx++) {
      for (let gy = Math.floor((cy - reach) / CHUNK); gy <= Math.floor((cy + reach) / CHUNK); gy++) {
        const d = Math.hypot((gx + 0.5) * CHUNK - cx, (gy + 0.5) * CHUNK - cy);
        const k = chunkKey(gx, gy);
        if (d <= reach && this.byChunk.has(k)) wanted.push({ k, d });
      }
    }
    wanted.sort((a, b) => a.d - b.d);
    this.pending = wanted.filter((w) => !this.chunks.has(w.k)).map((w) => w.k);

    for (const [k, mesh] of this.chunks) {
      const gx = Math.floor(k / 4096) - 2048;
      const gy = (k % 4096) - 2048;
      if (Math.hypot((gx + 0.5) * CHUNK - cx, (gy + 0.5) * CHUNK - cy) <= reach * 1.5) continue;
      if (mesh) {
        this.group.remove(mesh);
        mesh.geometry.dispose();
      }
      this.chunks.delete(k);
    }
    this.material.uniforms.centre.value.set(cx, cy);
    this.material.uniforms.radius.value = radius;
  }

  private build(buildings: Buildings, k: number): THREE.Mesh | null {
    const ids = this.byChunk!.get(k) ?? [];
    const out: number[] = [];
    const vs = buildings.verts;
    for (const i of ids) {
      const h = buildings.height(i);
      if (!(h > 0)) continue;
      const ox = this.dx * h;
      const oy = this.dy * h;
      const v0 = buildings.ringStart[i] * 2;
      const v1 = buildings.ringStart[i + 1] * 2;
      if (v1 - v0 < 6) continue;
      let area = 0;
      for (let v = v0, u = v1 - 2; v < v1; u = v, v += 2) area += vs[u] * vs[v + 1] - vs[v] * vs[u + 1];
      const outward = area > 0 ? 1 : -1;
      for (let v = v0, u = v1 - 2; v < v1; u = v, v += 2) {
        const ax = vs[u], ay = vs[u + 1], bx = vs[v], by = vs[v + 1];
        // Outward normal of the wall; only walls facing away from the sun cast the visible shadow.
        const nx = (by - ay) * outward;
        const ny = -(bx - ax) * outward;
        if (nx * ox + ny * oy <= 0) continue;
        out.push(ax, ay, bx, by, bx + ox, by + oy, ax, ay, bx + ox, by + oy, ax + ox, ay + oy);
      }
    }
    if (!out.length) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(out), 2));
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.frustumCulled = false;
    return mesh;
  }
}

function chunkKey(gx: number, gy: number): number {
  return (gx + 2048) * 4096 + (gy + 2048);
}

/** Buildings grouped by the chunk their centre falls in. */
function chunkIndex(buildings: Buildings): Map<number, number[]> {
  const index = new Map<number, number[]>();
  for (let i = 0; i < buildings.count; i++) {
    const [x, y] = buildings.centroid(i);
    const k = chunkKey(Math.floor(x / CHUNK), Math.floor(y / CHUNK));
    let list = index.get(k);
    if (!list) index.set(k, (list = []));
    list.push(i);
  }
  return index;
}
