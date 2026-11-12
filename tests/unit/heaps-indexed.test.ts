import test from "node:test";
import assert from "node:assert/strict";
import { IndexedBinaryHeap } from "../../src/index.ts";
import { UnsupportedError } from "../../src/core/index.ts";

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test("IndexedBinaryHeap implements the indexed contract", () => {
  const heap = new IndexedBinaryHeap<number, string>((a, b) => a - b);
  assert.equal(heap.peek(), undefined);
  assert.equal(heap.pop(), undefined);
  assert.equal(heap.peekKey(), undefined);
  assert.equal(heap.insert(10, "ten"), true);
  assert.equal(heap.insert(10, "again"), false);
  assert.equal(heap.insert(5, "five"), true);
  assert.equal(heap.insert(20, "twenty"), true);
  assert.equal(heap.get(10), "ten");
  assert.equal(heap.has(20), true);
  assert.equal(heap.get(99), undefined);
  assert.equal(heap.has(99), false);
  assert.equal(heap.peekKey(), 5);
  assert.deepEqual(heap.peek(), [5, "five"]);
  assert.equal(heap.validate(), true);

  assert.equal(heap.update(10, "TEN"), true);
  assert.equal(heap.update(99, "missing"), false);
  assert.equal(heap.get(10), "TEN");
  assert.equal(heap.decreaseKey(10, 1), true);
  assert.equal(heap.peekKey(), 1);
  assert.equal(heap.decreaseKey(10, 1), false);
  assert.equal(heap.increaseKey(20, 30), true);
  assert.equal(heap.increaseKey(30, 2), false);
  assert.equal(heap.validate(), true);
  assert.deepEqual(heap.pop(), [1, "TEN"]);
  assert.equal(heap.delete(30), true);
  assert.equal(heap.delete(30), false);
  assert.equal(heap.validate(), true);
  assert.deepEqual(heap.pop(), [5, "five"]);
  assert.equal(heap.validate(), true);
  assert.throws(() => heap.insert(undefined as never, "x"), TypeError);
  assert.throws(() => heap.get(undefined as never), TypeError);
});

test("IndexedBinaryHeap rejects duplicate keys during key changes", () => {
  const heap = new IndexedBinaryHeap<number, number>();
  heap.build([
    [1, 1],
    [2, 2],
    [3, 3],
  ]);
  assert.equal(heap.decreaseKey(3, 1), false);
  assert.equal(heap.increaseKey(1, 3), false);
  assert.equal(heap.increaseKey(1, 4), true);
  assert.equal(heap.peekKey(), 2);
  assert.equal(heap.validate(), true);
  assert.throws(() => heap.build([
    [1, 1],
    [1, 2],
  ]), TypeError);
});

test("IndexedBinaryHeap build, height, merge, and serialization", () => {
  const heap = new IndexedBinaryHeap<number, string>();
  heap.build([
    [9, "nine"],
    [4, "four"],
    [7, "seven"],
    [1, "one"],
  ]);
  assert.equal(heap.size, 4);
  assert.equal(heap.height, 2);
  assert.equal(heap.peekKey(), 1);
  assert.equal(heap.validate(), true);
  assert.throws(() => heap.merge(), UnsupportedError);

  const restored = IndexedBinaryHeap.deserialize<number, string>(heap.serialize());
  assert.equal(restored.validate(), true);
  assert.equal(restored.size, 4);
  assert.equal(restored.get(4), "four");
  assert.deepEqual(restored.pop(), [1, "one"]);
  assert.equal(restored.validate(), true);

  const iterator = heap[Symbol.iterator]();
  iterator.next();
  heap.insert(0, "zero");
  assert.throws(() => iterator.next(), /modified/);
});

test("IndexedBinaryHeap matches a Map-backed reference over random operations", () => {
  const random = seeded(123);
  const heap = new IndexedBinaryHeap<number, number>((a, b) => a - b);
  const reference = new Map<number, number>();
  for (let step = 0; step < 700; step++) {
    const operation = random();
    const key = Math.floor(random() * 60);
    if (operation < 0.45) {
      const inserted = heap.insert(key, step);
      if (reference.has(key)) {
        assert.equal(inserted, false);
      } else {
        assert.equal(inserted, true);
        reference.set(key, step);
      }
    } else if (operation < 0.6) {
      assert.equal(heap.has(key), reference.has(key));
      assert.equal(heap.get(key), reference.get(key));
    } else if (operation < 0.72) {
      assert.equal(heap.delete(key), reference.delete(key));
    } else if (operation < 0.82) {
      const updated = heap.update(key, step);
      assert.equal(updated, reference.has(key));
      if (updated) {
        reference.set(key, step);
      }
    } else if (operation < 0.92) {
      const newKey = Math.max(0, key - Math.floor(random() * 30));
      const expected = reference.has(key) && !(newKey !== key && reference.has(newKey)) && newKey <= key;
      assert.equal(heap.decreaseKey(key, newKey), expected);
      if (expected) {
        const value = reference.get(key) as number;
        reference.delete(key);
        reference.set(newKey, value);
      }
    } else {
      const expectedKey = reference.size === 0 ? undefined : Math.min(...reference.keys());
      const popped = heap.pop();
      if (expectedKey === undefined) {
        assert.equal(popped, undefined);
      } else {
        assert.equal(popped?.[0], expectedKey);
        assert.equal(popped?.[1], reference.get(expectedKey));
        reference.delete(expectedKey);
      }
    }
    assert.equal(heap.size, reference.size);
    assert.equal(heap.validate(), true, `step ${step}`);
  }
  for (const key of [...reference.keys()].sort((a, b) => a - b)) {
    assert.deepEqual(heap.pop(), [key, reference.get(key)]);
  }
  assert.equal(heap.isEmpty(), true);
});
