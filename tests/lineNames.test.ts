import { test } from "node:test";
import assert from "node:assert/strict";
import { lineNameFrom, suggestLineName } from "../src/game/lineNames";

test("place names make Moscow-style line names", () => {
  const cases: [string, string | null][] = [
    ["Сокольники", "Сокольническая"],
    ["Замоскворечье", "Замоскворецкая"],
    ["Таганка", "Таганская"],
    ["Пресня", "Пресненская"],
    ["Калуга", "Калужская"],
    ["Измайлово", "Измайловская"],
    ["Химки", "Химкинская"],
    ["Арбат", "Арбатская"],
    ["Тёплый Стан", "Тёплостанская"],
    ["Измайловский парк", "Измайловская"],
    ["Парк культуры", null],
    ["Station 4", null],
  ];
  for (const [place, name] of cases) assert.equal(lineNameFrom(place), name, place);
});

test("a line is named from its outer end, skipping names other lines have", () => {
  const stops = [
    { name: "Арбат", x: 500, y: 0 },
    { name: "Таганка", x: 3000, y: 0 },
    { name: "Измайлово", x: 9000, y: 0 },
  ];
  assert.equal(suggestLineName(stops, [0, 0], new Set()), "Измайловская");
  assert.equal(suggestLineName(stops, [0, 0], new Set(["измайловская"])), "Арбатская");
  assert.equal(suggestLineName(stops.slice(0, 1), [0, 0], new Set()), "");
  assert.equal(suggestLineName([...stops, stops[0]], [0, 0], new Set()), "Кольцевая");
});
