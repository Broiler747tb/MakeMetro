export type Units = "metric" | "imperial";

export function money(v: number): string {
  const sign = v < 0 ? "−" : "";
  const a = Math.abs(v);
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(a >= 1e10 ? 1 : 2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(0)}k`;
  return `${sign}$${a.toFixed(0)}`;
}

export function count(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e4) return `${(v / 1e3).toFixed(0)}k`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return v.toFixed(0);
}

export function distance(m: number, u: Units): string {
  if (u === "imperial") {
    const ft = m * 3.28084;
    return ft >= 5280 ? `${(ft / 5280).toFixed(2)} mi` : `${ft.toFixed(0)} ft`;
  }
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(0)} m`;
}

export function depth(m: number, u: Units): string {
  const v = u === "imperial" ? m * 3.28084 : m;
  const unit = u === "imperial" ? "ft" : "m";
  if (Math.abs(v) < 0.5) return "at grade";
  return v < 0 ? `${Math.abs(v).toFixed(0)} ${unit} deep` : `${v.toFixed(0)} ${unit} up`;
}

export function speed(kmh: number, u: Units): string {
  return u === "imperial" ? `${(kmh / 1.609).toFixed(0)} mph` : `${kmh.toFixed(0)} km/h`;
}

export function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

export function hhmm(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function parseHhmm(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v >= 0 && v < 1440 ? v : null;
}

export function days(d: number): string {
  if (d < 1) return "less than a day";
  if (d < 60) return `${Math.ceil(d)} days`;
  if (d < 730) return `${(d / 30.4).toFixed(0)} months`;
  return `${(d / 365).toFixed(1)} years`;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function dateTime(d: Date): string {
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}  ${hhmm(d.getUTCHours() * 60 + d.getUTCMinutes())}`;
}

export function shortDate(d: Date): string {
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
