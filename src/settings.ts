import type { Theme } from "./map/style";

export type Action =
  | "select"
  | "connect"
  | "track"
  | "station"
  | "depot"
  | "route"
  | "remove"
  | "pause"
  | "speed1"
  | "speed2"
  | "speed3"
  | "undo"
  | "redo"
  | "build"
  | "xray"
  | "deeper"
  | "shallower"
  | "finish"
  | "cancel"
  | "rotateLeft"
  | "rotateRight";

export const ACTION_LABELS: Record<Action, string> = {
  select: "Select",
  connect: "Connect stations",
  track: "Free track",
  station: "Station tool",
  depot: "Depot tool",
  route: "Routes",
  remove: "Remove tool",
  pause: "Pause / resume",
  speed1: "Speed 1",
  speed2: "Speed 2",
  speed3: "Speed 3",
  undo: "Undo",
  redo: "Redo",
  build: "Build plans",
  xray: "X-ray view",
  deeper: "Track deeper / lower",
  shallower: "Track shallower / higher",
  finish: "Finish track",
  cancel: "Cancel",
  rotateLeft: "Turn station or depot left",
  rotateRight: "Turn station or depot right",
};

export const DEFAULT_KEYS: Record<Action, string> = {
  select: "v",
  connect: "c",
  track: "t",
  station: "s",
  depot: "d",
  route: "r",
  remove: "x",
  pause: " ",
  speed1: "1",
  speed2: "2",
  speed3: "3",
  undo: "ctrl+z",
  redo: "ctrl+y",
  build: "b",
  xray: "u",
  deeper: "[",
  shallower: "]",
  finish: "enter",
  cancel: "escape",
  rotateLeft: "q",
  rotateRight: "e",
};

export interface Settings {
  theme: Theme;
  uiScale: number;
  reducedMotion: boolean;
  safeColours: boolean;
  keys: Record<Action, string>;
}

const KEY = "makemetro.settings";

export function loadSettings(): Settings {
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const base: Settings = {
    theme: prefersDark ? "dark" : "light",
    uiScale: 1,
    reducedMotion: !!prefersReduced,
    safeColours: false,
    keys: { ...DEFAULT_KEYS },
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const s = JSON.parse(raw);
    return { ...base, ...s, keys: { ...DEFAULT_KEYS, ...(s.keys ?? {}) } };
  } catch {
    return base;
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage can be unavailable (private windows); settings then last for the session.
  }
}

export function applySettings(s: Settings) {
  const root = document.documentElement;
  root.dataset.theme = s.theme;
  root.dataset.motion = s.reducedMotion ? "reduced" : "full";
  root.style.setProperty("--scale", String(s.uiScale));
}

/** Normalised key name for an event, e.g. "ctrl+z", "[", " ". */
export function keyOf(e: KeyboardEvent): string {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  const mods = [e.ctrlKey || e.metaKey ? "ctrl" : "", e.altKey ? "alt" : "", e.shiftKey && k.length > 1 ? "shift" : ""].filter(Boolean);
  return [...mods, k].join("+");
}

export function keyLabel(k: string): string {
  if (k === " ") return "Space";
  return k
    .split("+")
    .map((p) => (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)))
    .join("+");
}
