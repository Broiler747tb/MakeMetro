import "./ui/style.css";
import { loadCity, cityUrl } from "./city/pack";
import { Buildings } from "./city/buildings";
import { createMap } from "./map/mapView";
import { Game, newGameState } from "./game/game";
import type { GameState } from "./game/model";
import { Scene3D } from "./render/scene3d";
import { App } from "./ui/app";
import { GamepadInput } from "./ui/gamepad";
import { LAYER_IDS } from "./map/gameLayers";
import { h } from "./ui/dom";
import { applySettings, loadSettings } from "./settings";
import * as saves from "./save";

const params = new URLSearchParams(location.search);
const cityId = params.get("city") ?? "moscow";

function loadingScreen() {
  const bar = h("div");
  const text = h("p", null, "Loading…");
  const el = h("div", { class: "loading" }, h("div", { class: "inner" }, h("h1", null, "MakeMetro"), h("div", { class: "progress" }, bar), text));
  document.body.append(el);
  return {
    step(pct: number, msg: string) {
      bar.style.width = `${pct}%`;
      text.textContent = msg;
    },
    fail(msg: string) {
      text.textContent = msg;
      text.className = "bad";
    },
    done() {
      el.remove();
    },
  };
}

async function pickState(city: Awaited<ReturnType<typeof loadCity>>): Promise<GameState> {
  const load = params.get("load");
  if (load) {
    history.replaceState(null, "", location.pathname + (cityId !== "moscow" ? `?city=${cityId}` : ""));
    return saves.load(load);
  }
  if (params.get("new")) {
    history.replaceState(null, "", location.pathname + (cityId !== "moscow" ? `?city=${cityId}` : ""));
    return newGameState(city);
  }
  // Carry on from the most recent save of this city, if there is one.
  const list = await saves.list().catch(() => []);
  const latest = list.find((s) => s.cityId === city.id);
  if (latest) {
    try {
      return await saves.load(latest.name);
    } catch (err) {
      console.warn("couldn't load the latest save", err);
    }
  }
  return newGameState(city);
}

async function boot() {
  const settings = loadSettings();
  applySettings(settings);
  const screen = loadingScreen();
  const t0 = performance.now();
  try {
    screen.step(10, "Reading the city…");
    const city = await loadCity(cityId);
    const state = await pickState(city);
    if (state.cityId !== city.id) throw new Error(`This save is for ${state.cityId}, not ${city.id}.`);
    screen.step(40, "Drawing the map…");
    const map = createMap(document.getElementById("map")!, city, settings.theme, settings.reducedMotion);
    await new Promise<void>((r) => map.once("load", () => r()));
    screen.step(80, "Starting the simulation…");

    const game = new Game(state, city, null);
    // Building outlines are large. Fetch them only once the map is up, so they don't hold up
    // its first tiles, and let play start while they arrive.
    Buildings.load(cityUrl(cityId) + city.manifest.buildings, (f) => (game.buildingsProgress = f)).then(
      (b) => game.setBuildings(b),
      (err) => {
        console.warn("buildings unavailable, demolition checks are off", err);
        game.setBuildings(null);
      },
    );
    const scene = new Scene3D(game, settings.theme);
    const reload = (query: string) => {
      saves.autosave(game.state).finally(() => (location.search = query));
    };
    const app = new App(
      game,
      map,
      scene,
      settings,
      (name) => (location.search = `?city=${cityId}&load=${encodeURIComponent(name)}`),
      () => reload(`?city=${cityId}&new=1`),
    );
    map.addLayer(scene, LAYER_IDS.above3d);
    const pad = new GamepadInput(app);
    screen.done();
    console.info(`ready in ${Math.round(performance.now() - t0)} ms`);

    let last = performance.now();
    let lastWeek = Math.floor(game.day / 7);
    const loop = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      pad.poll(dt);
      game.tick(dt);
      app.frame();
      if (game.speed > 0 && game.trips.length) map.triggerRepaint();
      const week = Math.floor(game.day / 7);
      if (week !== lastWeek) {
        lastWeek = week;
        saves.autosave(game.state).catch((err) => console.warn("autosave failed", err));
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    const saveOnLeave = () => {
      if (document.visibilityState === "hidden") saves.autosave(game.state).catch(() => {});
    };
    document.addEventListener("visibilitychange", saveOnLeave);
    window.addEventListener("pagehide", () => saves.autosave(game.state).catch(() => {}));
    if (import.meta.env.DEV) Object.assign(window, { game, map, app });
  } catch (err) {
    console.error(err);
    screen.fail(err instanceof Error ? err.message : String(err));
  }
}

boot();
