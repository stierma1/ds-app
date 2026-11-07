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
} from "../src/index.ts";
import type { HashMapLike, HashOptions } from "../src/hash-tables/types.ts";

interface Factory {
  name: string;
  create(options: HashOptions<string>): HashMapLike<string, number>;
}

const factories: Factory[] = [
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

const entryCount = 2000;
const loadFactors = [0.25, 0.5, 0.75, 0.9];
const rows: Array<Record<string, string | number>> = [];

for (const factory of factories) {
  for (const loadFactor of loadFactors) {
    const map = factory.create({ capacity: 64, loadFactor });
    const insertStart = performance.now();
    for (let key = 0; key < entryCount; key++) {
      map.set(`k${key}`, key);
    }
    const insertMs = performance.now() - insertStart;

    const getStart = performance.now();
    for (let round = 0; round < 3; round++) {
      for (let key = 0; key < entryCount; key++) {
        if (map.get(`k${key}`) !== key) {
          throw new Error(`${factory.name} returned the wrong value`);
        }
      }
    }
    const getMs = performance.now() - getStart;

    const deleteStart = performance.now();
    for (let key = 0; key < entryCount; key++) {
      map.delete(`k${key}`);
    }
    const deleteMs = performance.now() - deleteStart;

    if (map.size !== 0 || map.validate() !== true) {
      throw new Error(`${factory.name} failed its invariant check`);
    }

    rows.push({
      structure: factory.name,
      loadFactor,
      "insert ops/s": Math.round(entryCount / (insertMs / 1000)),
      "get ops/s": Math.round((entryCount * 3) / (getMs / 1000)),
      "delete ops/s": Math.round(entryCount / (deleteMs / 1000)),
    });
  }
}

const unionFind = new UnionFind<number>();
const unionSize = 100000;
const unionStart = performance.now();
for (let value = 0; value < unionSize; value++) {
  unionFind.makeSet(value);
}
for (let value = 1; value < unionSize; value++) {
  unionFind.union(value - 1, value);
}
for (let value = 0; value < unionSize; value++) {
  unionFind.find(value);
}
const unionMs = performance.now() - unionStart;

console.log("Phase 2 load-factor sweep");
console.table(rows);
console.log(
  `UnionFind: ${unionSize} makes, ${unionSize - 1} unions, ${unionSize} finds in ${unionMs.toFixed(1)} ms`,
);
