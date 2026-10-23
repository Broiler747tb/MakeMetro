import type { MapMouseEvent } from "maplibre-gl";
import type { App } from "./app";
import type { Target, TrackPreview } from "../game/network";
import { DEPOT_LENGTH, DEPOT_WIDTH } from "../game/network";
import { boxAround, type Vec2 } from "../game/geometry";
import { KIND_LEVEL_RANGE } from "../game/data";
import { LAYER_IDS } from "../map/gameLayers";
import { BUILDING_KINDS } from "../city/buildings";
import { h, modal } from "./dom";
import * as fmt from "./format";

const SNAP_PX = 12;
const DRAG_PX = 4;
const ROTATE_STEP = (5 * Math.PI) / 180;

type Drag =
  | { kind: "maybe-bend"; edge: number; at: Vec2; px: [number, number] }
  | { kind: "bend"; edge: number; index: number; before: string }
  | { kind: "maybe-move"; owner: "station" | "depot"; id: number; offset: Vec2; px: [number, number] }
  | { kind: "move"; owner: "station" | "depot"; id: number; offset: Vec2; before: string }
  | { kind: "rotate"; owner: "station" | "depot"; id: number; before: string }
  | { kind: "entrance"; station: number; index: number; before: string };

/** A connection in progress: where it starts and the bends clicked on the way. */
interface Chain {
  from: Target;
  bends: Vec2[];
}

export class MapTools {
  chain: Chain | null = null;
  hover: { x: number; y: number; target: Target } | null = null;
  preview: TrackPreview | null = null;
  private drag: Drag | null = null;
  private suppressClick = false;
  private queued = false;
  private tip = h("div", { class: "tip box", hidden: true });

  constructor(private app: App) {
    const map = app.map;
    document.body.append(this.tip);
    map.on("mousemove", (e) => this.onMove(e));
    map.on("click", (e) => this.onClick(e));
    map.on("dblclick", (e) => {
      if (app.tool === "track" || app.tool === "connect") {
        e.preventDefault();
        this.finish();
      }
    });
    map.on("contextmenu", (e) => this.onRightClick(e));
    map.on("mousedown", (e) => this.onMouseDown(e));
    window.addEventListener("mouseup", () => this.endDrag());
    map.getCanvas().addEventListener("mouseleave", () => (this.tip.hidden = true));
  }

  private local(e: MapMouseEvent): Vec2 {
    return this.app.game.city.proj.toLocal(e.lngLat.lng, e.lngLat.lat);
  }

  metresPerPixel(): number {
    const map = this.app.map;
    const lat = map.getCenter().lat;
    return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
  }

  private tolerance(): number {
    return SNAP_PX * this.metresPerPixel();
  }

  private trackOptions(bends: Vec2[] = []) {
    const o = this.app.trackOpts;
    return { kind: o.kind, tracks: o.tracks, level: o.level, bends };
  }

  reset() {
    this.chain = null;
    this.preview = null;
    this.hover = null;
    this.app.layers.setPreview([], [], []);
    this.app.layers.setDemolition([]);
  }

  cancel(): boolean {
    if (this.chain) {
      this.reset();
      this.app.dirty();
      return true;
    }
    return false;
  }

  /** Depth keys: change the depth of the selected planned station, or of new track ends. */
  adjustLevel(dir: number) {
    const app = this.app;
    const sel = app.selection;
    const st = sel?.type === "station" ? app.game.net.stations.get(sel.id) : undefined;
    if (st && st.status === "planned") {
      const [lo, hi] = KIND_LEVEL_RANGE[st.kind];
      const level = Math.max(lo, Math.min(hi, st.level + dir * (st.kind === "bored" ? 5 : 1)));
      app.game.edit(() => app.game.net.setStationLevel(st, st.kind, level));
      return;
    }
    const o = app.tool === "station" ? app.stationOpts : app.trackOpts;
    const [lo, hi] = KIND_LEVEL_RANGE[o.kind];
    o.level = Math.max(lo, Math.min(hi, o.level + dir * (o.kind === "bored" ? 5 : 1)));
    this.queuePreview();
    app.dirty();
  }

  /** Turns the selected planned station or depot, or the next one to be placed. */
  rotateSelected(delta: number) {
    const app = this.app;
    const sel = app.selection;
    const net = app.game.net;
    if (sel?.type === "station" && net.stations.get(sel.id)?.status === "planned") {
      const st = net.stations.get(sel.id)!;
      app.game.edit(() => {
        net.poseStation(st, st.x, st.y, st.heading + delta);
        st.aimed = true;
      });
      app.stationOpts.heading = st.heading;
    } else if (sel?.type === "depot" && net.depots.get(sel.id)?.status === "planned") {
      const d = net.depots.get(sel.id)!;
      app.game.edit(() => net.poseDepot(d, d.x, d.y, d.heading + delta));
      app.depotHeading = d.heading;
    } else if (app.tool === "station") {
      app.stationOpts.heading += delta;
      this.queuePreview();
    } else if (app.tool === "depot") {
      app.depotHeading += delta;
      this.queuePreview();
    }
    app.updateHandles();
  }

  /** Ends the connection in progress; with the free track tool, at the last point clicked. */
  finish() {
    const app = this.app;
    const c = this.chain;
    if (!c) return;
    if (app.tool === "track" && c.bends.length) {
      const end = c.bends[c.bends.length - 1];
      app.game.edit(() => app.game.net.connect(c.from, { type: "free", x: end[0], y: end[1] }, this.trackOptions(c.bends.slice(0, -1))));
    }
    this.reset();
    app.dirty();
  }

  private queuePreview() {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.updatePreview();
    });
  }

  private updatePreview() {
    const app = this.app;
    const net = app.game.net;
    const layers = app.layers;
    const hv = this.hover;
    if (app.tool === "connect" || app.tool === "track") {
      const c = this.chain;
      if (c && hv) {
        this.preview = net.previewConnect(c.from, hv.target, this.trackOptions(c.bends));
        const p = this.preview;
        layers.setPreview(p ? [{ pts: p.pts, bad: p.problems.length > 0 }] : [], c.bends.map(([x, y]) => ({ x, y, bad: false })), []);
        layers.setDemolition(p?.demolish ?? []);
      } else {
        this.preview = null;
        layers.setPreview([], hv && hv.target.type !== "free" ? [{ x: hv.target.x, y: hv.target.y, bad: false }] : [], []);
        layers.setDemolition([]);
      }
      app.dirty();
    } else if ((app.tool === "station" || app.tool === "depot") && hv) {
      if (hv.target.type === "station" || hv.target.type === "depot") {
        layers.setPreview([], [], []);
        return;
      }
      const o = app.stationOpts;
      const ghost =
        app.tool === "station"
          ? boxAround(hv.x, hv.y, o.heading, o.platformLength, o.layout === "island" ? 14 : 20)
          : boxAround(hv.x, hv.y, app.depotHeading, DEPOT_LENGTH, DEPOT_WIDTH);
      layers.setPreview([], [], [{ ring: ghost, bad: false }]);
    }
  }

  // ---- pointer --------------------------------------------------------------

  private onMove(e: MapMouseEvent) {
    const app = this.app;
    const [x, y] = this.local(e);
    if (this.drag) {
      this.continueDrag(this.drag, e, x, y);
      return;
    }
    if (app.tool === "select") {
      this.hoverInfo(e, x, y);
      return;
    }
    const target = app.game.net.hit(x, y, this.tolerance());
    this.hover = { x, y, target };
    app.map.getCanvas().style.cursor = target.type === "free" ? "crosshair" : "pointer";
    this.queuePreview();
  }

  private continueDrag(d: Drag, e: MapMouseEvent, x: number, y: number) {
    const app = this.app;
    const net = app.game.net;
    const moved = (px: [number, number]) => Math.hypot(e.point.x - px[0], e.point.y - px[1]) > DRAG_PX;
    switch (d.kind) {
      case "maybe-bend": {
        if (!moved(d.px)) return;
        const before = app.game.beginEdit();
        const index = net.insertBend(net.edges.get(d.edge)!, d.at[0], d.at[1]);
        this.drag = { kind: "bend", edge: d.edge, index, before };
        this.suppressClick = true;
        break;
      }
      case "bend":
        net.moveBend(net.edges.get(d.edge)!, d.index, x, y);
        app.layers.update();
        app.updateHandles();
        break;
      case "maybe-move":
        if (!moved(d.px)) return;
        this.drag = { ...d, kind: "move", before: app.game.beginEdit() };
        this.suppressClick = true;
        break;
      case "move":
        if (d.owner === "station") {
          const st = net.stations.get(d.id)!;
          net.poseStation(st, x - d.offset[0], y - d.offset[1], st.heading);
        } else {
          const dp = net.depots.get(d.id)!;
          net.poseDepot(dp, x - d.offset[0], y - d.offset[1], dp.heading);
        }
        app.layers.update();
        app.updateHandles();
        break;
      case "rotate": {
        const o = d.owner === "station" ? net.stations.get(d.id)! : net.depots.get(d.id)!;
        let heading = Math.atan2(y - o.y, x - o.x);
        if (!e.originalEvent.shiftKey) heading = Math.round(heading / ROTATE_STEP) * ROTATE_STEP;
        if (d.owner === "station") {
          const st = net.stations.get(d.id)!;
          net.poseStation(st, st.x, st.y, heading);
          st.aimed = true;
          app.stationOpts.heading = heading;
        } else {
          const dp = net.depots.get(d.id)!;
          net.poseDepot(dp, dp.x, dp.y, heading);
          app.depotHeading = heading;
        }
        app.layers.update();
        app.updateHandles();
        break;
      }
      case "entrance": {
        const st = net.stations.get(d.station);
        if (st) st.entrances[d.index] = [x, y];
        app.layers.update();
        break;
      }
    }
  }

  private onMouseDown(e: MapMouseEvent) {
    const app = this.app;
    if (e.originalEvent.button !== 0) return;
    const net = app.game.net;
    const tool = app.tool;
    const [x, y] = this.local(e);
    const begin = (d: Drag) => {
      e.preventDefault();
      app.map.dragPan.disable();
      this.drag = d;
    };
    const handle = app.map.queryRenderedFeatures(e.point, { layers: [LAYER_IDS.handles] })[0];
    if (handle) {
      const p = handle.properties as { kind: string; owner: "station" | "depot"; id: number; edge: number; index: number };
      if (p.kind === "rotate") return begin({ kind: "rotate", owner: p.owner, id: p.id, before: app.game.beginEdit() });
      if (p.kind === "bend") return begin({ kind: "bend", edge: p.edge, index: p.index, before: app.game.beginEdit() });
    }
    if (tool === "select") {
      const ent = app.map.queryRenderedFeatures(e.point, { layers: [LAYER_IDS.entrances] })[0];
      if (ent) {
        const p = ent.properties as { station: number; index: number };
        return begin({ kind: "entrance", station: p.station, index: p.index, before: app.game.beginEdit() });
      }
    }
    const t = net.hit(x, y, this.tolerance());
    const point: [number, number] = [e.point.x, e.point.y];
    if (tool === "select" || tool === "station" || tool === "depot") {
      if (t.type === "station" && net.stations.get(t.station)!.status === "planned") {
        const st = net.stations.get(t.station)!;
        return begin({ kind: "maybe-move", owner: "station", id: st.id, offset: [x - st.x, y - st.y], px: point });
      }
      if (t.type === "depot" && net.depots.get(t.depot)!.status === "planned") {
        const dp = net.depots.get(t.depot)!;
        return begin({ kind: "maybe-move", owner: "depot", id: dp.id, offset: [x - dp.x, y - dp.y], px: point });
      }
    }
    if ((tool === "select" || (tool === "connect" && !this.chain)) && t.type === "edge" && net.edges.get(t.edge)!.status === "planned") {
      return begin({ kind: "maybe-bend", edge: t.edge, at: [t.x, t.y], px: point });
    }
  }

  private endDrag() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const app = this.app;
    app.map.dragPan.enable();
    // The map only sends a click after a mouse-up that didn't move; never swallow a later one.
    setTimeout(() => (this.suppressClick = false), 0);
    if (d.kind === "bend" || d.kind === "move" || d.kind === "rotate" || d.kind === "entrance") {
      app.game.commitEdit(d.before);
      if (d.kind === "move" || d.kind === "rotate") app.select({ type: d.owner, id: d.id });
      if (d.kind === "entrance") app.select({ type: "station", id: d.station });
    }
    app.updateHandles();
  }

  private onRightClick(e: MapMouseEvent) {
    const app = this.app;
    const handle = app.map.queryRenderedFeatures(e.point, { layers: [LAYER_IDS.handles] })[0];
    if (handle && (handle.properties as { kind: string }).kind === "bend") {
      e.preventDefault();
      const p = handle.properties as { edge: number; index: number };
      const edge = app.game.net.edges.get(p.edge);
      if (edge) app.game.edit(() => app.game.net.removeBend(edge, p.index));
      app.updateHandles();
      return;
    }
    if (this.chain) {
      e.preventDefault();
      if (this.chain.bends.length) this.chain.bends.pop();
      else this.reset();
      this.queuePreview();
      app.dirty();
    }
  }

  private onClick(e: MapMouseEvent) {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    const app = this.app;
    const g = app.game;
    const net = g.net;
    const [x, y] = this.local(e);
    const t = net.hit(x, y, this.tolerance());
    switch (app.tool) {
      case "connect":
      case "track":
        this.clickTrack(t, x, y);
        break;
      case "station": {
        if (t.type === "station") {
          app.select({ type: "station", id: t.station });
          return;
        }
        const o = app.stationOpts;
        const st = g.edit(() => {
          const s = net.placeStation(x, y, o.heading, o.kind, o.level);
          s.layout = o.layout;
          net.poseStation(s, s.x, s.y, s.heading, o.platformLength);
          s.entrances = net.defaultEntrances(s);
          return s;
        });
        app.select({ type: "station", id: st.id });
        break;
      }
      case "depot": {
        if (t.type === "depot") {
          app.select({ type: "depot", id: t.depot });
          return;
        }
        const d = g.edit(() => net.placeDepot(x, y, app.depotHeading));
        app.select({ type: "depot", id: d.id });
        break;
      }
      case "route": {
        if (t.type !== "station") return;
        const st = net.stations.get(t.station)!;
        g.edit(() => {
          let r = app.activeRoute !== null ? net.routes.get(app.activeRoute) : undefined;
          if (!r) {
            r = g.newRoute();
            net.reindex();
          }
          if (r.stops[r.stops.length - 1] !== st.id) {
            if (e.originalEvent.shiftKey) r.stops.unshift(st.id);
            else r.stops.push(st.id);
          }
          app.setActiveRoute(r.id);
        });
        break;
      }
      case "remove":
        this.removeAt(t);
        break;
      case "select":
        if (app.overlay === "travel") {
          app.setTravelOrigin(x, y);
          return;
        }
        if (t.type === "station") app.select({ type: "station", id: t.station });
        else if (t.type === "depot") app.select({ type: "depot", id: t.depot });
        else if (t.type === "edge") app.select({ type: "edge", id: t.edge });
        else app.select(null);
        break;
    }
  }

  private clickTrack(t: Target, x: number, y: number) {
    const app = this.app;
    const g = app.game;
    const net = g.net;
    const c = this.chain;
    if (!c) {
      if (t.type === "free" && app.tool === "connect") {
        g.log("Start from a station, a depot or existing track. The free track tool can start anywhere.");
        return;
      }
      this.chain = { from: t.type === "free" ? { type: "free", x, y } : t, bends: [] };
      this.queuePreview();
      app.dirty();
      return;
    }
    if (t.type === "free") {
      c.bends.push([x, y]);
      this.queuePreview();
      return;
    }
    if (c.from.type === "station" && t.type === "station" && c.from.station === t.station) return;
    const edge = g.edit(() => net.connect(c.from, t, this.trackOptions(c.bends)));
    if (!edge) {
      g.log("Couldn't lay track there.");
      return;
    }
    // Carry on from where this piece ended, unless that was a depot.
    let next: Target | null = null;
    if (t.type === "station") {
      const st = net.stations.get(t.station)!;
      next = { type: "station", station: st.id, x: st.x, y: st.y };
    } else if (t.type === "node" || t.type === "edge") {
      const n = net.nodes.get(edge.b)!;
      next = { type: "node", node: n.id, x: n.x, y: n.y };
    }
    this.chain = next ? { from: next, bends: [] } : null;
    this.preview = null;
    this.queuePreview();
    app.dirty();
  }

  private hoverInfo(e: MapMouseEvent, x: number, y: number) {
    const app = this.app;
    const net = app.game.net;
    const t = net.hit(x, y, this.tolerance());
    const onHandle = app.map.queryRenderedFeatures(e.point, { layers: [LAYER_IDS.handles, LAYER_IDS.entrances] }).length > 0;
    app.map.getCanvas().style.cursor = onHandle || t.type !== "free" ? "pointer" : "";
    const b = net.buildings;
    if (t.type !== "free" || onHandle || !b || app.map.getZoom() < 14.5) {
      this.tip.hidden = true;
      return;
    }
    const i = b.at(x, y);
    if (i < 0 || net.isDemolished(i)) {
      this.tip.hidden = true;
      return;
    }
    const u = app.game.state.units;
    const people = b.residents(i) >= 1 ? `${Math.round(b.residents(i))} residents` : b.jobs(i) >= 1 ? `${Math.round(b.jobs(i))} jobs` : "";
    this.tip.replaceChildren(
      h("div", null, BUILDING_KINDS[b.kind[i]] ?? "Building"),
      h("div", { class: "muted" }, `${fmt.distance(b.height(i), u)} tall · foundations about ${fmt.distance(b.foundationDepth(i), u)} deep`),
    );
    if (people) this.tip.append(h("div", { class: "muted" }, people));
    this.tip.hidden = false;
    this.tip.style.left = `${e.point.x + 14}px`;
    this.tip.style.top = `${e.point.y + 14}px`;
  }

  private removeAt(t: Target) {
    const app = this.app;
    const g = app.game;
    const net = g.net;
    let status: string | undefined;
    let action: (() => void) | null = null;
    let what = "";
    if (t.type === "station") {
      const s = net.stations.get(t.station)!;
      status = s.status;
      what = `${s.name} station`;
      action = () => net.removeStation(s.id);
    } else if (t.type === "depot") {
      const d = net.depots.get(t.depot)!;
      status = d.status;
      what = "this depot";
      action = () => net.removeDepot(d.id);
    } else if (t.type === "edge") {
      const ed = net.edges.get(t.edge)!;
      status = ed.status;
      what = "this track";
      action = () => net.removeEdge(ed.id);
    }
    if (!action) return;
    const run = action;
    app.select(null);
    if (status === "planned") {
      g.edit(run);
      return;
    }
    const close = modal(
      h(
        "div",
        { class: "modal box" },
        h("h2", null, `Remove ${what}?`),
        h("p", null, status === "built" ? "It's already built. Removing it costs nothing, but you get no money back." : "It's under construction. Money already spent is lost."),
        h(
          "div",
          { class: "actions" },
          h("button", { onclick: () => close() }, "Keep it"),
          h(
            "button",
            {
              class: "primary",
              onclick: () => {
                close();
                run();
                g.clearHistory();
                g.networkChanged();
              },
            },
            "Remove",
          ),
        ),
      ),
    );
  }
}
