import type { App } from "./app";
import { BUILD_TIME, KIND_DEFAULT_LEVEL, KIND_LEVEL_RANGE, LINE_COLOURS, LINE_COLOURS_SAFE, TRAIN_TYPES, trainType, type BuildKind, type TrackCount } from "../game/data";
import { curveSpeed, minRadius } from "../game/geometry";
import type { Depot, Route, Station, TrackEdge } from "../game/model";
import { trainsFor } from "../game/service";
import { satisfactionShare } from "../sim/assign";
import { h, hourChart, row, seg } from "./dom";
import * as fmt from "./format";

const KIND_NAMES: Record<BuildKind, string> = { bored: "Bored tunnel", cut: "Cut-and-cover", elevated: "Elevated", grade: "At grade" };
const SHORT_KIND: Record<BuildKind, string> = { bored: "Bored", cut: "Cut & cover", elevated: "Elevated", grade: "Surface" };
const STATION_KIND: Record<BuildKind, string> = { bored: "Deep", cut: "Shallow", elevated: "Elevated", grade: "Surface" };
const STATUS_NAMES = { planned: "Planned", building: "Under construction", built: "Open" };

export function renderPanel(app: App): Node[] {
  const g = app.game;
  if (g.state.gameOver) return gameOver(app);
  const sel = app.selection;
  switch (app.tool) {
    case "connect":
    case "track":
      return trackPanel(app);
    case "route":
      return routesPanel(app);
    case "remove":
      return [h("h2", null, "Remove"), h("p", { class: "muted" }, "Click a station, depot or piece of track to remove it. Planned work is free to remove; built work gives no refund.")];
    case "station":
      return sel?.type === "station" ? [...selectionPanel(app), h("p", { class: "hint" }, "Click the map to place another station like this one.")] : stationToolPanel(app);
    case "depot":
      return sel?.type === "depot"
        ? selectionPanel(app)
        : [
            h("h2", null, "Depot"),
            h("p", { class: "muted" }, "Click to place a depot yard. Every route needs a built depot linked to its track; trains sleep there overnight."),
            h("p", { class: "hint" }, `Then link it to the line with Connect stations (${app.settings.keys.connect.toUpperCase()}): click the depot, then a station or the track.`),
          ];
    default:
      return selectionPanel(app);
  }
}

function selectionPanel(app: App): Node[] {
  const s = app.selection;
  const net = app.game.net;
  if (!s) return net.stations.size ? [] : gettingStarted(app);
  if (s.type === "station") {
    const st = net.stations.get(s.id);
    return st ? stationPanel(app, st) : [];
  }
  if (s.type === "edge") {
    const e = net.edges.get(s.id);
    return e ? edgePanel(app, e) : [];
  }
  const d = net.depots.get(s.id);
  return d ? depotPanel(app, d) : [];
}

function gettingStarted(app: App): Node[] {
  const k = app.settings.keys;
  return [
    h("h2", null, app.game.city.manifest.name),
    h("p", null, `${fmt.count(app.game.city.manifest.totals.residents)} people live here, and none of them have a metro yet.`),
    h(
      "ol",
      { style: { paddingLeft: "1.2em", margin: "8px 0" } },
      h("li", null, `Place stations (${k.station.toUpperCase()}) and point each platform with its turn handle.`),
      h("li", null, `Connect them (${k.connect.toUpperCase()}): click the stations in order. Drag any planned track to bend it.`),
      h("li", null, `Place a depot (${k.depot.toUpperCase()}) and connect it to the line too.`),
      h("li", null, `Press Build. When it's finished, open Routes (${k.route.toUpperCase()}) and click the stations in order.`),
    ),
    h("p", { class: "hint" }, "The Population, Jobs and Districts overlays show where people live and where they go."),
  ];
}

function gameOver(app: App): Node[] {
  const last = app.game.state.history.slice(-30);
  const riders = last.reduce((a, d) => a + d.riders, 0) / Math.max(1, last.length);
  return [
    h("h2", null, "Game over"),
    h("p", null, "You ran out of money for a month and the city took the network back."),
    row("Riders per day, last month", h("span", { class: "num" }, fmt.count(riders))),
    row("Stations", h("span", { class: "num" }, String(app.game.state.stations.length))),
    h("p", { class: "hint" }, "Load a save from the menu or start again."),
  ];
}

// ---- building ---------------------------------------------------------------------

const ALL_KINDS: BuildKind[] = ["bored", "cut", "elevated", "grade"];

function levelSlider(app: App, kind: BuildKind, level: number, set: (v: number) => void): Node[] {
  if (kind === "grade") return [];
  const u = app.game.state.units;
  const [lo, hi] = KIND_LEVEL_RANGE[kind];
  const below = hi < 0;
  return [
    h("h3", null, below ? "Depth" : "Height"),
    row(fmt.depth(level, u), h("span", { class: "muted" }, "[ and ] keys")),
    h("input", {
      type: "range",
      min: below ? -hi : lo,
      max: below ? -lo : hi,
      step: 1,
      value: Math.abs(level),
      oninput: (e: Event) => {
        const v = Number((e.target as HTMLInputElement).value);
        set(below ? -v : v);
      },
    }),
  ];
}

function stationToolPanel(app: App): Node[] {
  const o = app.stationOpts;
  const k = app.settings.keys;
  return [
    h("h2", null, "Stations"),
    h("h3", null, "Type"),
    seg(
      ALL_KINDS.map((kind) => ({ value: kind, label: STATION_KIND[kind], title: KIND_NAMES[kind] })),
      o.kind,
      (kind) => {
        o.kind = kind;
        o.level = KIND_DEFAULT_LEVEL[kind];
        app.dirty();
      },
    ),
    ...levelSlider(app, o.kind, o.level, (v) => {
      o.level = v;
      app.dirty();
    }),
    h("h3", null, "Platform"),
    row(
      "Length",
      h("input", {
        type: "number",
        min: 60,
        max: 300,
        step: 10,
        value: o.platformLength,
        onchange: (e: Event) => (o.platformLength = Math.max(60, Math.min(300, Number((e.target as HTMLInputElement).value) || 150))),
      }),
    ),
    row(
      "Layout",
      seg(
        [
          { value: "island", label: "Island" },
          { value: "side", label: "Side" },
        ],
        o.layout,
        (v) => {
          o.layout = v as Station["layout"];
          app.dirty();
        },
      ),
    ),
    h("p", { class: "hint" }, `Click to place. Drag the round handle to point the platform, or use ${k.rotateLeft.toUpperCase()} and ${k.rotateRight.toUpperCase()}. Drag a planned station to move it.`),
  ];
}

function trackPanel(app: App): Node[] {
  const o = app.trackOpts;
  const u = app.game.state.units;
  const g = app.game;
  const free = app.tool === "track";
  const out: Node[] = [h("h2", null, free ? "Free track" : "Connect stations")];
  out.push(
    h("h3", null, "Construction"),
    seg(
      ALL_KINDS.map((k) => ({ value: k, label: SHORT_KIND[k], title: KIND_NAMES[k] })),
      o.kind,
      (k) => {
        o.kind = k;
        o.level = KIND_DEFAULT_LEVEL[k];
        app.tools.adjustLevel(0);
      },
    ),
  );
  if (free) {
    out.push(
      ...levelSlider(app, o.kind, o.level, (v) => {
        o.level = v;
        app.tools.adjustLevel(0);
      }),
    );
  }
  out.push(
    h("h3", null, "Tracks"),
    seg(
      [
        { value: 1 as TrackCount, label: "Single", title: "Cheaper, but trains can only pass at stations" },
        { value: 2 as TrackCount, label: "Double" },
        { value: 4 as TrackCount, label: "Quad", title: "Room for express services to overtake" },
      ],
      o.tracks,
      (t) => {
        o.tracks = t;
        app.tools.adjustLevel(0);
      },
    ),
  );

  const p = app.tools.preview;
  if (p) {
    const r = p.minRadius;
    out.push(
      h("h3", null, "This piece"),
      row("Length", h("span", { class: "num" }, fmt.distance(p.length, u))),
      row("Cost", h("span", { class: "num" }, fmt.money(p.cost))),
      row("Build time", h("span", null, fmt.days(p.days))),
      row("Tightest curve", h("span", { class: "num" }, isFinite(r) ? `${fmt.distance(r, u)}, ${fmt.speed(curveSpeed(r) * 3.6, u)}` : "straight")),
    );
    if (p.demolish.length) out.push(row("Buildings in the way", h("span", { class: "num bad" }, String(p.demolish.length))));
    if (p.problems.length) out.push(h("ul", { class: "problems" }, p.problems.map((x) => h("li", null, x))));
  }
  if (o.kind === "bored") {
    const waiting = g.waitingForTbm();
    out.push(
      h("h3", null, "Boring machines"),
      row(
        `${g.state.tbms} owned${waiting ? `, ${waiting} job${waiting === 1 ? "" : "s"} waiting` : ""}`,
        h("button", { onclick: () => g.buyTbm() && app.dirty() }, `Buy · ${fmt.money(BUILD_TIME.tbmCost)}`),
      ),
    );
  }
  out.push(
    h(
      "p",
      { class: "hint" },
      free
        ? "Click anywhere to start, click to add points, and double-click or Enter to end the track there. Clicking a station, depot or track joins it."
        : "Click a station, depot or track to start, then the next one, and so on. Clicks on empty ground add a bend on the way. Esc ends the line.",
    ),
    h("p", { class: "hint" }, "Drag planned track to bend it. Right-click a bend point to remove it."),
  );
  return out;
}

// ---- station ---------------------------------------------------------------------

function statusLine(status: "planned" | "building" | "built", daysLeft: number, waiting = false): HTMLElement {
  if (status === "building") return h("span", { class: "warn" }, waiting ? "Waiting for a boring machine" : `Under construction, ${fmt.days(daysLeft)} left`);
  return h("span", { class: status === "built" ? "good" : "muted" }, STATUS_NAMES[status]);
}

function stationPanel(app: App, st: Station): Node[] {
  const g = app.game;
  const net = g.net;
  const u = g.state.units;
  const planned = st.status === "planned";
  // Settings changed on a station carry over to the next one placed.
  const remember = (o: Partial<App["stationOpts"]>) => Object.assign(app.stationOpts, o);
  const name = h("input", {
    type: "text",
    value: st.name,
    style: { flex: "1", fontWeight: "600" },
    onchange: (e: Event) => {
      const v = (e.target as HTMLInputElement).value.trim();
      if (v) g.edit(() => (st.name = v));
    },
  });
  const out: Node[] = [h("h2", null, name), row("Status", statusLine(st.status, st.daysLeft))];
  if (!planned) out.push(row("Type", `${STATION_KIND[st.kind]}, ${fmt.depth(st.level, u)}`));
  if (planned) {
    out.push(
      h("h3", null, "Type"),
      seg(
        ALL_KINDS.map((k) => ({ value: k, label: STATION_KIND[k], title: KIND_NAMES[k] })),
        st.kind,
        (k) => {
          g.edit(() => net.setStationLevel(st, k, KIND_DEFAULT_LEVEL[k]));
          remember({ kind: k, level: KIND_DEFAULT_LEVEL[k] });
        },
      ),
      ...levelSlider(app, st.kind, st.level, (v) => {
        g.edit(() => net.setStationLevel(st, st.kind, v));
        remember({ level: v });
      }),
      h("h3", null, "Platform"),
      row(
        "Length",
        h("input", {
          type: "number",
          min: 60,
          max: 300,
          step: 10,
          value: st.platformLength,
          onchange: (e: Event) => {
            const v = Math.max(60, Math.min(300, Number((e.target as HTMLInputElement).value) || 150));
            g.edit(() => {
              net.poseStation(st, st.x, st.y, st.heading, v);
              st.entrances = net.defaultEntrances(st);
            });
            remember({ platformLength: v });
          },
        }),
      ),
      row(
        "Layout",
        seg(
          [
            { value: "island", label: "Island" },
            { value: "side", label: "Side" },
          ],
          st.layout,
          (v) => {
            g.edit(() => (st.layout = v as Station["layout"]));
            remember({ layout: v as Station["layout"] });
          },
        ),
      ),
      row("Cost", h("span", { class: "num" }, fmt.money(net.stationCost(st)))),
    );
    const knock = net.demolitionForStation(st);
    if (knock.length) out.push(row("Buildings in the way", h("span", { class: "num bad" }, String(knock.length))));
    const problems = net.stationProblems(st);
    if (problems.length) out.push(h("ul", { class: "problems" }, problems.map((x) => h("li", null, x))));
    out.push(h("p", { class: "hint" }, "Drag the round handle to turn it, or drag the station to move it."));
  } else {
    out.push(row("Platforms", `${st.platformLength} m, ${st.layout}`));
  }
  const routes = g.state.routes.filter((r) => r.stops.includes(st.id));
  if (routes.length) {
    out.push(
      h("h3", null, "Routes"),
      h(
        "div",
        { class: "list" },
        routes.map((r) =>
          h(
            "div",
            {
              class: "clickable",
              onclick: () => {
                app.setTool("route");
                app.setActiveRoute(r.id);
              },
            },
            h("span", { class: "chip", style: { background: r.color } }),
            h("span", { class: "grow" }, r.name),
          ),
        ),
      ),
    );
  }
  const stats = g.today?.stations.find((s) => s.id === st.id);
  if (stats) {
    const entries = stats.entries.reduce((a, b) => a + b, 0);
    const exits = stats.exits.reduce((a, b) => a + b, 0);
    out.push(
      h("h3", null, "Today"),
      row("Entries", h("span", { class: "num" }, fmt.count(entries))),
      row("Exits", h("span", { class: "num" }, fmt.count(exits))),
      row("Transfers", h("span", { class: "num" }, fmt.count(stats.transfers))),
      hourChart(stats.entries, "#8a8d92", Math.floor(g.minuteOfDay() / 60)),
    );
  }
  out.push(
    h(
      "div",
      { class: "row", style: { marginTop: "12px" } },
      h("button", { class: "link", onclick: () => g.edit(() => (st.entrances = net.defaultEntrances(st))) }, "Reset entrances"),
      h(
        "button",
        {
          class: "danger",
          onclick: () => {
            if (st.status === "planned") {
              g.edit(() => net.removeStation(st.id));
              app.select(null);
            } else {
              app.setTool("remove");
            }
          },
        },
        st.status === "planned" ? "Remove" : "Remove…",
      ),
    ),
  );
  if (st.status === "built") out.push(h("p", { class: "hint" }, "Drag the small dots on the map to move entrances."));
  return out;
}

function edgePanel(app: App, e: TrackEdge): Node[] {
  const g = app.game;
  const net = g.net;
  const u = g.state.units;
  const a = net.nodes.get(e.a)!;
  const b = net.nodes.get(e.b)!;
  const r = minRadius(e.pts);
  const waiting = e.kind === "bored" && e.status === "building" && isWaitingForTbm(app, e);
  const out: Node[] = [
    h("h2", null, KIND_NAMES[e.kind]),
    row("Status", statusLine(e.status, e.daysLeft, waiting)),
    row("Length", h("span", { class: "num" }, fmt.distance(net.edgeLength(e), u))),
    row("Level", a.level === b.level ? fmt.depth(a.level, u) : `${fmt.depth(a.level, u)} to ${fmt.depth(b.level, u)}`),
    row("Tracks", e.tracks === 1 ? "Single" : e.tracks === 2 ? "Double" : "Quad"),
    row("Tightest curve", isFinite(r) ? `${fmt.distance(r, u)}, ${fmt.speed(curveSpeed(r) * 3.6, u)}` : "straight"),
  ];
  if (e.status === "planned") {
    out.push(
      row("Cost", h("span", { class: "num" }, fmt.money(net.edgeCost(e)))),
      h("h3", null, "Construction"),
      seg(
        ALL_KINDS.map((k) => ({ value: k, label: SHORT_KIND[k], title: KIND_NAMES[k] })),
        e.kind,
        (k) => {
          g.edit(() => (e.kind = k));
          app.select({ type: "edge", id: e.id });
        },
      ),
      row(
        "Tracks",
        seg(
          [
            { value: 1 as TrackCount, label: "1" },
            { value: 2 as TrackCount, label: "2" },
            { value: 4 as TrackCount, label: "4" },
          ],
          e.tracks,
          (t) => {
            g.edit(() => (e.tracks = t));
            app.select({ type: "edge", id: e.id });
          },
        ),
      ),
    );
    const problems = net.edgeProblems(e);
    if (problems.length) out.push(h("ul", { class: "problems" }, problems.map((x) => h("li", null, x))));
    const knock = net.demolitionForEdge(e);
    if (knock.length) out.push(row("Buildings in the way", h("span", { class: "num bad" }, String(knock.length))));
    if (e.bends.length) {
      out.push(
        row(
          `${e.bends.length} bend point${e.bends.length === 1 ? "" : "s"}`,
          h(
            "button",
            {
              onclick: () => {
                g.edit(() => {
                  e.bends = [];
                  net.recompute(e);
                });
                app.select({ type: "edge", id: e.id });
              },
            },
            "Straighten",
          ),
        ),
      );
    }
    out.push(h("p", { class: "hint" }, "Drag the track to bend it. Right-click a bend point to remove it."));
  }
  out.push(
    h(
      "div",
      { class: "row", style: { marginTop: "12px", justifyContent: "flex-end" } },
      h(
        "button",
        {
          class: "danger",
          onclick: () => {
            if (e.status === "planned") {
              g.edit(() => net.removeEdge(e.id));
              app.select(null);
            } else app.setTool("remove");
          },
        },
        e.status === "planned" ? "Remove" : "Remove…",
      ),
    ),
  );
  return out;
}

function isWaitingForTbm(app: App, e: TrackEdge): boolean {
  const g = app.game;
  const queue = [...g.net.edges.values()].filter((x) => x.status === "building" && x.kind === "bored").sort((x, y) => x.id - y.id);
  return queue.indexOf(e) >= g.state.tbms;
}

function depotPanel(app: App, d: Depot): Node[] {
  const g = app.game;
  let used = 0;
  for (const r of g.state.routes) used += (g.state.fleet[r.id] ?? 0) * r.cars;
  let capacity = 0;
  for (const x of g.net.depots.values()) if (x.status === "built") capacity += x.capacity;
  const linked = (g.net.adj.get(d.node)?.length ?? 0) > 0;
  return [
    h("h2", null, "Depot"),
    row("Status", statusLine(d.status, d.daysLeft)),
    row("Track link", linked ? h("span", { class: "good" }, "Connected") : h("span", { class: "warn" }, "Not connected yet")),
    row("Holds", h("span", { class: "num" }, `${d.capacity} cars`)),
    row("All depots", h("span", { class: "num" }, `${used} of ${capacity} cars used`)),
    d.status === "planned" ? h("p", { class: "hint" }, "Drag the round handle to turn the yard, or drag it to move it. Its track leaves from the end with the handle.") : h("span"),
    h(
      "div",
      { class: "row", style: { marginTop: "12px", justifyContent: "flex-end" } },
      h(
        "button",
        {
          class: "danger",
          onclick: () => {
            if (d.status === "planned") {
              g.edit(() => g.net.removeDepot(d.id));
              app.select(null);
            } else app.setTool("remove");
          },
        },
        d.status === "planned" ? "Remove" : "Remove…",
      ),
    ),
  ];
}

// ---- routes ---------------------------------------------------------------------

function routesPanel(app: App): Node[] {
  const g = app.game;
  const r = app.activeRoute !== null ? g.net.routes.get(app.activeRoute) : undefined;
  if (r) return routeEditor(app, r);
  const stats = new Map(g.today?.routes.map((x) => [x.id, x]) ?? []);
  const out: Node[] = [h("h2", null, "Routes")];
  if (g.state.routes.length) {
    out.push(
      h(
        "div",
        { class: "list" },
        g.state.routes.map((x) => {
          const why = g.readyRoutes.get(x.id);
          const s = stats.get(x.id);
          const riders = s ? s.boardings.reduce((a, b) => a + b, 0) : 0;
          return h(
            "div",
            { class: "clickable", onclick: () => app.setActiveRoute(x.id) },
            h("span", { class: "chip", style: { background: x.color } }),
            h("span", { class: "grow" }, x.name),
            h("span", { class: why ? "muted" : "num" }, why ? "not running" : `${fmt.count(riders)}/day`),
          );
        }),
      ),
    );
  } else {
    out.push(h("p", { class: "muted" }, "No routes yet."));
  }
  out.push(
    h(
      "div",
      { class: "row", style: { marginTop: "10px" } },
      h(
        "button",
        {
          class: "primary",
          onclick: () => {
            const nr = g.edit(() => {
              const x = g.newRoute();
              g.net.reindex();
              return x;
            });
            app.setActiveRoute(nr.id);
          },
        },
        "New route",
      ),
    ),
    h("p", { class: "hint" }, "Open a route, then click stations on the map to add stops. Shift-click adds to the start."),
  );
  return out;
}

function routeEditor(app: App, r: Route): Node[] {
  const g = app.game;
  const net = g.net;
  const u = g.state.units;
  const tt = trainType(r.trainType);
  const why = g.readyRoutes.get(r.id);
  const path = net.routePath(r);
  const out: (Node | null)[] = [];
  out.push(
    h("div", { class: "row" }, h("button", { class: "link", onclick: () => app.setActiveRoute(null) }, "All routes")),
    h(
      "h2",
      null,
      h("span", { class: "chip", style: { background: r.color } }),
      h("input", {
        type: "text",
        value: r.name,
        style: { flex: "1", fontWeight: "600" },
        onchange: (e: Event) => {
          const v = (e.target as HTMLInputElement).value.trim();
          if (v) g.edit(() => (r.name = v));
        },
      }),
    ),
  );
  const palette = app.settings.safeColours ? LINE_COLOURS_SAFE : LINE_COLOURS;
  out.push(
    h(
      "div",
      { class: "swatches" },
      palette.map((c) => h("button", { class: c === r.color ? "on" : "", style: { background: c }, title: c, onclick: () => g.edit(() => (r.color = c)) })),
      h("input", {
        type: "color",
        value: r.color,
        title: "Any colour",
        style: { width: "24px", height: "22px", padding: "0", border: "none", background: "none" },
        onchange: (e: Event) => g.edit(() => (r.color = (e.target as HTMLInputElement).value)),
      }),
    ),
  );
  out.push(row("Status", why ? h("span", { class: "warn" }, why) : h("span", { class: "good" }, "Running")));
  if (!why && g.overCapacity.has(r.id)) {
    out.push(h("p", { class: "warn" }, "Shared or single track can't fit all the trains you've asked for, so some periods run less often. Add tracks or spread routes out."));
  }
  if (!why || path.problems.length) {
    const extra = path.problems.filter((p) => p !== why);
    if (extra.length) out.push(h("ul", { class: "problems" }, extra.map((x) => h("li", null, x))));
  }

  out.push(
    h("h3", null, "Trains"),
    row(
      "Type",
      h(
        "select",
        {
          onchange: (e: Event) => {
            const v = (e.target as HTMLSelectElement).value;
            const nt = trainType(v);
            g.edit(() => {
              r.trainType = v;
              r.cars = Math.max(nt.minCars, Math.min(nt.maxCars, r.cars));
            });
          },
        },
        TRAIN_TYPES.map((t) => h("option", { value: t.id, selected: t.id === r.trainType }, `${t.name}, ${fmt.speed(t.maxSpeed * 3.6, u)}`)),
      ),
    ),
    row(
      "Cars",
      h("input", {
        type: "number",
        min: tt.minCars,
        max: tt.maxCars,
        value: r.cars,
        onchange: (e: Event) => {
          const v = Math.max(tt.minCars, Math.min(tt.maxCars, Math.round(Number((e.target as HTMLInputElement).value)) || tt.minCars));
          g.edit(() => (r.cars = v));
        },
      }),
    ),
    row("Each train", h("span", { class: "num" }, `${fmt.distance(r.cars * tt.carLength, u)}, ${fmt.count(r.cars * tt.capacityPerCar)} people`)),
  );

  out.push(h("h3", null, `Stops (${r.stops.length})`));
  if (r.stops.length) {
    out.push(
      h(
        "div",
        { class: "list" },
        r.stops.map((sid, i) => {
          const st = net.stations.get(sid);
          return h(
            "div",
            null,
            h("span", { class: "num muted", style: { width: "1.6em" } }, String(i + 1)),
            h("span", { class: "grow" }, st?.name ?? "?"),
            h("button", { title: "Move up", disabled: i === 0, onclick: () => g.edit(() => r.stops.splice(i - 1, 0, r.stops.splice(i, 1)[0])) }, "↑"),
            h("button", { title: "Remove stop", onclick: () => g.edit(() => r.stops.splice(i, 1)) }, "×"),
          );
        }),
      ),
    );
  } else out.push(h("p", { class: "muted" }, "Click stations on the map to add them in order."));

  // Service pattern
  const c = g.compiled.get(r.id);
  const periods = g.state.periods;
  const headwayInput = (list: number[], i: number) =>
    h("input", {
      type: "number",
      min: 0,
      max: 60,
      step: 0.5,
      value: list[i] ? +(list[i] / 60).toFixed(1) : 0,
      title: "Minutes between trains. 0 means no service.",
      onchange: (e: Event) => {
        const v = Math.max(0, Number((e.target as HTMLInputElement).value) || 0);
        g.edit(() => (list[i] = v > 0 ? Math.max(90, Math.round(v * 60)) : 0));
      },
    });
  out.push(
    h("h3", null, "Minutes between trains"),
    h(
      "table",
      { class: "grid" },
      h("tr", null, h("th", null, ""), h("th", null, "Weekday"), h("th", null, "Weekend")),
      periods.map((p, i) => h("tr", null, h("td", null, h("span", null, p.name), h("div", { class: "muted num", style: { fontSize: "0.85em" } }, fmt.hhmm(p.start))), h("td", null, headwayInput(r.headways.weekday, i)), h("td", null, headwayInput(r.headways.weekend, i)))),
    ),
  );
  if (c) {
    let need = 0;
    for (const hw of [...r.headways.weekday, ...r.headways.weekend]) need = Math.max(need, trainsFor(c, hw > 0 ? Math.max(90, hw) : 0));
    const have = g.state.fleet[r.id] ?? 0;
    out.push(
      row("Round trip", h("span", { class: "num" }, `${Math.round(c.cycle / 60)} min`)),
      row("Trains", h("span", { class: `num ${have < need ? "warn" : ""}` }, `${have} of ${need} needed`)),
    );
  }

  const s = g.today?.routes.find((x) => x.id === r.id);
  if (s && c) {
    const riders = s.boardings.reduce((a, b) => a + b, 0);
    let peak = 0;
    for (const v of s.maxLoad) peak = Math.max(peak, v);
    const sat = g.state.satisfaction[r.id] ?? s.satisfaction;
    out.push(
      h("h3", null, "Today"),
      row("Boardings", h("span", { class: "num" }, fmt.count(riders))),
      row("Satisfaction", h("span", { class: "num" }, fmt.pct(sat))),
      row("Possible riders using it", h("span", { class: "num" }, fmt.pct(satisfactionShare(sat)))),
      row("Busiest load", h("span", { class: `num ${peak > 1 ? "bad" : peak > 0.85 ? "warn" : ""}` }, fmt.pct(peak))),
      row("Average speed", h("span", { class: "num" }, fmt.speed(s.avgSpeed, u))),
      s.leftBehind > 0 ? row("Left on platforms", h("span", { class: "num bad" }, fmt.count(s.leftBehind))) : null,
      hourChart(s.boardings, r.color, Math.floor(g.minuteOfDay() / 60)),
    );
  }
  out.push(
    h(
      "div",
      { class: "row", style: { marginTop: "12px", justifyContent: "flex-end" } },
      h(
        "button",
        {
          class: "danger",
          onclick: () => {
            g.edit(() => g.net.removeRoute(r.id));
            app.setActiveRoute(null);
          },
        },
        "Delete route",
      ),
    ),
  );
  return out.filter((x): x is Node => x !== null);
}
