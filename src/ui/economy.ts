import type { App } from "./app";
import { operatingProfit, type Ledger } from "../game/game";
import { COSTS } from "../game/data";
import type { DayRecord } from "../game/model";
import { h, lineChart, row } from "./dom";
import { moodText, networkFares } from "./fares";
import * as fmt from "./format";

const CHART_DAYS = 60;
const REFRESH_MS = 500;

// Ledger rows: label, the ledger field, and whether it is money going out.
const ROWS: [string, keyof Ledger, boolean][] = [
  ["Fares", "fares", false],
  ["Running trains", "running", true],
  ["Upkeep", "upkeep", true],
  ["Loan interest", "interest", true],
];
const CAPITAL: [string, keyof Ledger, boolean][] = [
  ["Construction", "construction", true],
  ["New trains", "trains", true],
  ["City budget", "budget", false],
  ["Loans", "loans", false],
];

/** The economy side panel: money in and out, fares, history, budget and loans. Stays open while you play. */
export class EconomyPanel {
  readonly el = h("div", { class: "economy box", hidden: true });
  private stale = true;
  private lastDraw = 0;

  constructor(private app: App) {}

  get open(): boolean {
    return !this.el.hidden;
  }

  toggle(open = !this.open) {
    this.el.hidden = !open;
    this.stale = true;
    this.app.economyToggled();
  }

  markStale() {
    this.stale = true;
  }

  /** Called every frame; redraws now and then while open, never under someone typing. */
  frame() {
    if (!this.open) return;
    const now = performance.now();
    if (!this.stale && now - this.lastDraw < REFRESH_MS) return;
    const focused = document.activeElement as HTMLInputElement | null;
    if (focused && this.el.contains(focused) && focused.tagName === "INPUT") return;
    this.stale = false;
    this.lastDraw = now;
    const scroll = this.el.scrollTop;
    this.el.replaceChildren(...this.render());
    this.el.scrollTop = scroll;
  }

  private render(): Node[] {
    const g = this.app.game;
    const s = g.state;
    const hist = s.history;
    const yesterday = hist.length ? hist[hist.length - 1] : null;
    const month = sum(hist.slice(-30));
    const columns: (Ledger | null)[] = [g.dayTally, yesterday, hist.length ? month : null];
    const cell = (l: Ledger | null, key: keyof Ledger, out: boolean) => h("td", { class: "num" }, l ? signed(out ? -l[key] : l[key]) : "");
    const line = ([label, key, out]: [string, keyof Ledger, boolean]) => h("tr", null, h("th", null, label), ...columns.map((l) => cell(l, key, out)));
    const used = ([, key]: [string, keyof Ledger, boolean]) => columns.some((l) => l && Math.abs(l[key]) >= 1);
    const profit = h(
      "tr",
      { class: "total" },
      h("th", null, "Operating profit"),
      ...columns.map((l) => h("td", { class: `num ${l ? (operatingProfit(l) >= 0 ? "good" : "bad") : ""}` }, l ? signed(operatingProfit(l), true) : "")),
    );
    const capital = CAPITAL.filter(used);
    const ledger = h(
      "table",
      { class: "ledger" },
      h("tr", null, h("th", null, ""), h("th", null, "Today"), h("th", null, "Yesterday"), h("th", null, "30 days")),
      ROWS.filter((r) => r[1] !== "interest" || used(r)).map(line),
      profit,
      capital.length ? h("tr", { class: "gap" }, h("td", { colSpan: 4 })) : null,
      capital.map(line),
    );

    const owed = s.loans.reduce((a, l) => a + l.balance, 0);
    const loanInput = h("input", { type: "number", min: 0, step: 100, value: 500, title: "Millions" });
    const repayInput = h("input", { type: "number", min: 0, step: 100, value: Math.round(owed / 1e6), title: "Millions" });
    const mood = g.fareMood();
    const recent = hist.slice(-CHART_DAYS);
    const css = getComputedStyle(document.documentElement);
    const ink = css.getPropertyValue("--text").trim();
    const muted = css.getPropertyValue("--muted").trim();
    const withMoney = recent.filter((d) => d.money !== undefined);

    return [
      h("h2", null, h("span", { class: "grow" }, "Economy"), h("button", { class: "close", title: "Close (M)", onclick: () => this.toggle(false) }, "×")),
      row("Money", h("span", { class: `num big ${s.money < 0 && !s.sandbox.unlimitedMoney ? "bad" : ""}` }, s.sandbox.unlimitedMoney ? "Unlimited" : fmt.money(s.money))),
      ledger,
      h("p", { class: "hint" }, "Operating profit is fares less running costs, upkeep and interest. Building and new trains are paid for from the budget and loans."),

      h("h3", null, "Fares"),
      ...networkFares(this.app),

      h("h3", null, `Last ${Math.min(CHART_DAYS, recent.length)} days`),
      recent.length >= 2
        ? h(
            "div",
            null,
            chartTitle("Money", withMoney.length ? fmt.money(withMoney[withMoney.length - 1].money!) : ""),
            withMoney.length >= 2 ? lineChart(withMoney.map((d) => d.money!), ink, "fit") : h("p", { class: "muted" }, "Not enough days yet."),
            chartTitle("Operating profit per day", signed(operatingProfit(recent[recent.length - 1]), true)),
            lineChart(recent.map(operatingProfit), ink, "zero"),
            chartTitle("Riders per day", fmt.count(recent[recent.length - 1].riders)),
            lineChart(recent.map((d) => d.riders), muted),
          )
        : h("p", { class: "muted" }, "Charts start after a couple of days."),

      h("h3", null, "City budget"),
      row("This year", h("span", { class: "num" }, fmt.money(s.yearBudget))),
      Math.abs(mood) >= 0.01 ? h("p", { class: "hint" }, moodText(mood)) : null,
      h("p", { class: "hint" }, "Paid on 1 January. A profitable year with happy riders earns up to half as much again on top of the city's usual budget."),

      h("h3", null, "Loans"),
      row("Owed", h("span", { class: "num" }, fmt.money(owed))),
      row("Can still borrow", h("span", { class: "num" }, fmt.money(g.maxLoan()))),
      row(
        "Borrow, millions",
        h(
          "span",
          { class: "inline" },
          loanInput,
          h(
            "button",
            {
              onclick: () => {
                g.takeLoan(Number(loanInput.value) * 1e6);
                this.markStale();
              },
            },
            "Borrow",
          ),
        ),
      ),
      owed > 0
        ? row(
            "Repay, millions",
            h(
              "span",
              { class: "inline" },
              repayInput,
              h(
                "button",
                {
                  onclick: () => {
                    g.repayLoans(Number(repayInput.value) * 1e6);
                    this.markStale();
                  },
                },
                "Repay",
              ),
            ),
          )
        : null,
      h("p", { class: "hint" }, `Loans cost ${Math.round(COSTS.loanRate * 100)}% a year, charged as you go.`),
    ].filter((x) => x !== null);
  }
}

function sum(days: DayRecord[]): Ledger {
  const out: Ledger = { riders: 0, fares: 0, running: 0, upkeep: 0, interest: 0, construction: 0, trains: 0, budget: 0, loans: 0 };
  for (const d of days) for (const k of Object.keys(out) as (keyof Ledger)[]) out[k] += d[k];
  return out;
}

/** Money with its sign; nothing for amounts that round to zero. */
function signed(v: number, plus = false): string {
  if (Math.abs(v) < 1) return "—";
  return v > 0 && plus ? `+${fmt.money(v)}` : fmt.money(v);
}

function chartTitle(label: string, value: string): HTMLElement {
  return h("div", { class: "row chart-title" }, h("span", { class: "muted" }, label), h("span", { class: "num" }, value));
}
