import { gzipSync, gunzipSync, strFromU8, strToU8 } from "fflate";
import type { GameState } from "./game/model";

const DB = "makemetro";
const STORE = "saves";
const AUTOSAVES = 3;

export interface SaveInfo {
  name: string;
  cityId: string;
  savedAt: number; // wall clock ms
  gameTime: number;
  startDate: string;
  money: number;
  stations: number;
  auto: boolean;
}

interface Record_ extends SaveInfo {
  data: Uint8Array;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "name" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export function encode(state: GameState): Uint8Array {
  return gzipSync(strToU8(JSON.stringify(state)), { level: 6 });
}

export function decode(data: Uint8Array): GameState {
  const state = JSON.parse(strFromU8(gunzipSync(data))) as GameState;
  if ((state.format as number) === 1) throw new Error("This save is from an earlier version of the game, before stations were placed on their own, and can't be loaded.");
  if (state.format !== 2) throw new Error(`Unknown save format ${state.format}`);
  return migrate(state);
}

/** Fills in fields added after a save was written. */
function migrate(s: GameState): GameState {
  s.fleet ??= {};
  s.walkRange ??= 1000;
  s.units ??= "metric";
  s.fares ??= { mode: "flat", perKm: 0.1, zoneWidth: 8000, perZone: 0.5 };
  s.weekendHours ??= { open: 6 * 60, close: 26 * 60 };
  return s;
}

function info(name: string, s: GameState, auto: boolean): SaveInfo {
  return {
    name,
    cityId: s.cityId,
    savedAt: Date.now(),
    gameTime: s.time,
    startDate: s.startDate,
    money: s.money,
    stations: s.stations.length,
    auto,
  };
}

export async function save(name: string, state: GameState, auto = false): Promise<void> {
  const rec: Record_ = { ...info(name, state, auto), data: encode(state) };
  await tx("readwrite", (s) => s.put(rec));
}

export async function autosave(state: GameState): Promise<void> {
  const all = (await list()).filter((s) => s.auto && s.cityId === state.cityId).sort((a, b) => a.savedAt - b.savedAt);
  // Rotate through a few slots so a bad moment doesn't overwrite every autosave.
  const name = all.length < AUTOSAVES ? `Autosave ${all.length + 1}` : all[0].name;
  await save(name, state, true);
}

export async function list(): Promise<SaveInfo[]> {
  const recs = await tx<Record_[]>("readonly", (s) => s.getAll() as IDBRequest<Record_[]>);
  return recs.map(({ data: _data, ...rest }) => rest).sort((a, b) => b.savedAt - a.savedAt);
}

export async function load(name: string): Promise<GameState> {
  const rec = await tx<Record_ | undefined>("readonly", (s) => s.get(name) as IDBRequest<Record_ | undefined>);
  if (!rec) throw new Error(`No save called ${name}`);
  return decode(rec.data);
}

export async function remove(name: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(name));
}

export function download(state: GameState, filename: string) {
  const blob = new Blob([encode(state) as BlobPart], { type: "application/gzip" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function fromFile(file: File): Promise<GameState> {
  return decode(new Uint8Array(await file.arrayBuffer()));
}
