import * as THREE from "three";
import type { Map as MapLibre } from "maplibre-gl";
import type { Game } from "../game/game";
import { pointInRing } from "../game/geometry";

const MAX_TREES = 40000;
const MIN_ZOOM = 14.5;
const WOOD_KINDS = ["forest", "wood"];
const PARK_KINDS = ["park", "garden", "nature_reserve", "village_green", "recreation_ground", "cemetery", "allotments"];
const GRASS_KINDS = ["grass"];
// Distance between trees, and the share of spots left empty: woods are dense, parks open,
// lawns and boulevards have a tree here and there.
const SPACING = { wood: 9, park: 15, grass: 22 };
const CLEARING = { wood: 0, park: 0.35, grass: 0.6 };
// Trees are placed within this distance of the view centre at zoom 15, half as far per zoom level in.
const RADIUS_AT_Z15 = 2200;

const COLOURS = {
  light: { canopy: [0x6f9a5c, 0x7ea866, 0x618c52, 0x88ad6e], trunk: 0x7d6c58 },
  dark: { canopy: [0x1f3325, 0x243a2a, 0x1c2e21, 0x29412f], trunk: 0x2e2923 },
};

/** A repeatable pseudo-random number for a grid cell, so trees stay put between redraws. */
function hash(x: number, y: number, salt: number): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Simple trees in parks and woods, placed from the map's own landuse when zoomed in. */
export class Trees {
  readonly group = new THREE.Group();
  private canopies: THREE.InstancedMesh;
  private trunks: THREE.InstancedMesh;
  private lastKey = "";
  private theme: "light" | "dark";
  private tmp = new THREE.Object3D();
  private colour = new THREE.Color();

  constructor(
    private map: MapLibre,
    private game: Game,
    theme: "light" | "dark",
  ) {
    this.theme = theme;
    const canopy = new THREE.IcosahedronGeometry(1, 0).translate(0, 0, 0);
    const trunk = new THREE.CylinderGeometry(0.5, 0.6, 1, 5).rotateX(Math.PI / 2).translate(0, 0, 0.5);
    this.canopies = new THREE.InstancedMesh(canopy, new THREE.MeshLambertMaterial({ color: 0xffffff }), MAX_TREES);
    this.trunks = new THREE.InstancedMesh(trunk, new THREE.MeshLambertMaterial({ color: COLOURS[theme].trunk }), MAX_TREES);
    for (const m of [this.canopies, this.trunks]) {
      m.frustumCulled = false;
      m.count = 0;
    }
    this.group.add(this.trunks, this.canopies);
  }

  setTheme(theme: "light" | "dark") {
    this.theme = theme;
    (this.trunks.material as THREE.MeshLambertMaterial).color.set(COLOURS[theme].trunk);
    this.lastKey = "";
    this.update();
  }

  /** Places trees for the current view. `fresh` redoes it even if the view hasn't moved. */
  update(fresh = false) {
    const map = this.map;
    if (fresh) this.lastKey = "";
    const zoom = map.getZoom();
    if (zoom < MIN_ZOOM) {
      this.canopies.count = this.trunks.count = 0;
      this.lastKey = "";
      return;
    }
    const proj = this.game.city.proj;
    // A tilted view reaches the horizon, so work from the centre of the view outwards rather
    // than from its bounds.
    const centre = map.getCenter();
    const [cx, cy] = proj.toLocal(centre.lng, centre.lat);
    const radius = RADIUS_AT_Z15 * 2 ** (15 - zoom);
    const step = radius / 3;
    const key = `${Math.round(cx / step)}:${Math.round(cy / step)}:${Math.round(zoom * 2)}:${this.game.buildingsReady}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const view = [cx - radius, cy - radius, cx + radius, cy + radius];

    const features = map.querySourceFeatures("base", {
      sourceLayer: "landuse",
      filter: ["in", ["get", "kind"], ["literal", [...WOOD_KINDS, ...PARK_KINDS, ...GRASS_KINDS]]],
    });
    // Candidates first, then the nearest ones up to the limit.
    const spots: { x: number; y: number; gx: number; gy: number; d: number }[] = [];
    const buildings = this.game.net.buildings;
    const seen = new Set<string>();
    const canopy = COLOURS[this.theme].canopy;
    const tmp = this.tmp;
    for (const f of features) {
      const geom = f.geometry;
      const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
      const kind = f.properties?.kind;
      const sort = WOOD_KINDS.includes(kind) ? "wood" : GRASS_KINDS.includes(kind) ? "grass" : "park";
      const spacing = SPACING[sort];
      for (const poly of polys) {
        const rings = poly.map((ring) => {
          const flat = new Float64Array(ring.length * 2);
          ring.forEach(([lon, lat], i) => {
            const [x, y] = proj.toLocal(lon, lat);
            flat[2 * i] = x;
            flat[2 * i + 1] = y;
          });
          return flat;
        });
        const outer = rings[0];
        let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
        for (let i = 0; i < outer.length; i += 2) {
          bx0 = Math.min(bx0, outer[i]);
          by0 = Math.min(by0, outer[i + 1]);
          bx1 = Math.max(bx1, outer[i]);
          by1 = Math.max(by1, outer[i + 1]);
        }
        bx0 = Math.max(bx0, view[0]);
        by0 = Math.max(by0, view[1]);
        bx1 = Math.min(bx1, view[2]);
        by1 = Math.min(by1, view[3]);
        for (let gx = Math.floor(bx0 / spacing); gx <= Math.ceil(bx1 / spacing); gx++) {
          for (let gy = Math.floor(by0 / spacing); gy <= Math.ceil(by1 / spacing); gy++) {
            const cell = `${spacing}:${gx}:${gy}`;
            if (seen.has(cell)) continue;
            const x = (gx + 0.15 + 0.7 * hash(gx, gy, 1)) * spacing;
            const y = (gy + 0.15 + 0.7 * hash(gx, gy, 2)) * spacing;
            const d = Math.hypot(x - cx, y - cy);
            if (d > radius) continue;
            // Clearings, so parks don't look like plantations.
            if (hash(gx, gy, 3) < CLEARING[sort]) continue;
            if (!pointInRing(x, y, outer, 0, outer.length)) continue;
            let inHole = false;
            for (let h = 1; h < rings.length && !inHole; h++) inHole = pointInRing(x, y, rings[h], 0, rings[h].length);
            if (inHole || (buildings && buildings.at(x, y) >= 0)) continue;
            seen.add(cell);
            spots.push({ x, y, gx, gy, d });
          }
        }
      }
    }
    if (spots.length > MAX_TREES) spots.sort((a, b) => a.d - b.d);
    const n = Math.min(spots.length, MAX_TREES);
    for (let i = 0; i < n; i++) {
      const { x, y, gx, gy } = spots[i];
      const height = 7 + 9 * hash(gx, gy, 4);
      const crown = 2.2 + 2.3 * hash(gx, gy, 5);
      tmp.position.set(x, y, height - crown * 0.8);
      tmp.rotation.set(0, 0, hash(gx, gy, 6) * Math.PI);
      tmp.scale.set(crown, crown, crown * 1.15);
      tmp.updateMatrix();
      this.canopies.setMatrixAt(i, tmp.matrix);
      this.colour.setHex(canopy[Math.floor(hash(gx, gy, 7) * canopy.length)]);
      this.canopies.setColorAt(i, this.colour);
      tmp.position.set(x, y, 0);
      tmp.rotation.set(0, 0, 0);
      tmp.scale.set(0.35, 0.35, height - crown * 1.2);
      tmp.updateMatrix();
      this.trunks.setMatrixAt(i, tmp.matrix);
    }
    this.canopies.count = this.trunks.count = n;
    this.canopies.instanceMatrix.needsUpdate = true;
    this.trunks.instanceMatrix.needsUpdate = true;
    if (this.canopies.instanceColor) this.canopies.instanceColor.needsUpdate = true;
    map.triggerRepaint();
  }
}
