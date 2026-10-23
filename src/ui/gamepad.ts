import { MapMouseEvent } from "maplibre-gl";
import type { App, Tool } from "./app";
import { h } from "./dom";

const DEAD = 0.18;
const TOOLS: Tool[] = ["select", "track", "station", "depot", "route", "remove"];

// Standard mapping button indices.
const A = 0, B = 1, X = 2, Y = 3, START = 9, LT = 6, RT = 7, UP = 12, DOWN = 13, LEFT = 14, RIGHT = 15;

/** Camera and basic actions from a standard-mapping controller, with a crosshair as the cursor. */
export class GamepadInput {
  private prev: boolean[] = [];
  private cross = h("div", {
    style: {
      position: "absolute",
      left: "50%",
      top: "50%",
      width: "18px",
      height: "18px",
      margin: "-9px 0 0 -9px",
      border: "2px solid var(--text)",
      borderRadius: "50%",
      pointerEvents: "none",
      zIndex: "2",
      display: "none",
    },
  });

  constructor(private app: App) {
    document.body.append(this.cross);
  }

  poll(dt: number) {
    const pad = navigator.getGamepads?.().find((p) => p && p.mapping === "standard");
    if (!pad) {
      this.cross.style.display = "none";
      return;
    }
    const map = this.app.map;
    const ax = (i: number) => (Math.abs(pad.axes[i] ?? 0) > DEAD ? pad.axes[i] : 0);
    const pressed = (i: number) => !!pad.buttons[i]?.pressed;
    const tapped = (i: number) => pressed(i) && !this.prev[i];
    const lx = ax(0), ly = ax(1), rx = ax(2), ry = ax(3);
    const zoom = (pad.buttons[RT]?.value ?? 0) - (pad.buttons[LT]?.value ?? 0);
    if (lx || ly || rx || ry || Math.abs(zoom) > 0.05) this.cross.style.display = "";
    if (lx || ly) map.panBy([lx * 900 * dt, ly * 900 * dt], { duration: 0 });
    if (rx) map.setBearing(map.getBearing() + rx * 90 * dt);
    if (ry) map.setPitch(Math.max(0, Math.min(75, map.getPitch() - ry * 60 * dt)));
    if (Math.abs(zoom) > 0.05) map.setZoom(map.getZoom() + zoom * 1.5 * dt);

    if (tapped(A)) this.clickCentre();
    if (tapped(B)) this.key("escape");
    if (tapped(X)) this.app.tools.finish();
    if (tapped(Y)) this.app.toggleXray();
    if (tapped(START)) this.app.game.setSpeed(this.app.game.speed === 0 ? 1 : 0);
    if (tapped(UP) || tapped(DOWN)) {
      const i = TOOLS.indexOf(this.app.tool);
      this.app.setTool(TOOLS[(i + (tapped(DOWN) ? 1 : TOOLS.length - 1)) % TOOLS.length]);
    }
    if (tapped(LEFT)) this.app.game.setSpeed(this.app.game.speed - 1);
    if (tapped(RIGHT)) this.app.game.setSpeed(this.app.game.speed + 1);
    this.prev = pad.buttons.map((b) => b.pressed);
  }

  private clickCentre() {
    const map = this.app.map;
    const rect = map.getCanvas().getBoundingClientRect();
    const init = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, bubbles: true };
    for (const type of ["mousemove", "click"]) {
      map.fire(new MapMouseEvent(type, map, new MouseEvent(type, init)));
    }
  }

  private key(k: string) {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: k === "escape" ? "Escape" : k }));
  }
}
