import { test } from "node:test";
import assert from "node:assert/strict";
import { circumradius, closestOnPolyline, minRadius, polylineLength, smoothPath, splitAt } from "../src/game/geometry";

test("a quarter turn between two platforms comes out close to a circular arc", () => {
  // Leave heading east from the origin, arrive heading north at (1000, 1000).
  const line = smoothPath([0, 0], [1, 0], [], [1000, 1000], [0, 1]);
  const r = minRadius(line);
  assert.ok(r > 800 && r < 1300, `radius ${r}`);
  assert.ok(Math.abs(polylineLength(line) - (Math.PI / 2) * 1000) < 80, `length ${polylineLength(line)}`);
});

test("track leaves and arrives along the given directions", () => {
  const line = smoothPath([0, 0], [1, 0], [], [1000, 1000], [0, 1]);
  const n = line.length;
  assert.ok(Math.abs(line[3] - line[1]) < 0.5, "starts heading east");
  assert.ok(Math.abs(line[n - 2] - line[n - 4]) < 0.5, "ends heading north");
});

test("the curve passes through every bend point", () => {
  const bends: [number, number][] = [[500, 300], [1200, -200]];
  const line = smoothPath([0, 0], [1, 0], bends, [2000, 0], [1, 0]);
  for (const [x, y] of bends) assert.ok(closestOnPolyline(line, x, y).dist < 1e-6);
});

test("with no directions and no bends the track is straight", () => {
  const line = smoothPath([0, 0], null, [], [300, 400], null);
  assert.ok(Math.abs(polylineLength(line) - 500) < 1e-6);
  assert.equal(minRadius(line), Infinity);
});

test("splitting keeps the total length", () => {
  const line = smoothPath([0, 0], [1, 0], [[500, 200]], [800, 400], [0, 1]);
  const total = polylineLength(line);
  const [a, b] = splitAt(line, 321);
  assert.ok(Math.abs(polylineLength(a) - 321) < 0.01);
  assert.ok(Math.abs(polylineLength(a) + polylineLength(b) - total) < 0.01);
});

test("closest point lies on the line", () => {
  const c = closestOnPolyline([0, 0, 100, 0], 40, 25);
  assert.deepEqual([c.x, c.y, c.dist, c.s], [40, 0, 25, 40]);
});

test("circumradius of collinear points is infinite", () => {
  assert.equal(circumradius(0, 0, 1, 1, 2, 2), Infinity);
});
