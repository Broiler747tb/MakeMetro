import * as THREE from "three";
import type { Game } from "../game/game";

const MAX_PEOPLE = 6000;
const RIDERS_PER_DOT = 10;
const WALK_SPEED = 1.3;

interface Walker {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t0: number;
  t1: number;
}

/**
 * Pedestrians walking to and from station entrances, spawned in proportion to each
 * station's entries and exits this hour. Purely visual.
 */
export class People {
  readonly mesh: THREE.InstancedMesh;
  private walkers: Walker[] = [];
  private owed = new Map<number, number>(); // station id -> fractional dots not yet spawned
  private lastTime = -1;
  private tmp = new THREE.Object3D();

  constructor(private game: Game) {
    const geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 8).rotateX(Math.PI / 2).translate(0, 0, 0.5);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0x26272b }), MAX_PEOPLE);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  setTheme(theme: "light" | "dark") {
    (this.mesh.material as THREE.MeshBasicMaterial).color.set(theme === "dark" ? 0xd8d9dc : 0x26272b);
  }

  update(visible: boolean, size: number) {
    const g = this.game;
    const now = g.state.time;
    const dt = this.lastTime < 0 ? 0 : now - this.lastTime;
    this.lastTime = now;
    // Skip big jumps (fastest speed, loading a save): people would only flicker.
    if (!visible || dt <= 0 || dt > 120 || !g.today) {
      if (!visible || dt > 120) this.walkers = [];
      this.mesh.count = 0;
      if (!visible) return;
    } else {
      this.spawn(now, dt);
    }
    this.walkers = this.walkers.filter((w) => w.t1 > now);
    const tmp = this.tmp;
    let n = 0;
    for (const w of this.walkers) {
      if (w.t0 > now || n >= MAX_PEOPLE) continue;
      const f = (now - w.t0) / (w.t1 - w.t0);
      tmp.position.set(w.x0 + (w.x1 - w.x0) * f, w.y0 + (w.y1 - w.y0) * f, 0.3);
      tmp.scale.set(size, size, size * 0.6);
      tmp.updateMatrix();
      this.mesh.setMatrixAt(n++, tmp.matrix);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private spawn(now: number, dt: number) {
    const g = this.game;
    const hour = Math.floor((now % 86400) / 3600);
    for (const s of g.today!.stations) {
      const st = g.net.stations.get(s.id);
      if (!st || st.status !== "built" || !st.entrances.length) continue;
      const perSecond = (s.entries[hour] + s.exits[hour]) / 3600 / RIDERS_PER_DOT;
      let owed = (this.owed.get(s.id) ?? 0) + perSecond * dt;
      while (owed >= 1 && this.walkers.length < MAX_PEOPLE) {
        owed -= 1;
        const [ex, ey] = st.entrances[Math.floor(Math.random() * st.entrances.length)];
        const r = 120 + 650 * Math.sqrt(Math.random());
        const a = Math.random() * Math.PI * 2;
        const ox = ex + Math.cos(a) * r;
        const oy = ey + Math.sin(a) * r;
        const t = (r * 1.25) / WALK_SPEED;
        const start = now - Math.random() * dt;
        const entering = Math.random() * (s.entries[hour] + s.exits[hour]) < s.entries[hour];
        this.walkers.push(entering ? { x0: ox, y0: oy, x1: ex, y1: ey, t0: start, t1: start + t } : { x0: ex, y0: ey, x1: ox, y1: oy, t0: start, t1: start + t });
      }
      this.owed.set(s.id, owed);
    }
  }
}
