import type { Map as MapLibre } from "maplibre-gl";
import type { Game } from "../game/game";
import type { BuildKind, TrackCount } from "../game/data";
import { KIND_DEFAULT_LEVEL } from "../game/data";
import { GameLayers, type Handle, type RouteOverlay } from "../map/gameLayers";
import type { PlatformLayout } from "../game/model";
import { DEPOT_LENGTH } from "../game/network";
import { classifyDistricts, DISTRICTS, DISTRICT_COLOURS, DISTRICT_NAMES } from "../sim/districts";
import { applyTheme } from "../map/mapView";
import { BUILDING_OPACITY } from "../map/style";
import type { Scene3D } from "../render/scene3d";
import { saveSettings, applySettings, keyOf, type Action, type Settings } from "../settings";
import { h, svg } from "./dom";
import { icons } from "./icons";
import * as fmt from "./format";
import { MapTools } from "./tools";
import { renderPanel } from "./panels";
import { openFinance, openMenu, openSettings } from "./modals";

export type Tool = "select" | "station" | "connect" | "track" | "depot" | "route" | "remove";
export type Overlay = "none" | "population" | "jobs" | "districts" | "flows" | "crowding" | "travel";
export type Selection = { type: "station" | "edge" | "depot"; id: number } | null;

export interface TrackOptions {
  kind: BuildKind;
  level: number; // for loose track ends
  tracks: TrackCount;
}

export interface StationOptions {
  kind: BuildKind;
  level: number;
  platformLength: number;
  layout: PlatformLayout;
  heading: number;
}

const TOOL_ACTIONS: Tool[] = ["select", "station", "connect", "track", "depot", "route", "remove"];
const TOOL_NAMES: Record<Tool, string> = {
  select: "Select",
  station: "Stations",
  connect: "Connect stations",
  track: "Free track",
  depot: "Depots",
  route: "Routes",
  remove: "Remove",
};
const ROTATE_KEY_STEP = (15 * Math.PI) / 180;

export class App {
  tool: Tool = "select";
  selection: Selection = null;
  activeRoute: number | null = null;
  overlay: Overlay = "none";
  trackOpts: TrackOptions = { kind: "bored", level: KIND_DEFAULT_LEVEL.bored, tracks: 2 };
  stationOpts: StationOptions = { kind: "bored", level: KIND_DEFAULT_LEVEL.bored, platformLength: 150, layout: "island", heading: 0 };
  depotHeading = 0;
  readonly layers: GameLayers;
  readonly tools: MapTools;

  private panel = h("div", { class: "panel box" });
  private rail = h("div", { class: "rail box" });
  private bar = h("div", { class: "bar box" });
  private corner = h("div", { class: "corner box" });
  private legend = h("div", { class: "legend box", hidden: true });
  private log = h("div", { class: "log" });
  private menuEl: HTMLElement | null = null;
  private clockEl = h("span", { class: "num" });
  private moneyEl = h("span", { class: "num" });
  private ridersEl = h("span", { class: "num" });
  private savingEl = h("span", { class: "num" });
  private savingStat = h(
    "div",
    { class: "stat", hidden: true, title: "Keeping the city on this computer, so it opens straight away next time and works offline" },
    h("small", null, "Saving city"),
    this.savingEl,
  );
  private buildBtn = h("button", { class: "primary", onclick: () => this.build() });
  private speedBtns: HTMLButtonElement[] = [];
  private panelDirty = true;
  private holding = false;
  private lastLogCount = 0;
  private travelOrigin: [number, number] | null = null;

  constructor(
    readonly game: Game,
    readonly map: MapLibre,
    readonly scene: Scene3D,
    readonly settings: Settings,
    private onLoad: (name: string) => void,
    private onNewGame: () => void,
  ) {
    this.layers = new GameLayers(map, game, settings.theme);
    this.tools = new MapTools(this);
    document.body.append(this.rail, this.panel, this.bar, this.corner, this.legend, this.log);
    this.panel.addEventListener("pointerdown", () => (this.holding = true));
    window.addEventListener("pointerup", () => {
      if (!this.holding) return;
      this.holding = false;
      this.dirty();
    });
    this.buildRail();
    this.buildBar();
    this.buildCorner();

    game.on("network", () => {
      this.updateBar();
      this.layers.update();
      this.updateHandles();
      this.scene.rebuild();
      this.refreshOverlay();
      this.dirty();
    });
    game.on("day", () => {
      this.layers.updateRoutes();
      if (this.overlay === "flows" || this.overlay === "crowding") this.refreshOverlay();
      this.dirty();
    });
    game.on("money", () => this.updateBar());
    game.on("log", () => this.renderLog());
    game.on("speed", () => this.updateBar());
    game.on("gameover", () => this.dirty());

    map.on("zoomend", () => this.updateHandles());
    document.addEventListener("keydown", (e) => this.onKey(e));
    window.addEventListener("beforeunload", () => saveSettings(this.settings));
    this.setTool("select");
    this.renderLog();
  }

  dirty() {
    this.panelDirty = true;
  }

  /** Called every animation frame. */
  frame() {
    this.updateClock();
    if (!this.game.buildingsReady) this.updateBar();
    if (this.panelDirty) {
      this.panelDirty = false;
      const scroll = this.panel.scrollTop;
      const focused = document.activeElement as HTMLInputElement | null;
      // Don't rebuild while the user is typing in the panel or dragging one of its sliders.
      const typing = focused && this.panel.contains(focused) && focused.tagName === "INPUT" && focused.type !== "range" && focused.type !== "checkbox";
      if (typing || this.holding) {
        this.panelDirty = true;
      } else {
        this.panel.replaceChildren(...renderPanel(this));
        this.panel.scrollTop = scroll;
      }
    }
  }

  // ---- tools ------------------------------------------------------------------

  setTool(t: Tool) {
    if (this.tool !== t) this.tools.reset();
    this.tool = t;
    if (t !== "route") this.layers.highlightRoute(null);
    else if (this.activeRoute !== null) this.layers.highlightRoute(this.activeRoute);
    if (t !== "select") this.select(null);
    this.map.doubleClickZoom[t === "track" || t === "connect" ? "disable" : "enable"]();
    this.map.getCanvas().style.cursor = t === "select" ? "" : "crosshair";
    this.rail.querySelectorAll("button[data-tool]").forEach((b) => b.classList.toggle("on", (b as HTMLElement).dataset.tool === t));
    this.updateHandles();
    this.dirty();
  }

  select(s: Selection) {
    this.selection = s;
    const net = this.game.net;
    let knocked: number[] = [];
    if (s?.type === "edge" && net.edges.get(s.id)?.status === "planned") knocked = net.demolitionForEdge(net.edges.get(s.id)!);
    if (s?.type === "station" && net.stations.get(s.id)?.status === "planned") knocked = net.demolitionForStation(net.stations.get(s.id)!);
    if (s?.type === "depot" && net.depots.get(s.id)?.status === "planned") knocked = net.demolitionForDepot(net.depots.get(s.id)!);
    this.layers.setDemolition(knocked);
    this.updateHandles();
    this.dirty();
  }

  /** Turn handle for the selected planned station or depot, and bend points on planned track. */
  updateHandles() {
    const net = this.game.net;
    const out: Handle[] = [];
    const arm = 40 * this.tools.metresPerPixel();
    const s = this.selection;
    if (s?.type === "station") {
      const st = net.stations.get(s.id);
      if (st?.status === "planned") {
        const r = st.platformLength / 2 + arm;
        out.push({ kind: "rotate", owner: "station", id: st.id, cx: st.x, cy: st.y, x: st.x + Math.cos(st.heading) * r, y: st.y + Math.sin(st.heading) * r });
      }
    } else if (s?.type === "depot") {
      const d = net.depots.get(s.id);
      if (d?.status === "planned") {
        const r = DEPOT_LENGTH / 2 + arm;
        out.push({ kind: "rotate", owner: "depot", id: d.id, cx: d.x, cy: d.y, x: d.x + Math.cos(d.heading) * r, y: d.y + Math.sin(d.heading) * r });
      }
    }
    if (this.tool === "select" || this.tool === "connect" || this.tool === "track") {
      for (const e of net.edges.values()) {
        if (e.status !== "planned") continue;
        e.bends.forEach(([x, y], index) => out.push({ kind: "bend", edge: e.id, index, x, y }));
      }
    }
    this.layers.setHandles(out);
  }

  setActiveRoute(id: number | null) {
    this.activeRoute = id;
    this.layers.highlightRoute(id);
    this.dirty();
  }

  private buildRail() {
    for (const t of TOOL_ACTIONS) {
      const key = this.settings.keys[t as Action];
      const b = h("button", { title: `${TOOL_NAMES[t]} (${key.toUpperCase()})`, onclick: () => this.setTool(t) }, svg(icons[t]));
      b.dataset.tool = t;
      this.rail.append(b);
    }
    this.rail.append(h("hr"));
    this.rail.append(
      h("button", { title: "Undo (Ctrl+Z)", onclick: () => this.game.undo() }, svg(icons.undo)),
      h("button", { title: "Redo (Ctrl+Y)", onclick: () => this.game.redo() }, svg(icons.redo)),
    );
  }

  // ---- bottom bar ---------------------------------------------------------------

  private buildBar() {
    const speeds = h("div", { class: "speeds" });
    const labels = [icons.pause, icons.play1, icons.play2, icons.play3];
    const titles = ["Pause (Space)", "Normal speed: a minute a second (1)", "Fast: ten minutes a second (2)", "Fastest: a day a second (3)"];
    labels.forEach((ic, i) => {
      const b = h("button", { title: titles[i], onclick: () => this.game.setSpeed(i) }, svg(ic));
      (b.firstChild as SVGElement).setAttribute("width", "16");
      (b.firstChild as SVGElement).setAttribute("height", "16");
      this.speedBtns.push(b);
      speeds.append(b);
    });
    const clock = h("div", { class: "clock" }, this.clockEl);
    const money = h("div", { class: "stat clickable", title: "Finances", onclick: () => openFinance(this) }, h("small", null, "Money"), this.moneyEl);
    const riders = h("div", { class: "stat" }, h("small", null, "Riders today"), this.ridersEl);
    const build = h("div", null, this.buildBtn);
    this.bar.append(speeds, clock, money, riders, this.savingStat, build);
    this.updateBar();
  }

  updateBar() {
    const g = this.game;
    this.speedBtns.forEach((b, i) => b.classList.toggle("on", g.speed === i));
    this.moneyEl.textContent = g.state.sandbox.unlimitedMoney ? "Unlimited" : fmt.money(g.state.money);
    this.moneyEl.className = "num" + (g.state.money < 0 && !g.state.sandbox.unlimitedMoney ? " bad" : "");
    const planned = g.plannedCost;
    this.buildBtn.textContent = !g.buildingsReady
      ? `Loading buildings ${Math.round(g.buildingsProgress * 100)}%`
      : planned > 0
        ? `Build plans · ${fmt.money(planned)}`
        : "Nothing planned";
    this.buildBtn.disabled = planned <= 0 || g.state.gameOver || !g.buildingsReady;
  }

  private lastClock = "";
  private updateClock() {
    const g = this.game;
    const text = fmt.dateTime(g.date());
    if (text !== this.lastClock) {
      this.lastClock = text;
      this.clockEl.textContent = text;
      this.ridersEl.textContent = fmt.count(g.dayTally.riders);
      this.moneyEl.textContent = g.state.sandbox.unlimitedMoney ? "Unlimited" : fmt.money(g.state.money);
      if (this.overlay === "flows" || this.overlay === "crowding") {
        const hour = Math.floor(g.minuteOfDay() / 60);
        if (hour !== this.overlayHour) this.refreshOverlay();
      }
    }
  }

  /** Progress of saving the city to disk; null hides it. */
  setSaving(fraction: number | null) {
    this.savingStat.hidden = fraction === null;
    if (fraction !== null) this.savingEl.textContent = `${Math.floor(fraction * 100)}%`;
  }

  build() {
    const err = this.game.build();
    if (err) this.game.log(err, true);
    this.updateBar();
    this.dirty();
  }

  // ---- top right -------------------------------------------------------------

  private buildCorner() {
    const overlayBtn = h("button", { title: "Data overlays", onclick: () => this.toggleOverlayMenu() }, svg(icons.layers), h("span", { class: "label" }, "Overlays"));
    const xray = h("button", { title: "X-ray: see tunnels at their real depth (U)", onclick: () => this.toggleXray() }, svg(icons.xray));
    xray.dataset.role = "xray";
    const pitch = h("button", { title: "Tilt the camera", onclick: () => this.togglePitch() }, svg(icons.pitch));
    const theme = h("button", { title: "Light or dark", onclick: () => this.toggleTheme() }, svg(icons.theme));
    const menu = h("button", { title: "Menu", onclick: () => openMenu(this, this.onLoad, this.onNewGame) }, svg(icons.menu));
    this.corner.append(overlayBtn, pitch, xray, theme, menu);
  }

  private toggleOverlayMenu() {
    if (this.menuEl) {
      this.menuEl.remove();
      this.menuEl = null;
      return;
    }
    const items: [Overlay, string][] = [
      ["none", "No overlay"],
      ["population", "Population"],
      ["jobs", "Jobs"],
      ["flows", "Passenger flows"],
      ["crowding", "Crowding"],
      ["districts", "Districts"],
      ["travel", "Travel time from a point"],
    ];
    const menu = h(
      "div",
      { class: "menu box" },
      items.map(([id, label]) =>
        h(
          "button",
          {
            class: this.overlay === id ? "on" : "",
            onclick: () => {
              this.setOverlay(id);
              menu.remove();
              this.menuEl = null;
            },
          },
          label,
        ),
      ),
    );
    this.menuEl = menu;
    document.body.append(menu);
  }

  toggleXray() {
    this.scene.setXray(!this.scene.xray);
    const on = this.scene.xray;
    this.corner.querySelector('[data-role="xray"]')?.classList.toggle("on", on);
    this.map.setPaintProperty("buildings", "fill-extrusion-opacity", on ? 0.12 : BUILDING_OPACITY);
    if (on && this.map.getPitch() < 30) this.map.easeTo({ pitch: 55, duration: this.settings.reducedMotion ? 0 : 600 });
  }

  private togglePitch() {
    const target = this.map.getPitch() > 5 ? 0 : 50;
    this.map.easeTo({ pitch: target, duration: this.settings.reducedMotion ? 0 : 500 });
  }

  toggleTheme() {
    this.settings.theme = this.settings.theme === "light" ? "dark" : "light";
    applySettings(this.settings);
    applyTheme(this.map, this.settings.theme);
    this.layers.setTheme(this.settings.theme);
    this.scene.setTheme(this.settings.theme);
    saveSettings(this.settings);
    this.refreshOverlay();
  }

  // ---- overlays ----------------------------------------------------------------

  private overlayHour = -1;

  setOverlay(o: Overlay) {
    this.overlay = o;
    if (o !== "travel") this.travelOrigin = null;
    this.refreshOverlay();
    this.dirty();
  }

  setTravelOrigin(x: number, y: number) {
    this.travelOrigin = [x, y];
    this.refreshOverlay();
  }

  refreshOverlay() {
    const g = this.game;
    const hour = Math.floor(g.minuteOfDay() / 60);
    this.overlayHour = hour;
    const routeMode: RouteOverlay = this.overlay === "flows" ? "flows" : this.overlay === "crowding" ? "crowding" : "none";
    this.layers.setRouteOverlay(routeMode, hour);
    const grid = g.city.grid;
    const cellArea = (grid.cellSize * grid.cellSize) / 1e6;
    if (this.overlay === "population" || this.overlay === "jobs") {
      const values = this.overlay === "population" ? grid.layers.residents : grid.layers.jobs;
      // People per km² on a square-root scale: Moscow is dense nearly everywhere, so a log
      // scale flattens it into one colour.
      const lo = 500;
      const hi = this.overlay === "jobs" ? 60000 : 35000;
      this.layers.showGridOverlay(values, (v) => {
        const d = v / cellArea;
        if (d < lo) return [0, 0, 0, 0];
        return ramp(Math.min(1, Math.sqrt((d - lo) / (hi - lo))), this.overlay === "jobs");
      });
      this.showLegend(this.overlay === "population" ? "Residents per km²" : "Jobs per km²", "500", `${hi / 1000}k+`, this.overlay === "jobs");
    } else if (this.overlay === "districts") {
      const codes = this.districtCodes();
      this.layers.showGridOverlay(codes, (v) => {
        const name = DISTRICTS[v];
        if (name === "none") return [0, 0, 0, 0];
        const [r, gg, b] = DISTRICT_COLOURS[name];
        return [r, gg, b, 150];
      });
      this.legend.hidden = false;
      this.legend.replaceChildren(
        h("div", null, "Districts"),
        ...DISTRICTS.filter((d) => d !== "none").map((d) =>
          h(
            "div",
            { class: "row", style: { minHeight: "18px" } },
            h("span", { class: "chip", style: { background: `rgb(${DISTRICT_COLOURS[d].join(",")})` } }),
            h("span", { class: "muted" }, DISTRICT_NAMES[d]),
          ),
        ),
      );
    } else if (this.overlay === "travel") {
      if (!this.travelOrigin) {
        this.layers.showGridOverlay(null, () => [0, 0, 0, 0]);
        this.showLegend("Click the map to pick a starting point", "", "", false, true);
      } else {
        const [x, y] = this.travelOrigin;
        g.requestTravelTime(x, y, (minutes) => {
          this.layers.showGridOverlay(minutes, (m) => {
            if (m > 90) return [0, 0, 0, 0];
            return travelRamp(m / 90);
          });
          this.showLegend(`Door to door at ${String(hour).padStart(2, "0")}:30`, "0 min", "90 min", false, false, true);
        });
      }
    } else {
      this.layers.showGridOverlay(null, () => [0, 0, 0, 0]);
      if (this.overlay === "crowding") this.showCrowdingLegend(hour);
      else if (this.overlay === "flows") this.showLegend(`Line width shows riders per hour, ${String(hour).padStart(2, "0")}:00`, "", "", false, true);
      else this.legend.hidden = true;
    }
  }

  private showLegend(title: string, lo: string, hi: string, jobs: boolean, textOnly = false, travel = false) {
    this.legend.hidden = false;
    const grad = travel
      ? "linear-gradient(90deg, rgb(26,150,65), rgb(166,217,106), rgb(253,174,97), rgb(215,25,28))"
      : jobs
        ? "linear-gradient(90deg, rgba(240,180,60,0.2), rgb(214,96,28), rgb(120,30,20))"
        : "linear-gradient(90deg, rgba(90,150,210,0.2), rgb(40,100,190), rgb(20,30,110))";
    this.legend.replaceChildren(h("div", null, title));
    if (!textOnly) {
      this.legend.append(h("div", { class: "ramp", style: { background: grad } }), h("div", { class: "scale" }, h("span", null, lo), h("span", null, hi)));
    }
  }

  private districts: Uint8Array | null = null;

  private districtCodes(): Uint8Array {
    if (!this.districts) {
      const g = this.game.city.grid;
      this.districts = classifyDistricts({
        cols: g.cols,
        rows: g.rows,
        cellSize: g.cellSize,
        x0: g.x0,
        y0: g.y0,
        residents: g.layers.residents,
        jobs: g.layers.jobs,
        jobsIndustry: g.layers.jobsIndustry,
        nature: g.layers.nature,
        nightlife: g.layers.nightlife,
        centre: this.game.city.manifest.centre ?? [0, 0],
      });
    }
    return this.districts;
  }

  private showCrowdingLegend(hour: number) {
    this.legend.hidden = false;
    const steps: [string, string][] = [
      ["#3b9c5a", "under 60%"],
      ["#9bbf3a", "60–85%"],
      ["#e5b622", "85–100%"],
      ["#e67a22", "100–125%"],
      ["#d13b2f", "over 125%"],
    ];
    this.legend.replaceChildren(
      h("div", null, `Train load at ${String(hour).padStart(2, "0")}:00`),
      ...steps.map(([c, t]) => h("div", { class: "row", style: { minHeight: "18px" } }, h("span", { class: "chip", style: { background: c } }), h("span", { class: "muted" }, t))),
    );
  }

  // ---- log ---------------------------------------------------------------------

  private renderLog() {
    const entries = this.game.logEntries;
    const fresh = entries.slice(this.lastLogCount);
    this.lastLogCount = entries.length;
    for (const e of fresh) {
      const d = this.game.date(e.time);
      const el = h("div", { class: `entry box${e.important ? " important" : ""}` }, h("time", null, fmt.shortDate(d)), e.text);
      this.log.append(el);
      setTimeout(() => el.remove(), e.important ? 12000 : 5000);
    }
    while (this.log.children.length > 4) this.log.firstElementChild?.remove();
  }

  // ---- keyboard ----------------------------------------------------------------

  private onKey(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA") return;
    if (document.querySelector(".backdrop")) return;
    const key = keyOf(e);
    const action = (Object.keys(this.settings.keys) as Action[]).find((a) => this.settings.keys[a] === key);
    if (!action) return;
    e.preventDefault();
    const g = this.game;
    switch (action) {
      case "select":
      case "connect":
      case "track":
      case "station":
      case "depot":
      case "route":
      case "remove":
        this.setTool(action);
        break;
      case "rotateLeft":
      case "rotateRight":
        this.tools.rotateSelected(action === "rotateLeft" ? ROTATE_KEY_STEP : -ROTATE_KEY_STEP);
        break;
      case "pause":
        if (g.speed === 0) g.setSpeed(this.lastSpeed ?? 1);
        else {
          this.lastSpeed = g.speed;
          g.setSpeed(0);
        }
        break;
      case "speed1":
      case "speed2":
      case "speed3":
        g.setSpeed(Number(action.slice(-1)));
        break;
      case "undo":
        g.undo();
        break;
      case "redo":
        g.redo();
        break;
      case "build":
        this.build();
        break;
      case "xray":
        this.toggleXray();
        break;
      case "deeper":
      case "shallower":
        this.tools.adjustLevel(action === "deeper" ? -1 : 1);
        break;
      case "finish":
        this.tools.finish();
        break;
      case "cancel":
        if (this.menuEl) {
          this.menuEl.remove();
          this.menuEl = null;
        } else if (!this.tools.cancel()) {
          if (this.selection) this.select(null);
          else this.setTool("select");
        }
        break;
    }
  }

  private lastSpeed: number | null = null;

  openSettings() {
    openSettings(this);
  }
}

function ramp(t: number, jobs: boolean): [number, number, number, number] {
  // Blue for homes, orange for jobs; alpha rises with density.
  const a = Math.round(30 + 200 * t);
  if (jobs) return [Math.round(250 - 130 * t), Math.round(190 - 160 * t), Math.round(90 - 70 * t), a];
  return [Math.round(130 - 110 * t), Math.round(180 - 150 * t), Math.round(230 - 120 * t), a];
}

function travelRamp(t: number): [number, number, number, number] {
  const stops = [
    [26, 150, 65],
    [166, 217, 106],
    [253, 174, 97],
    [215, 25, 28],
  ];
  const f = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(f));
  const u = f - i;
  const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * u));
  return [c[0], c[1], c[2], 150];
}
