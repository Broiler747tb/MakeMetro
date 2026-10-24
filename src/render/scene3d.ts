import * as THREE from "three";
import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map as MapLibre } from "maplibre-gl";
import type { Game } from "../game/game";
import { legPoint, tripPose, type CompiledLeg } from "../game/service";
import { CORRIDOR_HALF_WIDTH } from "../game/data";
import { cumulative } from "../game/geometry";
import { DEPOT_LENGTH, DEPOT_WIDTH, platformWidth } from "../game/network";
import { People } from "./people";
import { Shadows } from "./shadows";
import { Trees } from "./trees";

const MAX_CARS = 30000;
const EARTH_CIRCUMFERENCE = 40075016.686;

/** Trains, viaducts and (in x-ray) tunnels, drawn with three.js inside the map's WebGL context. */
export class Scene3D implements CustomLayerInterface {
  readonly id = "mm-3d";
  readonly type = "custom" as const;
  readonly renderingMode = "3d" as const;
  xray = false;

  private map!: MapLibre;
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.Camera();
  private model = new THREE.Matrix4();
  private surfaceCars!: THREE.InstancedMesh;
  private undergroundCars!: THREE.InstancedMesh;
  private structures = new THREE.Group();
  private tunnels = new THREE.Group();
  private tmp = new THREE.Object3D();

  private carMaterials: THREE.MeshLambertMaterial[] = [];
  private people: People;
  private trees: Trees | null = null;
  private treeTimer = 0;
  private shadows: Shadows | null = null;
  private shadowScene = new THREE.Scene();

  /** Building shadows go under the buildings, so they get a map layer of their own. */
  readonly shadowLayer: CustomLayerInterface = {
    id: "mm-shadows",
    type: "custom",
    renderingMode: "2d",
    render: (_gl, options) => this.renderShadows(options),
  };

  constructor(
    private game: Game,
    private theme: "light" | "dark",
  ) {
    this.people = new People(game);
  }

  onAdd(map: MapLibre, gl: WebGL2RenderingContext) {
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
    this.renderer.autoClear = false;

    const [lon0, lat0] = this.game.city.proj.toLngLat(0, 0);
    const origin = MercatorCoordinate.fromLngLat([lon0, lat0], 0);
    const s = origin.meterInMercatorCoordinateUnits();
    this.model.makeTranslation(origin.x, origin.y, origin.z).scale(new THREE.Vector3(s, -s, s));

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(-0.5, -0.8, 1.5);
    this.scene.add(sun);

    // Trains are pale cars on top of the coloured line, so they read against it in either theme.
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
    const carColour = { color: 0xf4f4f2, emissive: 0x505050 };
    this.carMaterials = [];
    const surfaceMat = new THREE.MeshLambertMaterial(carColour);
    this.surfaceCars = new THREE.InstancedMesh(box, surfaceMat, MAX_CARS);
    this.surfaceCars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.surfaceCars.frustumCulled = false;
    // Underground trains draw through buildings so you can follow them without x-ray.
    const undergroundMat = new THREE.MeshLambertMaterial({ ...carColour, depthTest: false, transparent: true, opacity: 0.92 });
    this.undergroundCars = new THREE.InstancedMesh(box, undergroundMat, MAX_CARS);
    this.carMaterials = [surfaceMat, undergroundMat];
    this.setTheme(this.theme);
    this.undergroundCars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.undergroundCars.frustumCulled = false;
    this.undergroundCars.renderOrder = 10;
    this.scene.add(this.surfaceCars, this.undergroundCars, this.structures, this.tunnels, this.people.mesh);
    this.trees = new Trees(map, this.game, this.theme);
    this.scene.add(this.trees.group);
    this.shadows = new Shadows(map, this.game, this.theme);
    this.shadowScene.add(this.shadows.group);
    map.on("moveend", () => this.queueTrees(false));
    // Tiles finishing loading can bring parks that weren't there when the view stopped.
    map.on("sourcedata", (e) => {
      if (e.sourceId === "base" && e.isSourceLoaded) this.queueTrees(true);
    });
    this.rebuild();
  }

  /** Pale cars on the dark map, dark cars on the light one. */
  setTheme(theme: "light" | "dark") {
    this.theme = theme;
    for (const m of this.carMaterials) {
      m.color.set(theme === "dark" ? 0xf4f4f2 : 0x26272b);
      m.emissive.set(theme === "dark" ? 0x505050 : 0x111111);
    }
    this.people.setTheme(theme);
    this.trees?.setTheme(theme);
    this.shadows?.setTheme(theme);
    this.map?.triggerRepaint();
  }

  private queueTrees(fresh: boolean) {
    clearTimeout(this.treeTimer);
    this.treeTimer = window.setTimeout(() => this.trees?.update(fresh), 250);
  }

  setXray(on: boolean) {
    if (this.trees) this.trees.group.visible = !on;
    this.xray = on;
    this.tunnels.visible = on;
    (this.undergroundCars.material as THREE.MeshLambertMaterial).depthTest = on;
    this.map?.triggerRepaint();
  }

  /** Rebuilds static geometry after the network changes. */
  rebuild() {
    if (!this.map) return;
    this.queueTrees(false);
    for (const g of [this.structures, this.tunnels]) {
      for (const child of [...g.children]) {
        g.remove(child);
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      }
    }
    const net = this.game.net;
    const deckMat = new THREE.MeshLambertMaterial({ color: 0x9a9da2 });
    const deckPlanned = new THREE.MeshLambertMaterial({ color: 0x9a9da2, transparent: true, opacity: 0.35 });
    const decks: THREE.Matrix4[] = [];
    const decksPlanned: THREE.Matrix4[] = [];
    const pillars: THREE.Matrix4[] = [];
    const tubes: THREE.Matrix4[] = [];
    const tmp = this.tmp;

    for (const e of net.edges.values()) {
      // Platforms are drawn with their stations below, so tunnels stop at the platform ends.
      if (e.platform !== undefined) continue;
      const levels = net.edgeLevels(e);
      const cum = cumulative(e.pts);
      const width = CORRIDOR_HALF_WIDTH[e.tracks] * 1.4;
      for (let i = 0; i + 3 < e.pts.length; i += 2) {
        const ax = e.pts[i], ay = e.pts[i + 1], bx = e.pts[i + 2], by = e.pts[i + 3];
        const la = levels[i / 2], lb = levels[i / 2 + 1];
        const len = Math.hypot(bx - ax, by - ay);
        if (len < 0.01) continue;
        const mid = (la + lb) / 2;
        if (mid > 2) {
          tmp.position.set((ax + bx) / 2, (ay + by) / 2, mid - 1);
          tmp.rotation.set(0, 0, Math.atan2(by - ay, bx - ax));
          tmp.scale.set(len + 0.3, width, 1.2);
          tmp.updateMatrix();
          (e.status === "planned" ? decksPlanned : decks).push(tmp.matrix.clone());
          // A pillar every 35 m or so
          const s0 = cum[i / 2];
          const s1 = cum[i / 2 + 1];
          for (let s = Math.ceil(s0 / 35) * 35; s < s1; s += 35) {
            const f = (s - s0) / (s1 - s0);
            const lv = la + (lb - la) * f;
            if (lv < 3) continue;
            tmp.position.set(ax + (bx - ax) * f, ay + (by - ay) * f, 0);
            tmp.rotation.set(0, 0, 0);
            tmp.scale.set(1.6, 1.6, lv - 1);
            tmp.updateMatrix();
            if (e.status !== "planned") pillars.push(tmp.matrix.clone());
          }
        } else if (mid < -1) {
          tmp.position.set((ax + bx) / 2, (ay + by) / 2, mid - 3);
          tmp.rotation.set(0, 0, Math.atan2(by - ay, bx - ax));
          tmp.scale.set(len + 0.3, width, 6);
          tmp.updateMatrix();
          tubes.push(tmp.matrix.clone());
        }
      }
    }
    const unit = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
    const addInstanced = (mats: THREE.Matrix4[], mat: THREE.Material, group: THREE.Group) => {
      if (!mats.length) return;
      const mesh = new THREE.InstancedMesh(unit, mat, mats.length);
      mats.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.frustumCulled = false;
      group.add(mesh);
    };
    addInstanced(decks, deckMat, this.structures);
    addInstanced(decksPlanned, deckPlanned, this.structures);

    // See-through materials don't write depth, so overlapping pieces never flicker against each other.
    const glass = (color: number, opacity: number, order: number) => {
      const m = new THREE.MeshLambertMaterial({ color, transparent: true, opacity, depthWrite: false });
      return { m, order };
    };
    const addGlass = (mats: THREE.Matrix4[], g: { m: THREE.Material; order: number }, group: THREE.Group) => {
      addInstanced(mats, g.m, group);
      const last = group.children[group.children.length - 1];
      if (mats.length && last) last.renderOrder = g.order;
    };
    addGlass(tubes, glass(0x8d9198, 0.45, 1), this.tunnels);

    const box = (x: number, y: number, heading: number, length: number, width: number, z0: number, z1: number) => {
      tmp.position.set(x, y, z0);
      tmp.rotation.set(0, 0, heading);
      tmp.scale.set(length, width, Math.max(0.1, z1 - z0));
      tmp.updateMatrix();
      return tmp.matrix.clone();
    };
    const halls: THREE.Matrix4[] = [];
    const slabs: THREE.Matrix4[] = [];
    const slabsPlanned: THREE.Matrix4[] = [];
    const roofs: THREE.Matrix4[] = [];
    for (const st of net.stations.values()) {
      const w = platformWidth(st);
      const planned = st.status === "planned";
      if (st.level < -2) {
        // Underground hall, kept clear of the surface even for shallow stations.
        halls.push(box(st.x, st.y, st.heading, st.platformLength, w + 6, st.level - 2, Math.min(st.level + 5, -1.5)));
        continue;
      }
      const top = Math.max(0, st.level);
      (planned ? slabsPlanned : slabs).push(box(st.x, st.y, st.heading, st.platformLength, w + 4, top - (top > 0 ? 1.5 : 0), top + 0.9));
      if (!planned) roofs.push(box(st.x, st.y, st.heading, st.platformLength * 0.9, w + 2, top + 4, top + 4.3));
      if (top > 2 && !planned) {
        const ux = Math.cos(st.heading), uy = Math.sin(st.heading);
        for (let k = -st.platformLength / 2 + 10; k < st.platformLength / 2; k += 25) {
          pillars.push(box(st.x + ux * k, st.y + uy * k, 0, 2, 2, 0, top - 1.5));
        }
      }
    }
    addGlass(halls, glass(0xe4e6ea, 0.6, 2), this.tunnels);
    addInstanced(slabs, new THREE.MeshLambertMaterial({ color: 0xb8bbbf }), this.structures);
    addInstanced(slabsPlanned, new THREE.MeshLambertMaterial({ color: 0xb8bbbf, transparent: true, opacity: 0.4, depthWrite: false }), this.structures);
    addInstanced(roofs, new THREE.MeshLambertMaterial({ color: 0x8a8d92 }), this.structures);
    addInstanced(pillars, new THREE.MeshLambertMaterial({ color: 0x8a8d92 }), this.structures);

    const yards: THREE.Matrix4[] = [];
    const sheds: THREE.Matrix4[] = [];
    for (const d of net.depots.values()) {
      if (d.status === "planned") continue;
      yards.push(box(d.x, d.y, d.heading, DEPOT_LENGTH, DEPOT_WIDTH, 0, 0.4));
      const ux = Math.cos(d.heading), uy = Math.sin(d.heading);
      sheds.push(box(d.x - ux * DEPOT_LENGTH * 0.18, d.y - uy * DEPOT_LENGTH * 0.18, d.heading, DEPOT_LENGTH * 0.6, DEPOT_WIDTH * 0.75, 0, 9));
    }
    addInstanced(yards, new THREE.MeshLambertMaterial({ color: 0xa9a59b }), this.structures);
    addInstanced(sheds, new THREE.MeshLambertMaterial({ color: 0xc4c6c9 }), this.structures);
    this.tunnels.visible = this.xray;
    this.map.triggerRepaint();
  }

  private metresPerPixel(): number {
    const lat = this.map.getCenter().lat;
    return (EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** this.map.getZoom());
  }

  private updateTrains() {
    const g = this.game;
    const now = g.state.time;
    const mpp = this.metresPerPixel();
    // Real size when zoomed in; when zoomed out, a short pill a few pixels wide.
    const width = Math.max(3.2, mpp * 4.5);
    const height = Math.max(3.8, mpp * 2.5);
    let ns = 0;
    let nu = 0;
    const tmp = this.tmp;
    for (const trip of g.trips) {
      const c = g.compiled.get(trip.route);
      if (!c) continue;
      const pose = tripPose(c, trip, now);
      if (!pose) continue;
      const legs = c.legs[trip.dir];
      const legIndex = legs.indexOf(pose.leg);
      const carLen = Math.max(c.tt.carLength * c.route.cars, width * 2.4) / c.route.cars;
      // Trains stop centred on the platform, so the nose runs half a train ahead of the stop.
      const half = (carLen * c.route.cars) / 2;
      for (let k = 0; k < c.route.cars; k++) {
        let s = pose.s + half - (k + 0.5) * carLen;
        let leg: CompiledLeg = pose.leg;
        let li = legIndex;
        while (s < 0 && li > 0) {
          li--;
          leg = legs[li];
          s += leg.profile.length;
        }
        while (s > leg.profile.length && li < legs.length - 1) {
          s -= leg.profile.length;
          li++;
          leg = legs[li];
        }
        const p = legPoint(leg, s);
        const underground = p.level < -1;
        const z = underground ? (this.xray ? p.level - 2 : 0.5) : Math.max(0.3, p.level);
        tmp.position.set(p.x, p.y, z);
        tmp.rotation.set(0, 0, Math.atan2(p.dy, p.dx));
        tmp.scale.set(carLen * (width > 6 ? 1.02 : 0.9), width, height);
        tmp.updateMatrix();
        if (underground) {
          if (nu >= MAX_CARS) continue;
          this.undergroundCars.setMatrixAt(nu++, tmp.matrix);
        } else {
          if (ns >= MAX_CARS) continue;
          this.surfaceCars.setMatrixAt(ns++, tmp.matrix);
        }
      }
    }
    this.surfaceCars.count = ns;
    this.undergroundCars.count = nu;
    this.surfaceCars.instanceMatrix.needsUpdate = true;
    this.undergroundCars.instanceMatrix.needsUpdate = true;
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, options: CustomRenderMethodInput) {
    this.updateTrains();
    // People only make sense close up; at the fastest speed they skip ahead and vanish.
    const zoom = this.map.getZoom();
    this.people.update(zoom >= 14, Math.max(1.6, this.metresPerPixel() * 3));
    this.setCamera(options);
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
  }

  private renderShadows(options: CustomRenderMethodInput) {
    if (!this.shadows || this.xray) return;
    const building = this.shadows.frame();
    this.setCamera(options);
    this.renderer.resetState();
    this.renderer.render(this.shadowScene, this.camera);
    if (building) this.map.triggerRepaint();
  }

  private setCamera(options: CustomRenderMethodInput) {
    const mvp = new THREE.Matrix4().fromArray(options.defaultProjectionData.mainMatrix as unknown as number[]);
    this.camera.projectionMatrix = mvp.multiply(this.model);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
  }

  onRemove() {
    this.renderer?.dispose();
  }
}
