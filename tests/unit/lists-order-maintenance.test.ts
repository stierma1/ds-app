import test from "node:test";
import assert from "node:assert/strict";
import {
  ConsumedError,
  OrderMaintenanceList,
} from "../../src/index.ts";
import type { OrderLabel } from "../../src/lists/types.ts";

test("OrderMaintenanceList orders by label and supports middle insertion", () => {
  const list = new OrderMaintenanceList<string>();
  const a = list.insertAfter(null, "a");
  const c = list.insertAfter(a, "c");
  const b = list.insertAfter(a, "b");

  assert.deepEqual(list.toArray(), ["a", "b", "c"]);
  assert.equal(list.size, 3);
  assert.equal(list.get(a), "a");
  assert.equal(list.get(b), "b");
  assert.equal(list.get(c), "c");
  assert.ok(list.compare(a, b) < 0);
  assert.ok(list.compare(b, c) < 0);
  assert.ok(list.compare(c, a) > 0);
  assert.equal(list.compare(a, a), 0);
  assert.equal(list.validate(), true);
});

test("OrderMaintenanceList deletes labels and consumes them", () => {
  const list = new OrderMaintenanceList<number>();
  const first = list.insertAfter(null, 1);
  const second = list.insertAfter(first, 2);
  const third = list.insertAfter(second, 3);

  assert.equal(list.delete(second), true);
  assert.deepEqual(list.toArray(), [1, 3]);
  assert.throws(() => list.get(second), ConsumedError);
  assert.throws(() => list.compare(first, second), ConsumedError);
  assert.throws(() => list.delete(second), ConsumedError);
  assert.throws(() => list.insertAfter(second, 4), ConsumedError);
  assert.equal(list.validate(), true);

  list.delete(first);
  list.delete(third);
  assert.equal(list.isEmpty(), true);
  assert.equal(list.validate(), true);
});

test("OrderMaintenanceList rejects foreign labels and undefined values", () => {
  const list = new OrderMaintenanceList<number>();
  const other = new OrderMaintenanceList<number>();
  const foreign = other.insertAfter(null, 1);
  const own = list.insertAfter(null, 1);

  assert.throws(() => list.insertAfter(foreign, 2), TypeError);
  assert.throws(() => list.compare(foreign, own), TypeError);
  assert.throws(() => list.get({ list: list } as OrderLabel), TypeError);
  assert.throws(() => list.insertAfter(null, undefined as never), TypeError);
});

test("OrderMaintenanceList survives labels exhausted between two nodes", () => {
  const list = new OrderMaintenanceList<number>();
  const first = list.insertAfter(null, 0);
  const last = list.insertAfter(first, 1);
  for (let i = 0; i < 200; i++) {
    list.insertAfter(first, 100 + i);
    assert.equal(list.validate(), true);
  }
  assert.equal(list.size, 202);
  const values = list.toArray();
  assert.equal(values[0], 0);
  assert.equal(values[values.length - 1], 1);
  assert.equal(values[1], 299);
  assert.equal(values[values.length - 2], 100);
  assert.ok(list.compare(first, last) < 0);
});

test("OrderMaintenanceList clear consumes existing labels", () => {
  const list = new OrderMaintenanceList<string>();
  const label = list.insertAfter(null, "a");
  list.insertAfter(label, "b");
  list.clear();
  assert.equal(list.size, 0);
  assert.throws(() => list.get(label), ConsumedError);
  assert.equal(list.validate(), true);
});
