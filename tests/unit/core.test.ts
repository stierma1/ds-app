import test from "node:test";
import assert from "node:assert/strict";
import {
  ConcurrentModificationError,
  ConsumedError,
  UnsupportedError,
  defaultComparator,
  resolveComparator,
} from "../../src/core/index.ts";

test("defaultComparator orders primitives and dates", () => {
  assert.equal(defaultComparator(1, 2), -1);
  assert.equal(defaultComparator(2, 2), 0);
  assert.equal(defaultComparator(3n, 2n), 1);
  assert.equal(defaultComparator("a", "b"), -1);
  assert.equal(defaultComparator(new Date(1), new Date(2)), -1);
  assert.equal(defaultComparator({ valueOf: () => 4 }, { valueOf: () => 5 }), -1);
});

test("defaultComparator rejects unsupported values", () => {
  assert.throws(() => defaultComparator({}, {}), TypeError);
  assert.throws(() => defaultComparator(null as never, 1), TypeError);
  assert.throws(() => defaultComparator(undefined as never, 1), TypeError);
});

test("resolveComparator returns the supplied function", () => {
  const compare = (a: number, b: number): number => b - a;
  assert.equal(resolveComparator(compare), compare);
  assert.equal(resolveComparator<number>()(1, 2), -1);
  assert.throws(() => resolveComparator("nope" as never), TypeError);
});

test("error subclasses are distinguishable", () => {
  assert.ok(new UnsupportedError() instanceof Error);
  assert.equal(new ConcurrentModificationError().name, "ConcurrentModificationError");
  assert.equal(new ConsumedError().name, "ConsumedError");
});
