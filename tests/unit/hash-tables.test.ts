import test from "node:test";
import assert from "node:assert/strict";
import {
  CoalescedHashing,
  CuckooHashing,
  DoubleHashing,
  ExtendibleHashing,
  HashMap,
  HashSet,
  LinearProbing,
  OrderedHashMap,
  PerfectHashing,
  QuadraticProbing,
  RobinHood,
  SeparateChaining,
  UniversalHashing,
} from "../../src/index.ts";
import type { HashMapLike, HashOptions } from "../../src/hash-tables/types.ts";
import { ConcurrentModificationError } from "../../src/core/index.ts";

interface MapFactory {
  name: string;
  create(options?: HashOptions<string>): HashMapLike<string, number>;
  deserialize(
    json: unknown,
    options?: HashOptions<string>,
  ): HashMapLike<string, number>;
}

const mapFactories: MapFactory[] = [
  {
    name: "SeparateChaining",
    create: (options) => new SeparateChaining<string, number>(options),
    deserialize: (json, options) =>
      SeparateChaining.deserialize<string, number>(json, options),
  },
  {
    name: "HashMap",
    create: (options) => new HashMap<string, number>(options),
    deserialize: (json, options) =>
      HashMap.deserialize<string, number>(json, options),
  },
  {
    name: "OrderedHashMap",
    create: (options) => new OrderedHashMap<string, number>(options),
    deserialize: (json, options) =>
      OrderedHashMap.deserialize<string, number>(json, options),
  },
  {
    name: "LinearProbing",
    create: (options) => new LinearProbing<string, number>(options),
    deserialize: (json, options) =>
      LinearProbing.deserialize<string, number>(json, options),
  },
  {
    name: "QuadraticProbing",
    create: (options) => new QuadraticProbing<string, number>(options),
    deserialize: (json, options) =>
      QuadraticProbing.deserialize<string, number>(json, options),
  },
  {
    name: "DoubleHashing",
    create: (options) => new DoubleHashing<string, number>(options),
    deserialize: (json, options) =>
      DoubleHashing.deserialize<string, number>(json, options),
  },
  {
    name: "CoalescedHashing",
    create: (options) => new CoalescedHashing<string, number>(options),
    deserialize: (json, options) =>
      CoalescedHashing.deserialize<string, number>(json, options),
  },
  {
    name: "RobinHood",
    create: (options) => new RobinHood<string, number>(options),
    deserialize: (json, options) =>
      RobinHood.deserialize<string, number>(json, options),
  },
  {
    name: "CuckooHashing",
    create: (options) => new CuckooHashing<string, number>(options),
    deserialize: (json, options) =>
      CuckooHashing.deserialize<string, number>(json, options),
  },
  {
    name: "UniversalHashing",
    create: (options) => new UniversalHashing<string, number>(options),
    deserialize: (json, options) =>
      UniversalHashing.deserialize<string, number>(json, options),
  },
  {
    name: "ExtendibleHashing",
    create: (options) => new ExtendibleHashing<string, number>(options),
    deserialize: (json, options) =>
      ExtendibleHashing.deserialize<string, number>(json, options),
  },
];

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

for (const factory of mapFactories) {
  test(`${factory.name} implements the map contract`, () => {
    const map = factory.create({ capacity: 8 });
    assert.equal(map.size, 0);
    assert.equal(map.isEmpty(), true);
    assert.deepEqual(map.toArray(), []);
    assert.equal(map.get("missing"), undefined);
    assert.equal(map.has("missing"), false);
    assert.equal(map.delete("missing"), false);
    assert.equal(map.validate(), true);

    map.set("a", 1);
    map.set("b", 2);
    assert.equal(map.size, 2);
    assert.equal(map.get("a"), 1);
    assert.equal(map.has("b"), true);
    assert.equal(map.set("a", 3), map);
    assert.equal(map.get("a"), 3);
    assert.equal(map.size, 2);
    assert.equal(map.delete("a"), true);
    assert.equal(map.delete("a"), false);
    assert.equal(map.size, 1);
    assert.equal(map.validate(), true);

    assert.throws(() => map.set(undefined as never, 1), TypeError);
    assert.throws(() => map.set("x", undefined as never), TypeError);

    map.set("c", 4);
    const keys = [...map.keys()];
    const values = [...map.values()];
    const entries = [...map.entries()];
    assert.deepEqual(entries, map.toArray());
    assert.deepEqual(keys, entries.map(([key]) => key));
    assert.deepEqual(values, entries.map(([, value]) => value));
    assert.deepEqual([...map], entries);

    map.reserve(100);
    assert.equal(map.validate(), true);
    map.set("d", 5);
    assert.equal(map.get("d"), 5);
    map.clear();
    assert.equal(map.size, 0);
    assert.deepEqual(map.toArray(), []);
    assert.equal(map.validate(), true);
  });

  test(`${factory.name} matches a reference Map`, () => {
    const random = seeded(0x1234abcd);
    const map = factory.create({ capacity: 8 });
    const reference = new Map<string, number>();
    for (let step = 0; step < 300; step++) {
      const key = `k${Math.floor(random() * 60)}`;
      const operation = random();
      if (operation < 0.5) {
        map.set(key, step);
        reference.set(key, step);
      } else if (operation < 0.65) {
        assert.equal(map.get(key), reference.get(key));
      } else if (operation < 0.75) {
        assert.equal(map.has(key), reference.has(key));
      } else if (operation < 0.95) {
        assert.equal(map.delete(key), reference.delete(key));
      } else {
        map.reserve(20 + Math.floor(random() * 60));
      }
      assert.equal(map.size, reference.size);
      assert.equal(map.validate(), true);
    }
    for (let key = 0; key < 80; key++) {
      assert.equal(map.get(`k${key}`), reference.get(`k${key}`));
    }
    assert.deepEqual(
      new Map(map.toArray()),
      reference,
    );
  });

  test(`${factory.name} survives constant-hash key collisions`, () => {
    const map = factory.create({ capacity: 8, hash: () => 0 });
    for (let key = 0; key < 120; key++) {
      map.set(`k${key}`, key);
    }
    assert.equal(map.size, 120);
    assert.equal(map.validate(), true);
    for (let key = 0; key < 120; key++) {
      assert.equal(map.get(`k${key}`), key);
    }
    for (let key = 0; key < 120; key += 2) {
      assert.equal(map.delete(`k${key}`), true);
    }
    assert.equal(map.size, 60);
    assert.equal(map.validate(), true);
    for (let key = 0; key < 120; key++) {
      assert.equal(map.get(`k${key}`), key % 2 === 0 ? undefined : key);
    }
    for (let key = 0; key < 30; key++) {
      map.set(`n${key}`, -key);
    }
    assert.equal(map.size, 90);
    assert.equal(map.validate(), true);
  });

  test(`${factory.name} serializes in iteration order`, () => {
    const map = factory.create({ capacity: 8 });
    for (let key = 0; key < 80; key++) {
      map.set(`k${key}`, key);
    }
    for (let key = 0; key < 20; key++) {
      map.delete(`k${key}`);
    }
    for (let key = 80; key < 110; key++) {
      map.set(`k${key}`, key);
    }
    const json = map.serialize();
    const restored = factory.deserialize(json);
    assert.equal(restored.size, map.size);
    assert.deepEqual(restored.toArray(), map.toArray());
    assert.deepEqual([...restored.keys()], [...map.keys()]);
    assert.equal(restored.validate(), true);
    const fromObject = factory.deserialize(JSON.parse(json));
    assert.deepEqual(fromObject.toArray(), map.toArray());

    const empty = factory.create();
    const restoredEmpty = factory.deserialize(empty.serialize());
    assert.equal(restoredEmpty.size, 0);
    assert.equal(restoredEmpty.validate(), true);

    assert.throws(() => factory.deserialize("not json"), TypeError);
    assert.throws(() => factory.deserialize({ type: "Nope", version: 1 }), TypeError);
  });

  test(`${factory.name} rejects malformed payloads`, () => {
    assert.throws(
      () =>
        factory.deserialize({
          type: factory.name,
          version: 1,
          capacity: 8,
          loadFactor: 0.75,
          entries: [[1]],
        }),
      TypeError,
    );
    assert.throws(
      () =>
        factory.deserialize({
          type: factory.name,
          version: 1,
          capacity: 8,
          loadFactor: 0.75,
          entries: [["a", undefined]],
        }),
      TypeError,
    );
    assert.throws(
      () =>
        factory.deserialize({
          type: factory.name,
          version: 2,
          capacity: 8,
          loadFactor: 0.75,
          entries: [],
        }),
      TypeError,
    );
  });

  test(`${factory.name} invalidates live iterators on mutation`, () => {
    const map = factory.create();
    map.set("a", 1);
    map.set("b", 2);
    const iterator = map[Symbol.iterator]();
    iterator.next();
    map.set("c", 3);
    assert.throws(() => iterator.next(), ConcurrentModificationError);
  });
}

test("OrderedHashMap preserves insertion order across updates and deletion", () => {
  const map = new OrderedHashMap<string, number>();
  for (const key of ["c", "a", "b", "d"]) {
    map.set(key, key.charCodeAt(0));
  }
  map.set("a", 100);
  assert.deepEqual([...map.keys()], ["c", "a", "b", "d"]);
  map.delete("a");
  map.set("e", 1);
  assert.deepEqual([...map.keys()], ["c", "b", "d", "e"]);
  const restored = OrderedHashMap.deserialize<string, number>(map.serialize());
  assert.deepEqual(restored.toArray(), map.toArray());
  assert.equal(restored.validate(), true);
});

test("hash functions are not serialized", () => {
  interface Key {
    id: number;
  }
  const options: HashOptions<Key> = {
    hash: (key) => key.id,
    equals: (a, b) => a.id === b.id,
  };
  const map = new SeparateChaining<Key, string>(options);
  map.set({ id: 1 }, "one");
  map.set({ id: 2 }, "two");
  const restored = SeparateChaining.deserialize<Key, string>(
    map.serialize(),
    options,
  );
  assert.equal(restored.size, 2);
  assert.equal(restored.get({ id: 1 }), "one");
  assert.equal(restored.get({ id: 2 }), "two");
  assert.equal(restored.validate(), true);
});

test("hash table constructors reject invalid options", () => {
  assert.throws(() => new SeparateChaining({ capacity: 0 }), TypeError);
  assert.throws(() => new SeparateChaining({ capacity: 1.5 }), TypeError);
  assert.throws(() => new SeparateChaining({ loadFactor: 0 }), TypeError);
  assert.throws(() => new LinearProbing({ loadFactor: 1 }), RangeError);
  assert.throws(() => new DoubleHashing({ loadFactor: 2 }), RangeError);
  const badHash = new SeparateChaining<string, number>({
    hash: () => Number.NaN,
  });
  assert.throws(() => badHash.set("a", 1), TypeError);
  assert.throws(
    () => new SeparateChaining({ equals: "nope" as never }),
    TypeError,
  );
});

test("PerfectHashing supports exact static lookup", () => {
  const entries: Array<[string, number]> = [];
  for (let index = 0; index < 200; index++) {
    entries.push([`k${index}`, index]);
  }
  const table = PerfectHashing.build(entries);
  assert.equal(table.size, 200);
  assert.equal(table.validate(), true);
  for (let index = 0; index < 200; index++) {
    assert.equal(table.get(`k${index}`), index);
    assert.equal(table.has(`k${index}`), true);
  }
  assert.equal(table.get("missing"), undefined);
  assert.equal(table.has("missing"), false);
  assert.deepEqual([...table.entries()], table.toArray());

  const duplicate = PerfectHashing.build<string, number>([
    ["a", 1],
    ["a", 2],
    ["b", 3],
  ]);
  assert.equal(duplicate.size, 2);
  assert.equal(duplicate.get("a"), 2);
  assert.equal(duplicate.validate(), true);

  const restored = PerfectHashing.deserialize<string, number>(table.serialize());
  assert.deepEqual(restored.toArray(), table.toArray());
  assert.equal(restored.validate(), true);

  const empty = PerfectHashing.build<string, number>([]);
  assert.equal(empty.size, 0);
  assert.equal(empty.validate(), true);
  assert.equal(empty.get("x"), undefined);

  const constant = PerfectHashing.build<string, number>(
    entries,
    { hash: () => 0 },
  );
  assert.equal(constant.size, 200);
  for (let index = 0; index < 200; index++) {
    assert.equal(constant.get(`k${index}`), index);
  }
  assert.equal(constant.validate(), true);

  const cleared = PerfectHashing.build(entries);
  cleared.clear();
  assert.equal(cleared.size, 0);
  assert.deepEqual(cleared.toArray(), []);
  assert.equal(cleared.validate(), true);

  assert.throws(
    () =>
      PerfectHashing.deserialize({
        type: "PerfectHashing",
        version: 1,
        seed: 1,
        entries: [[1]],
      }),
    TypeError,
  );
  assert.throws(() => PerfectHashing.deserialize("not json"), TypeError);
});

test("HashSet implements the set contract and algebra", () => {
  const set = new HashSet<string>();
  assert.equal(set.add("a"), true);
  assert.equal(set.add("a"), false);
  assert.equal(set.add("b"), true);
  assert.equal(set.size, 2);
  assert.equal(set.has("a"), true);
  assert.equal(set.delete("a"), true);
  assert.equal(set.delete("a"), false);
  assert.equal(set.has("a"), false);
  assert.equal(set.validate(), true);
  assert.deepEqual([...set.values()], [...set]);
  assert.throws(() => set.add(undefined as never), TypeError);

  const other = new HashSet<string>();
  for (const value of ["b", "c", "c"]) {
    other.add(value);
  }
  assert.deepEqual(new Set(set.union(other)), new Set(["b", "c"]));
  assert.deepEqual(new Set(set.intersection(other)), new Set(["b"]));
  assert.deepEqual(new Set(set.difference(other)), new Set());
  assert.deepEqual(new Set(set.symmetricDifference(other)), new Set(["c"]));
  assert.equal(set.isSubsetOf(["b", "c"]), true);
  assert.equal(set.isSupersetOf(["b"]), true);
  assert.equal(set.equals(["b"]), true);
  assert.equal(set.equals(["b", "c"]), false);

  const restored = HashSet.deserialize<string>(set.serialize());
  assert.deepEqual(restored.toArray(), set.toArray());
  assert.equal(restored.validate(), true);
  assert.throws(
    () => HashSet.deserialize({ type: "HashSet", version: 1, values: [undefined] }),
    TypeError,
  );
});

test("HashSet supports custom equality and random operations", () => {
  const random = seeded(99);
  const set = new HashSet<string>({
    hash: (value) => value.length,
    equals: (a, b) => a.toLowerCase() === b.toLowerCase(),
  });
  const reference = new Set<string>();
  for (let step = 0; step < 400; step++) {
    const value = `v${Math.floor(random() * 60)}`;
    const operation = random();
    if (operation < 0.5) {
      const expected = !reference.has(value.toLowerCase());
      assert.equal(set.add(value), expected);
      reference.add(value.toLowerCase());
    } else if (operation < 0.7) {
      assert.equal(set.has(value), reference.has(value.toLowerCase()));
    } else {
      const lower = value.toLowerCase();
      const expected = reference.delete(lower);
      assert.equal(set.delete(value), expected);
    }
    assert.equal(set.size, reference.size);
    assert.equal(set.validate(), true);
  }
  const restored = HashSet.deserialize<string>(
    set.serialize(),
    {
      hash: (value) => value.length,
      equals: (a, b) => a.toLowerCase() === b.toLowerCase(),
    },
  );
  assert.equal(restored.size, set.size);
  for (const value of set) {
    assert.equal(restored.has(value), true);
  }
});

test("OrderedHashMap keeps insertion order through heavy deletion and compaction", () => {
  const map = new OrderedHashMap<number, number>();
  const count = 20000;
  for (let key = 0; key < count; key++) {
    map.set(key, key * 2);
  }
  const start = performance.now();
  for (let key = 0; key < count; key++) {
    if (key % 3 !== 0) {
      assert.equal(map.delete(key), true);
    }
  }
  assert.equal(map.delete(1), false);
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 1000, `ordered deletes took ${elapsed.toFixed(1)} ms`);
  assert.equal(map.validate(), true);
  const expected: number[] = [];
  for (let key = 0; key < count; key += 3) {
    expected.push(key);
  }
  assert.deepEqual([...map.keys()], expected);
  // Re-inserting a deleted key appends it; updating a live key keeps its slot.
  map.set(1, -1);
  map.set(0, -2);
  const keys = [...map.keys()];
  assert.equal(keys[0], 0);
  assert.equal(keys[keys.length - 1], 1);
  assert.equal(map.get(0), -2);
  assert.equal(map.validate(), true);
  const restored = OrderedHashMap.deserialize<number, number>(map.serialize());
  assert.deepEqual([...restored.keys()], keys);
  map.clear();
  assert.equal(map.size, 0);
  assert.deepEqual([...map.keys()], []);
  map.set(5, 5);
  assert.deepEqual([...map.entries()], [[5, 5]]);
  assert.equal(map.validate(), true);
});
