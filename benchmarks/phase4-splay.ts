import {
  BinarySearchTree,
  SplayTree,
  TopDownSplayTree,
} from "../src/index.ts";
import type { OrderedMap } from "../src/core/index.ts";

interface BenchTree extends OrderedMap<number, number> {
  validate(): true | string;
}

interface Factory {
  name: string;
  create(): BenchTree;
}

const factories: Factory[] = [
  { name: "SplayTree", create: () => new SplayTree<number, number>() },
  { name: "TopDownSplayTree", create: () => new TopDownSplayTree<number, number>() },
  { name: "BinarySearchTree", create: () => new BinarySearchTree<number, number>() },
];

function milliseconds(run: () => void): number {
  const start = performance.now();
  run();
  return performance.now() - start;
}

function randomValues(count: number, seed: number): number[] {
  const values: number[] = new Array(count);
  let state = seed >>> 0;
  for (let index = 0; index < count; index++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    values[index] = state;
  }
  return values;
}

const count = 30_000;
const shuffled = randomValues(count, 0x9e3779b9);
const sorted = shuffled.slice().sort((a, b) => a - b);
const present = shuffled.slice(0, count);

const rows: Array<Record<string, string | number>> = [];
for (const factory of factories) {
  const tree = factory.create();
  const insertMs = milliseconds(() => {
    for (const key of shuffled) {
      tree.set(key, key);
    }
  });
  if (tree.validate() !== true) {
    throw new Error(`${factory.name} failed validation after insert`);
  }

  let hits = 0;
  const lookupMs = milliseconds(() => {
    for (const key of present) {
      if (tree.get(key) !== undefined) {
        hits++;
      }
    }
  });

  const localityMs = milliseconds(() => {
    for (let index = 0; index < count; index++) {
      tree.get(sorted[index]);
    }
  });

  const deleteMs = milliseconds(() => {
    for (let index = 0; index < count; index += 2) {
      tree.delete(sorted[index]);
    }
  });
  if (tree.validate() !== true) {
    throw new Error(`${factory.name} failed validation after delete`);
  }

  rows.push({
    implementation: factory.name,
    "insert ms": insertMs.toFixed(1),
    "random lookup ms": lookupMs.toFixed(1),
    "sorted sweep ms": localityMs.toFixed(1),
    "delete half ms": deleteMs.toFixed(1),
    hits,
  });
}

console.log(`Splay vs unbalanced BST, random insert, lookup, locality sweep, n = ${count}`);
console.table(rows);

const hotRows: Array<Record<string, string | number>> = [];
for (const factory of factories) {
  const tree = factory.create();
  for (const key of shuffled) {
    tree.set(key, key);
  }
  const hot = sorted[count >> 1];
  const hotMs = milliseconds(() => {
    for (let index = 0; index < count * 4; index++) {
      tree.get(hot);
    }
  });
  const alternatingMs = milliseconds(() => {
    for (let index = 0; index < count * 2; index++) {
      tree.get(index % 2 === 0 ? hot : sorted[index % count]);
    }
  });
  hotRows.push({
    implementation: factory.name,
    "hot key 120k gets ms": hotMs.toFixed(1),
    "alternating 60k gets ms": alternatingMs.toFixed(1),
  });
}

console.log("Locality-heavy access (hot key and alternating hot/cold)");
console.table(hotRows);

const rangeRows: Array<Record<string, string | number>> = [];
const half = count >> 1;
for (const factory of [
  { name: "SplayTree", create: () => new SplayTree<number, number>() },
  { name: "TopDownSplayTree", create: () => new TopDownSplayTree<number, number>() },
]) {
  for (let round = 0; round < 3; round++) {
    const left = factory.create();
    const right = factory.create();
    for (let index = 0; index < half; index++) {
      left.set(index, index);
      right.set(half + index, half + index);
    }
    const joinMs = milliseconds(() => {
      left.join(right);
    });
    assertConsumed(left, right);

    const target = factory.create();
    for (const key of shuffled) {
      target.set(key, key);
    }
    let first: BenchTree | undefined;
    let second: BenchTree | undefined;
    const splitMs = milliseconds(() => {
      [first, second] = target.split(sorted[count >> 1]);
    });
    if (first === undefined || second === undefined) {
      throw new Error("split returned no trees");
    }
    if (first.validate() !== true || second.validate() !== true) {
      throw new Error("split produced an invalid tree");
    }
    rangeRows.push({
      implementation: factory.name,
      round: round + 1,
      "join 15k+15k ms": joinMs.toFixed(2),
      "split 30k ms": splitMs.toFixed(2),
    });
  }
}

function assertConsumed(
  left: { readonly size: number },
  right: { readonly size: number },
): void {
  for (const tree of [left, right]) {
    try {
      void tree.size;
      throw new Error("consumed tree still reports a size");
    } catch (error) {
      if (error instanceof Error && error.name !== "ConsumedError") {
        throw error;
      }
    }
  }
}

console.log("Splay join/split");
console.table(rangeRows);
