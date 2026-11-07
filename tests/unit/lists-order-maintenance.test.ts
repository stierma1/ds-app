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

test("OrderMaintenanceList stays fast under inserts concentrated at one position", () => {
  const list = new OrderMaintenanceList<number>();
  const anchor = list.insertAfter(null, -1);
  const tail = list.insertAfter(anchor, -2);
  const labels: OrderLabel[] = [];
  const count = 200_000;
  const start = performance.now();
  // Every insert lands right after the anchor, so the newest value is always second.
  for (let i = 0; i < count; i++) {
    labels.push(list.insertAfter(anchor, i));
  }
  // Delete every other label from the hot region, then insert again in the hole.
  for (let i = 0; i < count; i += 2) {
    list.delete(labels[i]);
  }
  for (let i = 0; i < count / 2; i++) {
    labels.push(list.insertAfter(anchor, count + i));
  }
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 2000, `concentrated inserts took ${elapsed.toFixed(1)} ms`);
  assert.equal(list.size, 2 + count / 2 + count / 2);
  assert.equal(list.validate(), true);

  const values = list.toArray();
  assert.equal(values[0], -1);
  assert.equal(values[1], count + count / 2 - 1);
  assert.equal(values[values.length - 1], -2);
  // Labels inserted later at the same anchor sort earlier; deleted labels throw.
  const live = labels.filter((_, i) => i >= count || i % 2 === 1);
  for (let i = 1; i < live.length; i++) {
    assert.ok(list.compare(live[i], live[i - 1]) < 0, `label ${i}`);
  }
  assert.ok(list.compare(anchor, live[live.length - 1]) < 0);
  assert.ok(list.compare(live[0], tail) < 0);
  assert.throws(() => list.compare(labels[0], anchor), ConsumedError);
});

test("OrderMaintenanceList compare matches a sequence model under random edits", () => {
  const list = new OrderMaintenanceList<number>();
  const model: OrderLabel[] = [];
  let state = 0x9e3779b9;
  const random = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
  for (let step = 0; step < 20_000; step++) {
    if (model.length > 0 && random() < 0.3) {
      const index = Math.floor(random() * model.length);
      list.delete(model[index]);
      model.splice(index, 1);
    } else {
      const index = Math.floor(random() * (model.length + 1));
      const after = index === 0 ? null : model[index - 1];
      model.splice(index, 0, list.insertAfter(after, step));
    }
    if (step % 1000 === 0) {
      assert.equal(list.validate(), true);
    }
  }
  assert.equal(list.validate(), true);
  assert.deepEqual(list.toArray(), model.map((label) => list.get(label)));
  for (let i = 0; i < 5000; i++) {
    const a = Math.floor(random() * model.length);
    const b = Math.floor(random() * model.length);
    assert.equal(Math.sign(list.compare(model[a], model[b])), Math.sign(a - b));
  }
});
