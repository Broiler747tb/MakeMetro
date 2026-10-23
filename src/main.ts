import "./ui/style.css";
import { loadCity, type City } from "./city/pack";
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

/**
 * Runs once the map is up. Building outlines come first, since nothing can be built without
 * them; then the rest of the city is saved to disk so later visits open from it.
 */
async function keepCity(city: City, game: Game, app: App) {
  const store = city.store;
  try {
    game.setBuildings(new Buildings(await store.get(city.manifest.buildings, (f) => (game.buildingsProgress = f))));
  } catch (err) {
    console.warn("buildings unavailable, demolition checks are off", err);
    game.setBuildings(null);
  }
  try {
    const fresh = !(await store.has(city.manifest.basemap));
    if (fresh) app.setSaving(0);
    await store.keep(city.manifest.basemap, (f) => fresh && app.setSaving(f * 0.97));
    const dem = city.manifest.dem;
    if (dem) {
      const urls = terrainTiles(city).map((t) => store.url(dem.tiles.replace("{z}", String(t[0])).replace("{x}", String(t[1])).replace("{y}", String(t[2]))));
      let done = 0;
      await Promise.all(
        Array.from({ length: 6 }, async () => {
          while (urls.length) {
            await store.fetchKept(urls.pop()!).catch(() => {});
            if (fresh) app.setSaving(0.97 + (0.03 * ++done) / (done + urls.length));
          }
        }),
      );
    }
    app.setSaving(null);
    // Ask the browser not to clear the saved city when it's short of space.
    if (fresh) navigator.storage?.persist?.().catch(() => {});
  } catch (err) {
    console.warn("couldn't save the city for offline play", err);
    app.setSaving(null);
  }
}

/** Tile coordinates covering the city at the zooms its terrain tiles come in. */
function terrainTiles(city: City): [number, number, number][] {
  const dem = city.manifest.dem!;
  const [w, s, e, n] = city.manifest.bbox;
  const out: [number, number, number][] = [];
  const tx = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
  const ty = (lat: number, z: number) => {
    const r = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
  };
  for (let z = dem.minzoom; z <= dem.maxzoom; z++) {
    for (let x = tx(w, z); x <= tx(e, z); x++) for (let y = ty(n, z); y <= ty(s, z); y++) out.push([z, x, y]);
  }
  return out;
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
    keepCity(city, game, app);
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
