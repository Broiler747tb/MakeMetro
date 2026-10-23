import type { App } from "./app";
import { h, lineChart, modal, row, seg } from "./dom";
import * as fmt from "./format";
import * as saves from "../save";
import { ACTION_LABELS, DEFAULT_KEYS, keyLabel, keyOf, saveSettings, applySettings, type Action } from "../settings";

export function openFinance(app: App) {
  const g = app.game;
  const s = g.state;
  const box = h("div", { class: "modal box" });
  const render = () => {
    const hist = s.history.slice(-60);
    const owed = s.loans.reduce((a, l) => a + l.balance, 0);
    const loanInput = h("input", { type: "number", min: 0, step: 100, value: 500, title: "Millions" });
    const repayInput = h("input", { type: "number", min: 0, step: 100, value: Math.round(owed / 1e6), title: "Millions" });
    const num = (value: number, step: number, set: (v: number) => void) =>
      h("input", {
        type: "number",
        min: 0,
        max: 50,
        step,
        value,
        onchange: (e: Event) => {
          set(Math.max(0, Number((e.target as HTMLInputElement).value) || 0));
          g.networkChanged();
          render();
        },
      });
    const f = s.fares;
    const fareRows = [
      row(
        "Fares",
        seg(
          [
            { value: "flat", label: "Flat" },
            { value: "distance", label: "By distance" },
            { value: "zones", label: "Zones" },
          ],
          f.mode,
          (v) => {
            f.mode = v as typeof f.mode;
            g.networkChanged();
            render();
          },
        ),
      ),
      row(f.mode === "flat" ? "Fare" : "Base fare", num(s.fare, 0.1, (v) => (s.fare = v))),
      f.mode === "distance" ? row("Per km", num(f.perKm, 0.01, (v) => (f.perKm = v))) : null,
      f.mode === "zones" ? row("Ring width (km)", num(f.zoneWidth / 1000, 1, (v) => (f.zoneWidth = Math.max(1000, v * 1000)))) : null,
      f.mode === "zones" ? row("Per ring crossed", num(f.perZone, 0.1, (v) => (f.perZone = v))) : null,
      h("p", { class: "hint" }, "Higher fares bring in more per rider but push people with short trips back to walking."),
    ].filter((x): x is HTMLElement => x !== null);
    box.replaceChildren(
      h("h2", null, "Finances"),
      row("Money", h("span", { class: "num" }, s.sandbox.unlimitedMoney ? "Unlimited" : fmt.money(s.money))),
      row("City budget this year", h("span", { class: "num" }, fmt.money(s.yearBudget))),
      h("p", { class: "hint" }, "The budget arrives on 1 January. It grows when the network turns a profit and people are happy with it."),
      ...fareRows,
      h("h3", null, "Loans"),
      row("Owed", h("span", { class: "num" }, fmt.money(owed))),
      row("Can still borrow", h("span", { class: "num" }, fmt.money(g.maxLoan()))),
      row(
        "Borrow (millions)",
        h(
          "span",
          { style: { display: "flex", gap: "6px" } },
          loanInput,
          h(
            "button",
            {
              onclick: () => {
                g.takeLoan(Number(loanInput.value) * 1e6);
                render();
              },
            },
            "Borrow",
          ),
        ),
      ),
      owed > 0
        ? row(
            "Repay (millions)",
            h(
              "span",
              { style: { display: "flex", gap: "6px" } },
              repayInput,
              h(
                "button",
                {
                  onclick: () => {
                    g.repayLoans(Number(repayInput.value) * 1e6);
                    render();
                  },
                },
                "Repay",
              ),
            ),
          )
        : h("span"),
      h("h3", null, "Last 60 days"),
      hist.length >= 2
        ? h(
            "div",
            null,
            h("div", { class: "muted" }, "Riders per day"),
            lineChart(
              hist.map((d) => d.riders),
              "#5a8fd0",
            ),
            h("div", { class: "muted" }, "Profit per day (fares minus running costs)"),
            lineChart(
              hist.map((d) => d.revenue - d.operating),
              "#3b9c5a",
            ),
          )
        : h("p", { class: "muted" }, "Not enough days yet."),
      hist.length
        ? h(
            "div",
            null,
            row("Yesterday's riders", h("span", { class: "num" }, fmt.count(hist[hist.length - 1].riders))),
            row("Yesterday's fares", h("span", { class: "num" }, fmt.money(hist[hist.length - 1].revenue))),
            row("Yesterday's running costs", h("span", { class: "num" }, fmt.money(hist[hist.length - 1].operating))),
          )
        : h("span"),
      h("div", { class: "actions" }, h("button", { onclick: () => close() }, "Close")),
    );
  };
  render();
  const close = modal(box, () => app.updateBar());
}

export function openMenu(app: App, onLoad: (name: string) => void, onNewGame: () => void) {
  const g = app.game;
  const box = h("div", { class: "modal box" });
  const close = modal(box);
  const render = async () => {
    const list = await saves.list().catch(() => [] as saves.SaveInfo[]);
    const nameInput = h("input", { type: "text", value: `${g.city.manifest.name} ${fmt.shortDate(g.date())} ${g.date().getUTCFullYear()}`, style: { flex: "1" } });
    const fileInput = h("input", {
      type: "file",
      accept: ".mmsave,.gz",
      hidden: true,
      onchange: async () => {
        const f = fileInput.files?.[0];
        if (!f) return;
        try {
          const state = await saves.fromFile(f);
          await saves.save(`Imported ${f.name}`, state);
          close();
          onLoad(`Imported ${f.name}`);
        } catch (err) {
          alert(`Couldn't read that file: ${err instanceof Error ? err.message : err}`);
        }
      },
    });
    box.replaceChildren(
      h("h2", null, "MakeMetro"),
      h("h3", null, "Save"),
      h(
        "div",
        { class: "row" },
        nameInput,
        h(
          "button",
          {
            class: "primary",
            onclick: async () => {
              await saves.save(nameInput.value.trim() || "Save", g.state);
              g.log("Game saved.");
              render();
            },
          },
          "Save",
        ),
      ),
      h("h3", null, "Load"),
      list.length
        ? h(
            "div",
            { class: "list" },
            list.map((s) =>
              h(
                "div",
                null,
                h("span", { class: "grow" }, s.name),
                h("span", { class: "muted num" }, new Date(s.savedAt).toLocaleDateString()),
                h(
                  "button",
                  {
                    onclick: () => {
                      close();
                      onLoad(s.name);
                    },
                  },
                  "Load",
                ),
                h(
                  "button",
                  {
                    title: "Delete",
                    onclick: async () => {
                      if (confirm(`Delete "${s.name}"?`)) {
                        await saves.remove(s.name);
                        render();
                      }
                    },
                  },
                  "×",
                ),
              ),
            ),
          )
        : h("p", { class: "muted" }, "No saves yet."),
      h(
        "div",
        { class: "row", style: { marginTop: "10px", justifyContent: "flex-start" } },
        h("button", { onclick: () => saves.download(g.state, `${g.city.id}-${g.day}.mmsave`) }, "Export to file"),
        h("button", { onclick: () => fileInput.click() }, "Import file"),
        fileInput,
      ),
      h(
        "div",
        { class: "actions" },
        h(
          "button",
          {
            onclick: () => {
              if (confirm("Start a new game? Unsaved progress will be lost.")) {
                close();
                onNewGame();
              }
            },
          },
          "New game",
        ),
        h(
          "button",
          {
            onclick: () => {
              close();
              openSettings(app);
            },
          },
          "Settings",
        ),
        h("button", { class: "primary", onclick: () => close() }, "Back to game"),
      ),
    );
  };
  render();
}

export function openSettings(app: App) {
  const g = app.game;
  const s = app.settings;
  const box = h("div", { class: "modal box" });
  let listening: Action | null = null;
  const onKey = (e: KeyboardEvent) => {
    if (!listening) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key !== "Escape") s.keys[listening] = keyOf(e);
    listening = null;
    saveSettings(s);
    render();
  };
  document.addEventListener("keydown", onKey, true);
  const close = modal(box, () => {
    document.removeEventListener("keydown", onKey, true);
    saveSettings(s);
    app.dirty();
    app.updateBar();
  });
  const hoursRow = (label: string, hours: { open: number; close: number }, set: (v: { open: number; close: number }) => void) =>
    row(
      label,
      h(
        "span",
        { style: { display: "flex", gap: "6px", alignItems: "center" } },
        h("input", {
          type: "text",
          value: fmt.hhmm(hours.open),
          style: { width: "4.5em", fontFamily: "var(--mono)" },
          onchange: (e: Event) => {
            const v = fmt.parseHhmm((e.target as HTMLInputElement).value);
            if (v !== null) set({ open: v, close: hours.close });
            g.networkChanged();
            render();
          },
        }),
        "to",
        h("input", {
          type: "text",
          value: fmt.hhmm(hours.close),
          style: { width: "4.5em", fontFamily: "var(--mono)" },
          onchange: (e: Event) => {
            const v = fmt.parseHhmm((e.target as HTMLInputElement).value);
            if (v !== null) set({ open: hours.open, close: v <= hours.open ? v + 1440 : v });
            g.networkChanged();
            render();
          },
        }),
        h(
          "button",
          {
            class: "link",
            onclick: () => {
              set({ open: 0, close: 1440 });
              g.networkChanged();
              render();
            },
          },
          "24/7",
        ),
      ),
    );
  const render = () => {
    const st = g.state;
    const periods = h(
      "table",
      { class: "grid" },
      h("tr", null, h("th", null, "Period"), h("th", null, "Starts")),
      st.periods.map((p) =>
        h(
          "tr",
          null,
          h("td", null, h("input", { type: "text", value: p.name, onchange: (e: Event) => (p.name = (e.target as HTMLInputElement).value.trim() || p.name) })),
          h(
            "td",
            null,
            h("input", {
              type: "text",
              value: fmt.hhmm(p.start),
              style: { width: "5em", fontFamily: "var(--mono)" },
              onchange: (e: Event) => {
                const v = fmt.parseHhmm((e.target as HTMLInputElement).value);
                if (v !== null) {
                  p.start = v;
                  st.periods.sort((a, b) => a.start - b.start);
                  g.networkChanged();
                }
                render();
              },
            }),
          ),
        ),
      ),
    );
    box.replaceChildren(
      h("h2", null, "Settings"),
      h("h3", null, "Display"),
      row(
        "Theme",
        seg(
          [
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ],
          s.theme,
          (v) => {
            if (v !== s.theme) app.toggleTheme();
            render();
          },
        ),
      ),
      row(
        "Units",
        seg(
          [
            { value: "metric", label: "Metric" },
            { value: "imperial", label: "Imperial" },
          ],
          st.units,
          (v) => {
            st.units = v as typeof st.units;
            render();
          },
        ),
      ),
      row(
        "Interface size",
        h("input", {
          type: "range",
          min: 0.85,
          max: 1.5,
          step: 0.05,
          value: s.uiScale,
          style: { width: "160px" },
          onchange: (e: Event) => {
            s.uiScale = Number((e.target as HTMLInputElement).value);
            applySettings(s);
          },
        }),
      ),
      row(
        "Reduce motion",
        h("input", {
          type: "checkbox",
          checked: s.reducedMotion,
          onchange: (e: Event) => {
            s.reducedMotion = (e.target as HTMLInputElement).checked;
            applySettings(s);
          },
        }),
      ),
      row(
        "Colour-blind safe line colours",
        h("input", {
          type: "checkbox",
          checked: s.safeColours,
          onchange: (e: Event) => (s.safeColours = (e.target as HTMLInputElement).checked),
        }),
      ),
      h("h3", null, "This game"),
      row(
        "Unlimited money",
        h("input", {
          type: "checkbox",
          checked: st.sandbox.unlimitedMoney,
          onchange: (e: Event) => (st.sandbox.unlimitedMoney = (e.target as HTMLInputElement).checked),
        }),
      ),
      row(
        "Instant construction",
        h("input", {
          type: "checkbox",
          checked: st.sandbox.instantBuild,
          onchange: (e: Event) => (st.sandbox.instantBuild = (e.target as HTMLInputElement).checked),
        }),
      ),
      row(
        "Walking range to stations",
        h("input", {
          type: "number",
          min: 400,
          max: 2000,
          step: 100,
          value: st.walkRange,
          onchange: (e: Event) => {
            st.walkRange = Math.max(400, Math.min(2000, Number((e.target as HTMLInputElement).value) || 1000));
            g.networkChanged();
          },
        }),
      ),
      hoursRow("Weekday service", st.serviceHours, (v) => (st.serviceHours = v)),
      hoursRow("Weekend service", st.weekendHours, (v) => (st.weekendHours = v)),
      h("p", { class: "hint" }, "A closing time after midnight runs into the next morning. Late weekend trains carry people home from nights out."),
      h("h3", null, "Service periods"),
      periods,
      h("p", { class: "hint" }, "Routes set a frequency for each period, separately for weekdays and weekends."),
      h("h3", null, "Keys"),
      h(
        "table",
        { class: "grid" },
        (Object.keys(ACTION_LABELS) as Action[]).map((a) =>
          h(
            "tr",
            null,
            h("td", null, ACTION_LABELS[a]),
            h(
              "td",
              null,
              h(
                "button",
                {
                  class: listening === a ? "primary" : "",
                  style: { minWidth: "7em", fontFamily: "var(--mono)" },
                  onclick: () => {
                    listening = a;
                    render();
                  },
                },
                listening === a ? "Press a key…" : keyLabel(s.keys[a]),
              ),
            ),
          ),
        ),
      ),
      h(
        "div",
        { class: "actions" },
        h(
          "button",
          {
            onclick: () => {
              s.keys = { ...DEFAULT_KEYS };
              render();
            },
          },
          "Reset keys",
        ),
        h("button", { class: "primary", onclick: () => close() }, "Done"),
      ),
    );
  };
  render();
}
