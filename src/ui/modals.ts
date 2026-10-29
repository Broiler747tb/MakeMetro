import type { App } from "./app";
import { h, modal, row, seg } from "./dom";
import * as fmt from "./format";
import * as saves from "../save";
import { CityStore } from "../city/store";
import { ACTION_LABELS, DEFAULT_KEYS, keyLabel, keyOf, saveSettings, applySettings, type Action } from "../settings";

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
  const storageRow = row("City data on this computer", h("span", { class: "muted" }, "…"));
  CityStore.usage(g.city.id).then((bytes) => {
    storageRow.replaceChildren(
      h("label", null, "City data on this computer"),
      h(
        "span",
        { style: { display: "flex", gap: "8px", alignItems: "center" } },
        h("span", { class: "num" }, bytes ? `${Math.round(bytes / 1e6)} MB` : "none"),
        bytes
          ? h(
              "button",
              {
                class: "link",
                title: "It downloads again the next time you play",
                onclick: async () => {
                  await CityStore.forget(g.city.id);
                  storageRow.querySelector(".num")!.textContent = "none";
                },
              },
              "Remove",
            )
          : null,
      ),
    );
  });
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
      h("h3", null, "Storage"),
      storageRow,
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
