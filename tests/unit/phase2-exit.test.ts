import test from "node:test";
import assert from "node:assert/strict";
import {
  CoalescedHashing,
  CuckooHashing,
  DoubleHashing,
  ExtendibleHashing,
  LinearProbing,
  OrderedHashMap,
  QuadraticProbing,
  RobinHood,
  SeparateChaining,
  UnionFind,
  UniversalHashing,
} from "../../src/index.ts";
import type { HashMapLike, HashOptions } from "../../src/hash-tables/types.ts";

interface SweepFactory {
  name: string;
  create(options: HashOptions<string>): HashMapLike<string, number>;
}

const sweepFactories: SweepFactory[] = [
  {
    name: "SeparateChaining",
    create: (options) => new SeparateChaining<string, number>(options),
  },
  {
    name: "OrderedHashMap",
    create: (options) => new OrderedHashMap<string, number>(options),
  },
  {
    name: "LinearProbing",
    create: (options) => new LinearProbing<string, number>(options),
  },
  {
    name: "QuadraticProbing",
    create: (options) => new QuadraticProbing<string, number>(options),
  },
  {
    name: "DoubleHashing",
    create: (options) => new DoubleHashing<string, number>(options),
  },
  {
    name: "CoalescedHashing",
    create: (options) => new CoalescedHashing<string, number>(options),
  },
  {
    name: "RobinHood",
    create: (options) => new RobinHood<string, number>(options),
  },
  {
    name: "CuckooHashing",
    create: (options) => new CuckooHashing<string, number>(options),
  },
  {
    name: "UniversalHashing",
    create: (options) => new UniversalHashing<string, number>(options),
  },
  {
    name: "ExtendibleHashing",
    create: (options) => new ExtendibleHashing<string, number>(options),
  },
];

test("phase 2 load-factor sweeps preserve correctness", () => {
  const loadFactors = [0.25, 0.5, 0.75, 0.9];
  const entryCount = 400;
  for (const factory of sweepFactories) {
    for (const loadFactor of loadFactors) {
      const map = factory.create({ capacity: 32, loadFactor });
      const start = performance.now();
      for (let key = 0; key < entryCount; key++) {
        map.set(`k${key}`, key);
      }
      for (let key = 0; key < entryCount; key++) {
        assert.equal(map.get(`k${key}`), key, `${factory.name}@${loadFactor}`);
      }
      for (let key = 0; key < entryCount; key += 2) {
        assert.equal(map.delete(`k${key}`), true);
      }
      for (let key = 0; key < entryCount; key++) {
        assert.equal(
          map.get(`k${key}`),
          key % 2 === 0 ? undefined : key,
          `${factory.name}@${loadFactor}`,
        );
      }
      assert.equal(map.validate(), true);
      const elapsed = performance.now() - start;
      assert.ok(
        elapsed < 5000,
        `${factory.name}@${loadFactor} took ${elapsed.toFixed(1)} ms`,
      );
    }
  }
});

test("phase 2 adversarial constant-hash keys remain correct", () => {
  const entryCount = 1000;
  for (const factory of sweepFactories) {
    const map = factory.create({ capacity: 16, hash: () => 0 });
    const start = performance.now();
    for (let key = 0; key < entryCount; key++) {
      map.set(`k${key}`, key);
    }
    for (let key = 0; key < entryCount; key++) {
      assert.equal(map.get(`k${key}`), key, factory.name);
    }
    assert.equal(map.validate(), true, factory.name);
    for (let key = 0; key < entryCount; key += 3) {
      assert.equal(map.delete(`k${key}`), true, factory.name);
    }
    assert.equal(map.validate(), true, factory.name);
    const elapsed = performance.now() - start;
    assert.ok(
      elapsed < 5000,
      `${factory.name} adversarial run took ${elapsed.toFixed(1)} ms`,
    );
  }
});

test("phase 2 union-find meets inverse-Ackermann expectations in practice", () => {
  const count = 50000;
  const forest = new UnionFind<number>();
  for (let value = 0; value < count; value++) {
    forest.makeSet(value);
  }
  const start = performance.now();
  for (let value = 1; value < count; value++) {
    forest.union(value - 1, value);
  }
  for (let value = 0; value < count; value++) {
    forest.find(value);
  }
  const elapsed = performance.now() - start;
  assert.equal(forest.setCount, 1);
  assert.ok(
    elapsed < 5000,
    `union-find sequence took ${elapsed.toFixed(1)} ms`,
  );
  const nodes = (forest as unknown as {
    _nodes: Map<number, { parent: number }>;
  })._nodes;
  let maxDepth = 0;
  for (const value of nodes.keys()) {
    let depth = 0;
    let current = value;
    while (nodes.get(current)!.parent !== current) {
      current = nodes.get(current)!.parent;
      depth++;
      if (depth > 4) {
        break;
      }
    }
    maxDepth = Math.max(maxDepth, depth);
  }
  assert.ok(maxDepth <= 2, `max depth ${maxDepth} after compression`);
  assert.equal(forest.validate(), true);
});
