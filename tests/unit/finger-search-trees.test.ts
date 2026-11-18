import test from "node:test";
import assert from "node:assert/strict";
import {
  ConcurrentModificationError,
  ConsumedError,
  FingerTreap,
  LevelLinkedTree,
  UnsupportedError,
} from "../../src/index.ts";
import type {
  Finger,
  FingerSearchMap,
} from "../../src/finger-search-trees/index.ts";

const asc = (a: number, b: number): number => a - b;

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

interface Variant {
  name: string;
  type: string;
  create(seed?: number): FingerSearchMap<number, string>;
  deserialize(json: unknown, seed?: number): FingerSearchMap<number, string>;
}

const variants: Variant[] = [
  {
    name: "LevelLinkedTree",
    type: "LevelLinkedTree",
    create: () => new LevelLinkedTree<number, string>(asc),
    deserialize: (json) => LevelLinkedTree.deserialize<number, string>(json, asc),
  },
  {
    name: "FingerTreap",
    type: "FingerTreap",
    create: (seed) => new FingerTreap<number, string>(asc, { rng: seed }),
    deserialize: (json, seed) =>
      FingerTreap.deserialize<number, string>(json, asc, { rng: seed }),
  },
];

function makeMap(variant: Variant, count = 120): FingerSearchMap<number, string> {
  const map = variant.create(0x51a7);
  for (let key = 0; key < count; key++) {
    map.set(key, `v${key}`);
  }
  return map;
}

function keysOf(map: FingerSearchMap<number, unknown>): number[] {
  return [...map.keys()];
}

function rangeKeys(iterator: IterableIterator<[number, string]>): number[] {
  return [...iterator].map((entry) => entry[0]);
}

for (const variant of variants) {
  test(`${variant.name} empty state and basic ordered-map operations`, () => {
    const map = variant.create(1);
    assert.equal(map.size, 0);
    assert.equal(map.isEmpty(), true);
    assert.equal(map.min(), undefined);
    assert.equal(map.max(), undefined);
    assert.equal(map.predecessor(1), undefined);
    assert.equal(map.successor(1), undefined);
    assert.equal(map.at(0), undefined);
    assert.equal(map.indexOf(1), -1);
    assert.equal(map.fingerAt(1), undefined);
    assert.deepEqual([...map.range()], []);
    assert.equal(map.validate(), true);

    map.set(5, "v5");
    assert.equal(map.size, 1);
    assert.deepEqual(map.min(), [5, "v5"]);
    assert.deepEqual(map.max(), [5, "v5"]);
    assert.equal(map.fingerAt(5)?.key, 5);
    assert.equal(map.validate(), true);
  });

  test(`${variant.name} maintains ordering, ranges, and order statistics`, () => {
    const map = makeMap(variant, 7);
    map.clear();
    for (const key of [5, 2, 8, 1, 9, 3, 7]) {
      map.set(key, `v${key}`);
    }
    assert.deepEqual(keysOf(map), [1, 2, 3, 5, 7, 8, 9]);
    assert.deepEqual(map.toArray(), [
      [1, "v1"],
      [2, "v2"],
      [3, "v3"],
      [5, "v5"],
      [7, "v7"],
      [8, "v8"],
      [9, "v9"],
    ]);
    assert.equal(map.get(5), "v5");
    assert.equal(map.get(4), undefined);
    assert.equal(map.has(9), true);
    assert.equal(map.has(4), false);
    assert.deepEqual(map.predecessor(5), [3, "v3"]);
    assert.deepEqual(map.successor(5), [7, "v7"]);
    assert.deepEqual(map.predecessor(4), [3, "v3"]);
    assert.deepEqual(map.successor(4), [5, "v5"]);
    assert.deepEqual(map.at(0), [1, "v1"]);
    assert.deepEqual(map.at(3), [5, "v5"]);
    assert.equal(map.at(-1), undefined);
    assert.equal(map.indexOf(5), 3);
    assert.equal(map.indexOf(4), -1);
    assert.deepEqual(rangeKeys(map.range()), [1, 2, 3, 5, 7, 8, 9]);
    assert.deepEqual(rangeKeys(map.range(3, 7)), [3, 5, 7]);
    assert.deepEqual(
      rangeKeys(map.range(3, 7, { lo: "exclusive", hi: "exclusive" })),
      [5],
    );
    assert.deepEqual(rangeKeys(map.range(7, 3)), []);
    assert.throws(() => map.range(1, 2, { lo: "bad" as never }), TypeError);
    assert.throws(() => map.at(0.5), TypeError);
    assert.equal(map.validate(), true);
  });

  test(`${variant.name} finger search, neighbour queries, and distance`, () => {
    const map = makeMap(variant);
    const finger = map.fingerAt(50);
    assert.notEqual(finger, undefined);
    assert.equal(finger?.key, 50);
    assert.deepEqual(map.findFrom(finger as Finger<number>, 53), [53, "v53"]);
    assert.deepEqual(map.findFrom(finger as Finger<number>, 47), [47, "v47"]);
    assert.deepEqual(map.findFrom(finger as Finger<number>, 0), [0, "v0"]);
    assert.deepEqual(map.findFrom(finger as Finger<number>, 119), [119, "v119"]);
    assert.equal(map.findFrom(finger as Finger<number>, 50.5), undefined);
    assert.equal(finger?.key, 50);
    assert.deepEqual(map.successorFrom(finger as Finger<number>), [51, "v51"]);
    assert.deepEqual(map.predecessorFrom(finger as Finger<number>), [49, "v49"]);
    assert.equal(map.fingerAt(0)?.key, 0);
    assert.equal(map.fingerAt(119)?.key, 119);

    const first = map.fingerAt(0) as Finger<number>;
    const last = map.fingerAt(119) as Finger<number>;
    assert.equal(map.predecessorFrom(first), undefined);
    assert.equal(map.successorFrom(last), undefined);
    assert.equal(map.distance(first, last), 119);
    assert.equal(map.distance(finger as Finger<number>, finger as Finger<number>), 0);
    assert.equal(map.distance(map.fingerAt(10) as Finger<number>, map.fingerAt(20) as Finger<number>), 10);
    assert.equal(map.validate(), true);
  });

  test(`${variant.name} insertAfter enforces its gap and moves the finger`, () => {
    const map = makeMap(variant, 12);
    const finger = map.fingerAt(5) as Finger<number>;
    const moved = map.insertAfter(finger, 5.5, "five-half");
    assert.equal(moved, finger);
    assert.equal(moved.key, 5.5);
    assert.equal(map.get(5.5), "five-half");
    assert.equal(map.size, 13);
    assert.deepEqual(map.successorFrom(moved), [6, "v6"]);
    assert.deepEqual(map.predecessorFrom(moved), [5, "v5"]);
    assert.deepEqual(map.findFrom(moved, 9), [9, "v9"]);
    assert.throws(() => map.insertAfter(moved, 5.5, "duplicate"), RangeError);
    assert.throws(() => map.insertAfter(moved, 6, "successor"), RangeError);
    assert.throws(() => map.insertAfter(moved, 5, "before"), RangeError);
    assert.equal(map.validate(), true);

    const last = map.fingerAt(11) as Finger<number>;
    const appended = map.insertAfter(last, 11.5, "last");
    assert.equal(appended.key, 11.5);
    assert.equal(map.successorFrom(appended), undefined);
    assert.equal(map.validate(), true);

    const missing = new LevelLinkedTree<number, string>(asc);
    missing.set(1, "a");
    const foreign = missing.fingerAt(1) as Finger<number>;
    assert.throws(() => map.findFrom(foreign, 2), TypeError);
    assert.throws(() => map.distance(foreign, moved), TypeError);
  });

  test(`${variant.name} fingers survive unrelated shifts and split boundaries`, () => {
    const map = variant.create(0x71a5);
    for (let key = 0; key < 200; key++) {
      map.set(key * 2, `v${key}`);
    }
    const finger = map.fingerAt(100) as Finger<number>;
    for (let key = 1; key < 100; key += 2) {
      map.set(key, `odd${key}`);
    }
    for (let key = 0; key < 20; key++) {
      map.delete(key * 2);
    }
    assert.equal(finger.key, 100);
    assert.deepEqual(map.findFrom(finger, 102), [102, "v51"]);
    assert.deepEqual(map.successorFrom(finger), [102, "v51"]);
    assert.equal(map.validate(), true);

    const inserted = map.insertAfter(finger, 100.5, "x");
    assert.equal(inserted.key, 100.5);
    assert.equal(map.get(100.5), "x");
    assert.equal(map.validate(), true);
  });

  test(`${variant.name} keeps co-located fingers valid across leaf splits and merges`, () => {
    const map = variant.create(0x9a71);
    for (let key = 0; key < 40; key++) {
      map.set(key, `v${key}`);
    }
    const before = map.fingerAt(0) as Finger<number>;
    const one = map.fingerAt(1) as Finger<number>;
    const two = map.fingerAt(2) as Finger<number>;
    map.insertAfter(before, 0.5, "x");
    assert.equal(before.key, 0.5);
    assert.equal(one.key, 1);
    assert.equal(two.key, 2);
    assert.deepEqual(map.findFrom(one, 2), [2, "v2"]);
    assert.equal(map.validate(), true);

    const guard = map.fingerAt(10) as Finger<number>;
    for (let key = 20; key < 40; key++) {
      map.delete(key);
      assert.equal(map.validate(), true, `delete ${key}`);
    }
    for (let key = 0; key < 10; key++) {
      map.delete(key);
      assert.equal(map.validate(), true, `delete ${key}`);
    }
    assert.equal(guard.key, 10);
    assert.deepEqual(map.findFrom(guard, 10), [10, "v10"]);
    assert.deepEqual(map.successorFrom(guard), [11, "v11"]);
    assert.deepEqual(map.predecessorFrom(guard), [0.5, "x"]);
    assert.equal(map.validate(), true);
  });

  test(`${variant.name} deleteAt and clear invalidate exactly the affected fingers`, () => {
    const map = makeMap(variant, 30);
    const finger = map.fingerAt(10) as Finger<number>;
    const neighbour = map.fingerAt(11) as Finger<number>;
    assert.equal(map.deleteAt(finger), true);
    assert.equal(map.size, 29);
    assert.equal(map.has(10), false);
    assert.equal(neighbour.key, 11);
    assert.deepEqual(map.findFrom(neighbour, 12), [12, "v12"]);
    assert.throws(() => finger.key, ConcurrentModificationError);
    assert.throws(() => map.deleteAt(finger), ConcurrentModificationError);
    assert.throws(() => map.successorFrom(finger), ConcurrentModificationError);
    assert.equal(map.validate(), true);

    const deleted = map.fingerAt(20) as Finger<number>;
    assert.equal(map.delete(20), true);
    assert.throws(() => deleted.key, ConcurrentModificationError);

    const cleared = map.fingerAt(21) as Finger<number>;
    map.clear();
    assert.throws(() => cleared.key, ConcurrentModificationError);
    assert.equal(map.size, 0);
    assert.equal(map.validate(), true);
  });

  test(`${variant.name} join and split consume their inputs`, () => {
    const left = variant.create(0x1234);
    const right = variant.create(0x5678);
    for (let key = 0; key < 20; key++) {
      left.set(key, `l${key}`);
    }
    for (let key = 20; key < 40; key++) {
      right.set(key, `r${key}`);
    }
    const leftFinger = left.fingerAt(10) as Finger<number>;
    const rightFinger = right.fingerAt(30) as Finger<number>;
    const joined = left.join(right) as FingerSearchMap<number, string>;
    assert.equal(joined.size, 40);
    assert.deepEqual(keysOf(joined), Array.from({ length: 40 }, (_, index) => index));
    assert.equal(joined.get(10), "l10");
    assert.equal(joined.get(30), "r30");
    assert.equal(joined.validate(), true);
    assert.throws(() => left.size, ConsumedError);
    assert.throws(() => right.size, ConsumedError);
    assert.throws(() => leftFinger.key, ConsumedError);
    assert.throws(() => joined.findFrom(leftFinger, 10), ConsumedError);
    assert.throws(() => joined.findFrom(rightFinger, 30), ConsumedError);

    const cut = joined.fingerAt(20) as Finger<number>;
    const [below, above] = joined.splitAt(cut);
    assert.deepEqual(keysOf(below), Array.from({ length: 20 }, (_, index) => index));
    assert.deepEqual(keysOf(above), Array.from({ length: 20 }, (_, index) => index + 20));
    assert.equal(below.validate(), true);
    assert.equal(above.validate(), true);
    assert.throws(() => joined.size, ConsumedError);
    assert.throws(() => cut.key, ConsumedError);
    assert.throws(() => below.findFrom(cut, 20), ConsumedError);

    const emptyLeft = variant.create(0x1);
    const only = variant.create(0x2);
    only.set(7, "seven");
    const merged = emptyLeft.join(only) as FingerSearchMap<number, string>;
    assert.deepEqual(keysOf(merged), [7]);
    assert.equal(merged.validate(), true);
    assert.throws(() => emptyLeft.size, ConsumedError);
    assert.throws(() => only.size, ConsumedError);

    const emptyRight = variant.create(0x3);
    const base = variant.create(0x4);
    base.set(7, "seven");
    const other = base.join(emptyRight) as FingerSearchMap<number, string>;
    assert.deepEqual(keysOf(other), [7]);
    assert.equal(other.validate(), true);
    assert.throws(() => base.size, ConsumedError);
    assert.throws(() => emptyRight.size, ConsumedError);
  });

  test(`${variant.name} join rejects invalid order, self-join, and foreign maps`, () => {
    const left = variant.create(1);
    const right = variant.create(2);
    for (const key of [1, 5, 10]) {
      left.set(key, `l${key}`);
    }
    for (const key of [5, 8, 12]) {
      right.set(key, `r${key}`);
    }
    assert.throws(() => left.join(right), TypeError);
    assert.equal(left.size, 3);
    assert.equal(right.size, 3);
    assert.equal(left.validate(), true);
    assert.equal(right.validate(), true);

    const single = variant.create(3);
    single.set(1, "a");
    assert.throws(() => single.join(single), TypeError);
    assert.equal(single.size, 1);

    const otherForeign =
      variant.name === "LevelLinkedTree"
        ? new FingerTreap<number, string>(asc)
        : new LevelLinkedTree<number, string>(asc);
    otherForeign.set(200, "y");
    assert.throws(() => single.join(otherForeign), UnsupportedError);
    assert.equal(single.size, 1);
    assert.equal(otherForeign.size, 1);
  });

  test(`${variant.name} splitAt partitions at every cut and join reassembles`, () => {
    const random = seeded(0x5f17);
    for (let round = 0; round < 40; round++) {
      const values = new Set<number>();
      while (values.size < 120) {
        values.add(Math.floor(random() * 2_000));
      }
      const sorted = [...values].sort(asc);
      const cutIndex = Math.floor(random() * sorted.length);
      const cutKey = sorted[cutIndex] as number;
      const map = variant.create(round);
      for (const key of sorted) {
        map.set(key, `v${key}`);
      }
      const finger = map.fingerAt(cutKey) as Finger<number>;
      const [left, right] = map.splitAt(finger);
      assert.equal(left.validate(), true, `left round ${round}`);
      assert.equal(right.validate(), true, `right round ${round}`);
      assert.deepEqual(keysOf(left), sorted.slice(0, cutIndex));
      assert.deepEqual(keysOf(right), sorted.slice(cutIndex));
      assert.equal(left.size + right.size, sorted.length);

      const rejoined = left.join(right) as FingerSearchMap<number, string>;
      assert.equal(rejoined.validate(), true, `join round ${round}`);
      assert.deepEqual(keysOf(rejoined), sorted);
      assert.equal(rejoined.size, sorted.length);
    }

    const first = variant.create(7);
    for (let key = 0; key < 10; key++) {
      first.set(key, `v${key}`);
    }
    const [empty, all] = first.splitAt(first.fingerAt(0) as Finger<number>);
    assert.equal(empty.size, 0);
    assert.deepEqual(keysOf(all), Array.from({ length: 10 }, (_, index) => index));
    assert.equal(empty.validate(), true);
    assert.equal(all.validate(), true);

    const last = variant.create(8);
    for (let key = 0; key < 10; key++) {
      last.set(key, `v${key}`);
    }
    const [prefix, tail] = last.splitAt(last.fingerAt(9) as Finger<number>);
    assert.deepEqual(keysOf(prefix), Array.from({ length: 9 }, (_, index) => index));
    assert.deepEqual(keysOf(tail), [9]);
    assert.equal(prefix.validate(), true);
    assert.equal(tail.validate(), true);
  });

  test(`${variant.name} serialization round-trips and rejects malformed payloads`, () => {
    const map = makeMap(variant, 40);
    const serialized = JSON.parse(map.serialize()) as {
      type: string;
      version: number;
      entries: Array<[number, string]>;
    };
    assert.equal(serialized.type, variant.type);
    assert.equal(serialized.version, 1);
    assert.deepEqual(serialized.entries, map.toArray());

    const restored = variant.deserialize(map.serialize(), 0x99);
    assert.equal(restored.validate(), true);
    assert.equal(restored.size, map.size);
    assert.deepEqual(restored.toArray(), map.toArray());
    assert.equal(restored.get(17), "v17");
    assert.equal(restored.fingerAt(17)?.key, 17);

    assert.throws(
      () => variant.deserialize({ type: "BinarySearchTree", version: 1, entries: [] }),
      TypeError,
    );
    assert.throws(
      () => variant.deserialize({ type: variant.type, version: 2, entries: [] }),
      TypeError,
    );
    assert.throws(
      () => variant.deserialize({ type: variant.type, version: 1, entries: [[1]] }),
      TypeError,
    );
    assert.throws(
      () => variant.deserialize({ type: variant.type, version: 1, entries: [[1, undefined]] }),
      TypeError,
    );
    if (variant.type === "LevelLinkedTree") {
      assert.throws(
        () =>
          variant.deserialize({
            type: variant.type,
            version: 1,
            entries: [
              [2, "b"],
              [1, "a"],
            ],
          }),
        TypeError,
      );
    }
    assert.throws(() => map.set(undefined as never, "x"), TypeError);
    assert.throws(() => map.set(1, undefined as never), TypeError);
  });

  test(`${variant.name} iterators are invalidated by mutation`, () => {
    const map = makeMap(variant, 10);
    const iterator = map.entries();
    assert.deepEqual(iterator.next(), { done: false, value: [0, "v0"] });
    map.set(20, "v20");
    assert.throws(() => iterator.next(), ConcurrentModificationError);

    const rangeIterator = map.range(0, 10);
    map.get(0);
    assert.equal(rangeIterator.next().done, false);
    map.delete(0);
    assert.throws(() => rangeIterator.next(), ConcurrentModificationError);
  });

  test(`${variant.name} matches a sorted reference over randomized operations`, () => {
    const random = seeded(0xf1e2);
    const map = variant.create(0xabc);
    const model = new Map<number, string>();
    const sortedKeys = (): number[] => [...model.keys()].sort(asc);

    for (let step = 0; step < 800; step++) {
      const key = Math.floor(random() * 160);
      const choice = random();
      if (choice < 0.4) {
        const value = `v${step}`;
        map.set(key, value);
        model.set(key, value);
      } else if (choice < 0.58) {
        assert.equal(map.delete(key), model.delete(key));
      } else if (choice < 0.7) {
        assert.equal(map.get(key), model.get(key));
        assert.equal(map.has(key), model.has(key));
      } else if (choice < 0.8) {
        const keys = sortedKeys();
        const index = Math.floor(random() * (keys.length + 2)) - 1;
        const expected = index >= 0 && index < keys.length ? keys[index] : undefined;
        assert.equal(map.at(index)?.[0], expected);
      } else if (choice < 0.9) {
        const keys = sortedKeys();
        assert.equal(map.indexOf(key), keys.indexOf(key));
        const below = keys.filter((item) => item < key).at(-1);
        const above = keys.find((item) => item > key);
        assert.deepEqual(
          map.predecessor(key),
          below === undefined ? undefined : [below, model.get(below)],
        );
        assert.deepEqual(
          map.successor(key),
          above === undefined ? undefined : [above, model.get(above)],
        );
      } else {
        const keys = sortedKeys();
        const lo = Math.floor(random() * 170) - 5;
        const hi = Math.floor(random() * 170) - 5;
        assert.deepEqual(
          rangeKeys(map.range(lo, hi)),
          keys.filter((item) => item >= lo && item <= hi),
        );
      }

      assert.equal(map.validate(), true, `step ${step}`);
      assert.equal(map.size, model.size);
      const keys = sortedKeys();
      assert.deepEqual(keysOf(map), keys);
      assert.deepEqual(
        map.toArray(),
        keys.map((item) => [item, model.get(item)]),
      );
    }
  });

  test(`${variant.name} randomized finger operations agree with the model`, () => {
    const random = seeded(0xf1a5);
    const map = variant.create(0xdef);
    const model = new Map<number, string>();
    const sortedKeys = (): number[] => [...model.keys()].sort(asc);

    for (let step = 0; step < 600; step++) {
      const keys = sortedKeys();
      if (keys.length < 8) {
        const key = Math.floor(random() * 400);
        map.set(key, `v${key}`);
        model.set(key, `v${key}`);
        continue;
      }
      const choice = random();
      if (choice < 0.24) {
        const key = Math.floor(random() * 400);
        const value = `v${step}`;
        map.set(key, value);
        model.set(key, value);
      } else if (choice < 0.36) {
        const key = keys[Math.floor(random() * keys.length)] as number;
        assert.equal(map.delete(key), model.delete(key));
      } else if (choice < 0.58) {
        const anchor = keys[Math.floor(random() * keys.length)] as number;
        const finger = map.fingerAt(anchor) as Finger<number>;
        assert.equal(finger.key, anchor);
        const target = Math.floor(random() * 420) - 10;
        assert.deepEqual(
          map.findFrom(finger, target),
          model.has(target) ? [target, model.get(target)] : undefined,
        );
        const other = keys[Math.floor(random() * keys.length)] as number;
        assert.equal(
          map.distance(finger, map.fingerAt(other) as Finger<number>),
          Math.abs(keys.indexOf(anchor) - keys.indexOf(other)),
        );
      } else if (choice < 0.74) {
        const index = Math.floor(random() * (keys.length - 1));
        const anchor = keys[index] as number;
        const successor = keys[index + 1] as number;
        const finger = map.fingerAt(anchor) as Finger<number>;
        if (successor - anchor > 0.0001) {
          const insertedKey = anchor + (successor - anchor) / 2;
          const moved = map.insertAfter(finger, insertedKey, `i${step}`);
          assert.equal(moved.key, insertedKey);
          model.set(insertedKey, `i${step}`);
          assert.deepEqual(map.successorFrom(moved), [
            successor,
            model.get(successor) as string,
          ]);
        }
      } else if (choice < 0.86) {
        const anchor = keys[Math.floor(random() * keys.length)] as number;
        const finger = map.fingerAt(anchor) as Finger<number>;
        assert.equal(map.deleteAt(finger), true);
        model.delete(anchor);
        assert.throws(() => finger.key, ConcurrentModificationError);
      } else {
        const index = Math.floor(random() * keys.length);
        const anchor = keys[index] as number;
        const finger = map.fingerAt(anchor) as Finger<number>;
        if (index + 1 < keys.length) {
          assert.deepEqual(map.successorFrom(finger), [
            keys[index + 1] as number,
            model.get(keys[index + 1] as number) as string,
          ]);
        } else {
          assert.equal(map.successorFrom(finger), undefined);
        }
        if (index > 0) {
          assert.deepEqual(map.predecessorFrom(finger), [
            keys[index - 1] as number,
            model.get(keys[index - 1] as number) as string,
          ]);
        } else {
          assert.equal(map.predecessorFrom(finger), undefined);
        }
      }

      assert.equal(map.validate(), true, `step ${step}`);
      assert.equal(map.size, model.size);
      const expectedKeys = sortedKeys();
      assert.deepEqual(keysOf(map), expectedKeys);
      assert.deepEqual(
        map.toArray(),
        expectedKeys.map((item) => [item, model.get(item)]),
      );
    }
  });

  test(`${variant.name} survives bulk insert/delete cycles with valid invariants`, () => {
    const random = seeded(0x1eaf);
    const map = variant.create(0x5eed);
    for (let key = 0; key < 1_500; key++) {
      map.set(key, `v${key}`);
    }
    assert.equal(map.validate(), true);
    const removal = Array.from({ length: 1_500 }, (_, index) => index);
    for (let index = removal.length - 1; index > 0; index--) {
      const swap = Math.floor(random() * (index + 1));
      [removal[index], removal[swap]] = [removal[swap] as number, removal[index] as number];
    }
    for (let index = 0; index < removal.length; index++) {
      assert.equal(map.delete(removal[index] as number), true);
      if (index % 37 === 0) {
        assert.equal(map.validate(), true, `delete ${index}`);
      }
    }
    assert.equal(map.size, 0);
    assert.equal(map.validate(), true);
  });
}

test("level-linked and treap implementations agree on ordered-map behavior", () => {
  const random = seeded(0xc0a1);
  const level = new LevelLinkedTree<number, number>(asc);
  const treap = new FingerTreap<number, number>(asc, { rng: 0x7ea9 });
  for (let step = 0; step < 1_200; step++) {
    const key = Math.floor(random() * 140);
    const choice = random();
    if (choice < 0.45) {
      level.set(key, step);
      treap.set(key, step);
    } else if (choice < 0.7) {
      assert.equal(level.delete(key), treap.delete(key));
    } else {
      assert.equal(level.get(key), treap.get(key));
      assert.equal(level.has(key), treap.has(key));
    }
    assert.equal(level.validate(), true, `level step ${step}`);
    assert.equal(treap.validate(), true, `treap step ${step}`);
    assert.deepEqual(keysOf(level), keysOf(treap));
    assert.equal(level.size, treap.size);
  }
});

test("finding from a finger visits fewer comparisons than a full search", () => {
  for (const variant of variants) {
    let callCount = 0;
    const counting = (a: number, b: number): number => {
      callCount++;
      return a - b;
    };
    const map =
      variant.name === "LevelLinkedTree"
        ? new LevelLinkedTree<number, number>(counting)
        : new FingerTreap<number, number>(counting, { rng: 0x1234 });
    const count = 8_192;
    for (let key = 0; key < count; key++) {
      map.set(key, key);
    }
    const finger = map.fingerAt(count / 2) as Finger<number>;

    callCount = 0;
    for (let round = 0; round < 200; round++) {
      map.findFrom(finger, count / 2 + 1);
    }
    const near = callCount / 200;

    callCount = 0;
    for (let round = 0; round < 200; round++) {
      map.get(Math.floor((round * 7919) % count));
    }
    const full = callCount / 200;

    assert.deepEqual(
      map.findFrom(finger, count / 2 + 1),
      [count / 2 + 1, count / 2 + 1],
    );
    assert.ok(
      near < full,
      `${variant.name}: near average ${near} should be below full average ${full}`,
    );
    assert.equal(map.validate(), true);
  }
});

test("LevelLinkedTree splitAt cuts at every rank for many shapes and join reassembles", () => {
  for (let count = 1; count <= 70; count++) {
    for (let shape = 0; shape < 3; shape++) {
      for (let cut = 0; cut < count; cut++) {
        const map = new LevelLinkedTree<number, string>(asc);
        const keys = Array.from({ length: count }, (_, index) => index);
        const order = shape === 1 ? [...keys].reverse() : keys;
        for (const key of order) {
          map.set(key, `v${key}`);
        }
        if (shape === 2) {
          for (const key of keys.filter((key) => key % 3 === 1)) {
            map.delete(key);
          }
          for (const key of keys.filter((key) => key % 3 === 1)) {
            map.set(key, `v${key}`);
          }
        }
        const [left, right] = map.splitAt(map.fingerAt(cut) as Finger<number>);
        const label = `count ${count} shape ${shape} cut ${cut}`;
        assert.equal(left.validate(), true, `left ${label}`);
        assert.equal(right.validate(), true, `right ${label}`);
        assert.deepEqual(keysOf(left), keys.slice(0, cut), label);
        assert.deepEqual(keysOf(right), keys.slice(cut), label);
        assert.equal(right.indexOf(count - 1), count - 1 - cut, label);
        const joined = left.join(right) as FingerSearchMap<number, string>;
        assert.equal(joined.validate(), true, `join ${label}`);
        assert.equal(joined.size, count);
        assert.equal(joined.indexOf(count - 1), count - 1, label);
      }
    }
  }
});

test("LevelLinkedTree joins trees of very different heights and links the seam", () => {
  for (const [low, high] of [[1, 3_000], [3_000, 1], [5, 20_000], [20_000, 5], [700, 700]]) {
    const left = new LevelLinkedTree<number, string>(asc);
    const right = new LevelLinkedTree<number, string>(asc);
    for (let key = 0; key < (low as number); key++) {
      left.set(key, `v${key}`);
    }
    for (let key = 0; key < (high as number); key++) {
      right.set((low as number) + key, `v${key}`);
    }
    const joined = left.join(right) as FingerSearchMap<number, string>;
    assert.equal(joined.validate(), true, `${low}+${high}`);
    assert.equal(joined.size, (low as number) + (high as number));
    const seam = joined.fingerAt(low as number) as Finger<number>;
    assert.equal(joined.predecessorFrom(seam)?.[0], (low as number) - 1);
    assert.equal(joined.findFrom(seam, (low as number) - 1)?.[0], (low as number) - 1);
  }
});

test("LevelLinkedTree join and splitAt are structural, not O(n) rebuilds", () => {
  let callCount = 0;
  const counting = (a: number, b: number): number => {
    callCount++;
    return a - b;
  };
  const count = 50_000;
  const map = new LevelLinkedTree<number, number>(counting);
  for (let key = 0; key < count; key++) {
    map.set(key, key);
  }
  callCount = 0;
  const [left, right] = map.splitAt(map.fingerAt(Math.floor(count / 3)) as Finger<number>);
  const splitCalls = callCount;
  callCount = 0;
  const joined = left.join(right);
  const joinCalls = callCount;
  // fingerAt is a root descent; a rebuild would compare every adjacent pair.
  assert.ok(splitCalls < 64, `splitAt made ${splitCalls} comparisons`);
  assert.ok(joinCalls < 8, `join made ${joinCalls} comparisons`);
  assert.equal(joined.validate(), true);
  assert.equal(joined.size, count);
});

for (const name of ["LevelLinkedTree", "FingerTreap"]) {
  test(`${name} findFrom past either edge is O(1) from an edge finger`, () => {
    const costs: number[] = [];
    for (const count of [1_000, 100_000]) {
      let callCount = 0;
      const counting = (a: number, b: number): number => {
        callCount++;
        return a - b;
      };
      const map: FingerSearchMap<number, number> =
        name === "LevelLinkedTree"
          ? new LevelLinkedTree<number, number>(counting)
          : new FingerTreap<number, number>(counting, { rng: 0x2468 });
      for (let key = 0; key < count; key++) {
        map.set(key, key);
      }
      const high = map.fingerAt(count - 1) as Finger<number>;
      const low = map.fingerAt(0) as Finger<number>;
      callCount = 0;
      assert.equal(map.findFrom(high, count + 5), undefined);
      assert.equal(map.findFrom(low, -5), undefined);
      costs.push(callCount);
      assert.deepEqual(map.findFrom(high, count - 2), [count - 2, count - 2]);
      assert.deepEqual(map.findFrom(low, 1), [1, 1]);
    }
    assert.ok(costs.every((cost) => cost <= 4), `${name} edge costs ${costs.join(", ")}`);
  });
}
