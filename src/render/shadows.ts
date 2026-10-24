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
// A shadow fades from its wall to its tip, standing in for the sky light that reaches into it.
const TIP_SHADE = 0.4;
// Every building also darkens a narrow band of ground around its base, from this zoom in.
const CONTACT_ZOOM = 15;
const CONTACT_SHADE = 0.85;
/** The depth slice the shadow passes sort overlaps in, just in front of the layer's own depth. */
export const SHADOW_DEPTH_SPAN = 1e-4;

const vertexShader = /* glsl */ `
attribute float shade;
uniform vec2 centre;
varying float dist;
varying float s;
void main() {
  dist = distance(position.xy, centre);
  s = shade;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // Darker means nearer, so where shadows overlap the depth test can keep the darkest of them.
  p.z = (1.0 - 2.0 * shade) * p.w;
  gl_Position = p;
}`;

const fragmentShader = /* glsl */ `
uniform vec3 colour;
uniform float opacity;
uniform float radius;
varying float dist;
varying float s;
void main() {
  gl_FragColor = vec4(colour, opacity * s * (1.0 - smoothstep(radius * 0.75, radius, dist)));
}`;

interface Chunk {
  sweeps: THREE.Mesh | null;
  contact: THREE.Mesh | null;
}

/**
 * Ground shadows: each building's outline swept away from the sun by its height. Only the walls
 * facing away from the sun are swept, since the rest of the shadow lies under the building.
 * Shadows overlap freely and are drawn in two passes (see setPass), so ground under several of
 * them is darkened once, by the darkest.
 */
export class Shadows {
  readonly group = new THREE.Group();
  private sweeps = new THREE.Group();
  private contact = new THREE.Group();
  private material: THREE.ShaderMaterial;
  private chunks = new Map<number, Chunk>();
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
    this.group.add(this.sweeps, this.contact);
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
      side: THREE.DoubleSide,
    });
    this.setTheme(theme);
  }

  /**
   * The first pass only writes depth, which leaves the darkest shadow's depth on each pixel; the
   * second paints just the fragments that match it.
   */
  setPass(pass: "depth" | "colour") {
    const m = this.material;
    m.colorWrite = pass === "colour";
    m.depthWrite = pass === "depth";
    m.depthFunc = pass === "depth" ? THREE.LessDepth : THREE.EqualDepth;
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
    this.contact.visible = zoom >= CONTACT_ZOOM;
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
      const chunk = this.build(buildings, k);
      if (chunk.sweeps) this.sweeps.add(chunk.sweeps);
      if (chunk.contact) this.contact.add(chunk.contact);
      this.chunks.set(k, chunk);
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

    for (const [k, chunk] of this.chunks) {
      const gx = Math.floor(k / 4096) - 2048;
      const gy = (k % 4096) - 2048;
      if (Math.hypot((gx + 0.5) * CHUNK - cx, (gy + 0.5) * CHUNK - cy) <= reach * 1.5) continue;
      for (const mesh of [chunk.sweeps, chunk.contact]) {
        if (!mesh) continue;
        mesh.removeFromParent();
        mesh.geometry.dispose();
      }
      this.chunks.delete(k);
    }
    this.material.uniforms.centre.value.set(cx, cy);
    this.material.uniforms.radius.value = radius;
  }

  private build(buildings: Buildings, k: number): Chunk {
    const ids = this.byChunk!.get(k) ?? [];
    const sweep = new Strip();
    const contact = new Strip();
    const vs = buildings.verts;
    for (const i of ids) {
      const h = buildings.height(i);
      if (!(h > 0)) continue;
      const ox = this.dx * h;
      const oy = this.dy * h;
      const w = Math.min(4, 2 + 0.05 * h);
      const v0 = buildings.ringStart[i] * 2;
      const v1 = buildings.ringStart[i + 1] * 2;
      if (v1 - v0 < 6) continue;
      let area = 0;
      for (let v = v0, u = v1 - 2; v < v1; u = v, v += 2) area += vs[u] * vs[v + 1] - vs[v] * vs[u + 1];
      const outward = area > 0 ? 1 : -1;
      // The previous wall's outward direction, starting with the last wall so the band closes.
      let [pux, puy] = wallNormal(vs, v1 - 4, v1 - 2, outward);
      for (let v = v0, u = v1 - 2; v < v1; u = v, v += 2) {
        const ax = vs[u], ay = vs[u + 1], bx = vs[v], by = vs[v + 1];
        const nx = (by - ay) * outward;
        const ny = -(bx - ax) * outward;
        // Only walls facing away from the sun cast the visible shadow.
        if (nx * ox + ny * oy > 0) sweep.quad(ax, ay, bx, by, ox, oy, 1, TIP_SHADE);
        const [ux, uy] = wallNormal(vs, u, v, outward);
        if (Number.isNaN(ux)) continue;
        // Fill the wedge the band leaves open where two walls meet.
        if (!Number.isNaN(pux)) contact.tri(ax, ay, CONTACT_SHADE, ax + pux * w, ay + puy * w, 0, ax + ux * w, ay + uy * w, 0);
        contact.quad(ax, ay, bx, by, ux * w, uy * w, CONTACT_SHADE, 0);
        pux = ux;
        puy = uy;
      }
    }
    return { sweeps: sweep.mesh(this.material), contact: contact.mesh(this.material) };
  }
}

/** The unit outward normal of the wall from vertex u to vertex v, or NaN for a wall too short to matter. */
function wallNormal(vs: Float32Array, u: number, v: number, outward: number): [number, number] {
  const nx = (vs[v + 1] - vs[u + 1]) * outward;
  const ny = -(vs[v] - vs[u]) * outward;
  const len = Math.hypot(nx, ny);
  return len < 0.5 ? [NaN, NaN] : [nx / len, ny / len];
}

/** Ground triangles with a shade at each corner, collected for one chunk. */
class Strip {
  private pos: number[] = [];
  private shade: number[] = [];

  tri(ax: number, ay: number, as: number, bx: number, by: number, bs: number, cx: number, cy: number, cs: number) {
    this.pos.push(ax, ay, bx, by, cx, cy);
    this.shade.push(as, bs, cs);
  }

  /** The wall a-b swept by (ox, oy), shaded `base` along the wall and `tip` at the far edge. */
  quad(ax: number, ay: number, bx: number, by: number, ox: number, oy: number, base: number, tip: number) {
    this.tri(ax, ay, base, bx, by, base, bx + ox, by + oy, tip);
    this.tri(ax, ay, base, bx + ox, by + oy, tip, ax + ox, ay + oy, tip);
  }

  mesh(material: THREE.Material): THREE.Mesh | null {
    if (!this.pos.length) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.pos), 2));
    geometry.setAttribute("shade", new THREE.BufferAttribute(new Float32Array(this.shade), 1));
    // three.js can't measure 2D positions itself (it would read a z past the end of the array).
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < this.pos.length; i += 2) {
      x0 = Math.min(x0, this.pos[i]);
      y0 = Math.min(y0, this.pos[i + 1]);
      x1 = Math.max(x1, this.pos[i]);
      y1 = Math.max(y1, this.pos[i + 1]);
    }
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, 0), Math.hypot(x1 - x0, y1 - y0) / 2);
    const mesh = new THREE.Mesh(geometry, material);
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
