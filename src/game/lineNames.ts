// Moscow-style line names: one adjective made from a place the line serves, the way
// Сокольники gives the Сокольническая line. It only works for Russian names; lines in
// other cities, or with no usable station names, go by their number.

// Words that say what a place is rather than which one it is.
const GENERIC = new Set([
  "парк", "улица", "площадь", "проспект", "бульвар", "шоссе", "переулок", "проезд", "набережная",
  "район", "микрорайон", "посёлок", "поселок", "деревня", "село", "станция", "платформа", "мост",
  "вокзал", "аллея", "тупик", "сквер", "сад", "рынок", "центр", "промзона", "зона", "имени", "им.",
]);

// Adjective endings and their feminine form, longest first.
const ADJECTIVE_ENDINGS: [string, string][] = [
  ["ская", "ская"], ["цкая", "цкая"], ["ский", "ская"], ["цкий", "цкая"], ["ские", "ская"], ["ское", "ская"],
  ["ний", "няя"], ["нее", "няя"], ["ние", "няя"], ["яя", "яя"],
  ["ая", "ая"], ["ый", "ая"], ["ий", "ая"], ["ой", "ая"], ["ое", "ая"], ["ые", "ая"], ["ие", "ая"],
];

const CONSONANTS = "бвгджзклмнпрстфхцчшщ";

function isAdjective(word: string): boolean {
  return ADJECTIVE_ENDINGS.some(([end]) => word.endsWith(end));
}

/** Feminine adjective from one word of a place name, in lower case, or null when it won't make one. */
export function adjective(word: string): string | null {
  const w = word.toLowerCase();
  if (w.length < 3 || !/^[а-яё]+$/.test(w)) return null;
  for (const [end, to] of ADJECTIVE_ENDINGS) if (w.endsWith(end)) return w.slice(0, -end.length) + to;
  if (w === "москва") return "московская";
  const stem = (n: number) => w.slice(0, w.length - n);
  if (w.endsWith("ники")) return stem(2) + "ческая"; // Сокольники
  if (w.endsWith("чье")) return stem(3) + "цкая"; // Замоскворечье
  if (w.endsWith("ье")) return stem(2) + "ская";
  if (w.endsWith("ня")) return stem(1) + "енская"; // Пресня
  if (w.endsWith("ка")) return stem(2) + "ская"; // Таганка
  if (w.endsWith("инки")) return stem(2) + "ская"; // Кузьминки
  if (w.endsWith("цы")) return CONSONANTS.includes(w[w.length - 3]) ? stem(2) + "ецкая" : stem(2) + "цкая"; // Люберцы
  if (/[иы]$/.test(w)) return stem(1) + "инская"; // Химки, Мытищи
  if (w.endsWith("о")) return stem(1) + "ская"; // Измайлово, Строгино
  if (w.endsWith("а")) {
    const s = stem(1);
    const last = s[s.length - 1];
    if (last === "г") return s.slice(0, -1) + "жская"; // Рига, Калуга
    if (last === "х") return s + "инская"; // Барвиха
    if (last === "л") return s + "ьская"; // Тула
    if (CONSONANTS.includes(last) && CONSONANTS.includes(s[s.length - 2])) return s + "инская"; // Дубна
    return s + "ская";
  }
  if (w.endsWith("ь")) return stem(1) + "ская"; // Тверь
  if (w.endsWith("ок")) return stem(2) + "ская"; // Городок
  if (w.endsWith("ск") || w.endsWith("цк")) return w + "ая"; // Подольск, Троицк
  if (w.endsWith("ц")) return w + "кая";
  if (w.endsWith("л")) return w + "ьская"; // Сокол
  if (CONSONANTS.includes(w[w.length - 1])) return w + "ская"; // Арбат, Реутов
  return null;
}

/** The stem an adjective takes in front of another word: красн-о- in Краснополянская, больш-е- in Большеполянская. */
function joiningStem(adj: string): string {
  const s = adj.replace(/(ая|яя)$/, "");
  return s + (/[жшчщц]$/.test(s) || adj.endsWith("яя") ? "е" : "о");
}

function capitalise(s: string): string {
  return s[0].toUpperCase() + s.slice(1);
}

/** Moscow-style line name from a station or place name, or null when it doesn't make one. */
export function lineNameFrom(place: string): string | null {
  const words = place
    .trim()
    .split(/\s+/)
    .filter((w) => !/\d/.test(w));
  if (!words.length || words.length > 3) return null;
  // A generic word followed by a name is genitive (Парк Победы, Площадь Ильича): leave it be.
  if (words.length > 1 && GENERIC.has(words[0].toLowerCase()) && !isAdjective(words[1].toLowerCase())) return null;
  const parts = words.filter((w) => !GENERIC.has(w.toLowerCase()));
  if (parts.length === 1) {
    const a = adjective(parts[0]);
    return a ? capitalise(a) : null;
  }
  if (parts.length === 2 && isAdjective(parts[0].toLowerCase())) {
    // Тёплый Стан makes Тёплостанская, Чистые пруды Чистопрудная.
    const first = adjective(parts[0]);
    const noun = parts[1].toLowerCase();
    const second = /[^к]ы$/.test(noun) ? noun.slice(0, -1) + "ная" : adjective(noun);
    return first && second ? capitalise(joiningStem(first) + second) : null;
  }
  return null;
}

/**
 * A name for a line through these stations, or "" when none fits. Most Moscow lines take
 * their name from a place out along them, so try the outer end first and work inwards,
 * skipping names other lines already have.
 */
export function suggestLineName(stops: { name: string; x: number; y: number }[], centre: [number, number], taken: Set<string>): string {
  if (stops.length < 2) return "";
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (first === last || (first.x === last.x && first.y === last.y)) {
    for (const ring of ["Кольцевая", "Большая кольцевая", "Малая кольцевая"]) if (!taken.has(ring.toLowerCase())) return ring;
    return "";
  }
  const out = (s: { x: number; y: number }) => Math.hypot(s.x - centre[0], s.y - centre[1]);
  // Ends first, the farther one leading, then inwards from both ends in turn.
  const order: typeof stops = [];
  for (let i = 0, j = stops.length - 1; i <= j; i++, j--) {
    const pair = i === j ? [stops[i]] : out(stops[i]) >= out(stops[j]) ? [stops[i], stops[j]] : [stops[j], stops[i]];
    order.push(...pair);
  }
  for (const st of order) {
    const name = lineNameFrom(st.name);
    if (name && !taken.has(name.toLowerCase())) return name;
  }
  return "";
}

/** How a line reads in running text: its number, then its name when it has one. */
export function lineTitle(r: { number: number; name: string }): string {
  return r.name ? `Line ${r.number} ${r.name}` : `Line ${r.number}`;
}
