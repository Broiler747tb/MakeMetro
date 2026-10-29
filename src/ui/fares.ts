import type { App } from "./app";
import { fareMood, type Fares, type Forecast } from "../game/game";
import type { Route } from "../game/model";
import { lineTitle } from "../game/lineNames";
import { h, row, seg } from "./dom";
import * as fmt from "./format";

/**
 * Fares being edited but not yet in force, shared by the economy panel and the line panels.
 * Each change asks the simulation what today would look like with them; Apply puts them in force.
 */
export class FareDraft {
  fares: Fares;
  forecast: Forecast | null = null;
  private timer = 0;
  private asked = 0;
  private previews = new Set<{ el: HTMLElement; route: Route | null }>();

  constructor(private app: App) {
    this.fares = app.game.currentFares();
  }

  get changed(): boolean {
    return !sameFares(this.fares, this.app.game.currentFares(), this.app.game.state.routes);
  }

  /** Changes the draft. Pass layout when the change adds or removes fields. */
  edit(fn: (f: Fares) => void, layout = false) {
    fn(this.fares);
    this.refresh();
    if (layout) this.app.faresLaidOut();
  }

  /** Asks for a new forecast, for instance after the network changed under the draft. */
  refresh() {
    this.forecast = null;
    clearTimeout(this.timer);
    const ask = ++this.asked;
    if (this.changed) {
      this.timer = window.setTimeout(() => {
        this.app.game.forecast(structuredClone(this.fares)).then((f) => {
          if (ask !== this.asked) return;
          this.forecast = f;
          this.updatePreviews();
        });
      }, 200);
    }
    this.updatePreviews();
  }

  apply() {
    const g = this.app.game;
    const before = g.currentFares();
    g.setFares(this.fares);
    g.log(describeChange(before, g.currentFares(), g.state.routes));
    this.reset();
  }

  reset() {
    this.fares = this.app.game.currentFares();
    this.refresh();
    this.app.faresLaidOut();
  }

  /** Riders and fares now and with the draft, for the network or one line; kept up to date in place. */
  preview(route: Route | null): HTMLElement {
    const entry = { el: h("div", { class: "forecast" }), route };
    this.previews.add(entry);
    this.fill(entry);
    return entry.el;
  }

  private updatePreviews() {
    for (const p of this.previews) {
      if (!p.el.isConnected && p.el.dataset.drawn) this.previews.delete(p);
      else this.fill(p);
    }
  }

  private fill({ el, route }: { el: HTMLElement; route: Route | null }) {
    el.dataset.drawn = "1";
    const g = this.app.game;
    const today = g.today;
    let riders = 0;
    let fares = 0;
    if (today && route) {
      const r = today.routes.find((x) => x.id === route.id);
      riders = r ? r.boardings.reduce((a, b) => a + b, 0) : 0;
      fares = r?.fares ?? 0;
    } else if (today) {
      riders = today.trips;
      fares = today.revenue.reduce((a, b) => a + b, 0);
    }
    const what = route ? "This line today" : "Today";
    const out: Node[] = [row(what, h("span", { class: "num" }, `${fmt.count(riders)} riders, ${fmt.money(fares)}`))];
    if (this.changed) {
      const f = this.forecast;
      if (!f) out.push(row("With these fares", h("span", { class: "muted" }, "working it out…")));
      else {
        const line = route ? f.routes.get(route.id) : null;
        const r2 = route ? (line?.riders ?? 0) : f.riders;
        const f2 = route ? (line?.fares ?? 0) : f.fares;
        out.push(row("With these fares", h("span", { class: "num" }, `${fmt.count(r2)} riders, ${fmt.money(f2)}`)));
        out.push(row("", h("span", { class: "num muted" }, `${change(r2, riders)} riders, ${change(f2, fares)} fares`)));
        if (route) out.push(row("Whole network", h("span", { class: "num" }, `${fmt.count(f.riders)} riders, ${fmt.money(f.fares)}`)));
        const mood = f.riders > 0 ? fareMood(f.fares / f.riders) : 0;
        if (Math.abs(mood) >= 0.01) out.push(h("p", { class: "hint" }, moodText(mood)));
      }
      out.push(
        h(
          "div",
          { class: "row", style: { justifyContent: "flex-end", marginTop: "6px" } },
          h("button", { onclick: () => this.reset() }, "Reset"),
          h("button", { class: "primary", onclick: () => this.apply() }, "Apply"),
        ),
      );
    }
    el.replaceChildren(...out);
  }
}

function change(now: number, before: number): string {
  if (before <= 0) return "—";
  const p = Math.round((now / before - 1) * 100);
  return p === 0 ? "±0%" : p > 0 ? `+${p}%` : `−${-p}%`;
}

export function moodText(mood: number): string {
  const p = Math.round(Math.abs(mood) * 100);
  return mood < 0
    ? `People find these fares dear: ${p}% off satisfaction when the city sets next year's budget.`
    : `People like the cheap fares: ${p}% on satisfaction when the city sets next year's budget.`;
}

function sameFares(a: Fares, b: Fares, routes: Route[]): boolean {
  const r = a.rules, q = b.rules;
  if (a.fare !== b.fare || r.mode !== q.mode || r.perKm !== q.perKm || r.zoneWidth !== q.zoneWidth || r.perZone !== q.perZone) return false;
  return routes.every((x) => a.lineFares[x.id] === b.lineFares[x.id]);
}

function describeChange(a: Fares, b: Fares, routes: Route[]): string {
  const parts: string[] = [];
  const r = b.rules;
  if (r.mode !== a.rules.mode || r.perKm !== a.rules.perKm || r.perZone !== a.rules.perZone || r.zoneWidth !== a.rules.zoneWidth || a.fare !== b.fare) {
    if (r.mode === "distance") parts.push(`network fare ${fmt.fare(b.fare)} plus ${fmt.fare(r.perKm)} a km`);
    else if (r.mode === "zones") parts.push(`network fare ${fmt.fare(b.fare)} plus ${fmt.fare(r.perZone)} a ring crossed`);
    else parts.push(`network fare ${fmt.fare(b.fare)}`);
  }
  for (const x of routes) {
    if (a.lineFares[x.id] === b.lineFares[x.id]) continue;
    const own = b.lineFares[x.id];
    parts.push(own === undefined ? `${lineTitle(x)} back on the network fare` : `${lineTitle(x)} charges ${fmt.fare(own)}`);
  }
  return `New fares: ${parts.join("; ")}.`;
}

function fareInput(value: number, step: number, set: (v: number) => void): HTMLInputElement {
  return h("input", {
    type: "number",
    min: 0,
    max: 50,
    step,
    value: value.toFixed(2),
    oninput: (e: Event) => {
      const v = Number((e.target as HTMLInputElement).value);
      if (Number.isFinite(v) && v >= 0) set(v);
    },
  });
}

/** The network's fare rules, for the economy panel. */
export function networkFares(app: App): Node[] {
  const d = app.fareDraft;
  const f = d.fares;
  const r = f.rules;
  return [
    seg(
      [
        { value: "flat", label: "Flat" },
        { value: "distance", label: "By distance" },
        { value: "zones", label: "Zones" },
      ],
      r.mode,
      (v) => d.edit((x) => (x.rules.mode = v as typeof r.mode), true),
    ),
    row(r.mode === "flat" ? "Network fare" : "Base fare", fareInput(f.fare, 0.1, (v) => d.edit((x) => (x.fare = v)))),
    r.mode === "distance" ? row("Per km ridden", fareInput(r.perKm, 0.01, (v) => d.edit((x) => (x.rules.perKm = v)))) : null,
    r.mode === "zones" ? row("Ring width (km)", fareInput(r.zoneWidth / 1000, 1, (v) => d.edit((x) => (x.rules.zoneWidth = Math.max(1000, v * 1000))))) : null,
    r.mode === "zones" ? row("Per ring crossed", fareInput(r.perZone, 0.1, (v) => d.edit((x) => (x.rules.perZone = v)))) : null,
    d.preview(null),
    h(
      "p",
      { class: "hint" },
      "Lines on the network fare share one ticket, however often people change. A line can charge its own fare instead, set in its panel; then everyone who boards it pays that too.",
    ),
  ].filter((x) => x !== null);
}

/** One line's fare, for its panel. */
export function lineFare(app: App, route: Route): Node[] {
  const d = app.fareDraft;
  const own = d.fares.lineFares[route.id];
  return [
    seg(
      [
        { value: "network", label: `Network fare, ${fmt.fare(d.fares.fare)}` },
        { value: "own", label: "Its own" },
      ],
      own === undefined ? "network" : "own",
      (v) =>
        d.edit((x) => {
          if (v === "own") x.lineFares[route.id] = x.lineFares[route.id] ?? x.fare;
          else delete x.lineFares[route.id];
        }, true),
    ),
    own !== undefined ? row("Fare on boarding", fareInput(own, 0.1, (v) => d.edit((x) => (x.lineFares[route.id] = v)))) : null,
    d.preview(route),
  ].filter((x) => x !== null);
}
