import {
  BinarySearchTree,
  BPlusTree,
  BTree,
  TwoThreeFourTree,
} from "../src/index.ts";
import type { Comparator } from "../src/core/index.ts";

interface CountedComparator {
  compare: Comparator<number>;
  calls: number;
}

function countingComparator(): CountedComparator {
  const counter: CountedComparator = {
    calls: 0,
    compare: (a, b) => {
      counter.calls++;
      return a - b;
    },
  };
  return counter;
}

function milliseconds(run: () => void): number {
  const start = performance.now();
  run();
  return performance.now() - start;
}

function shuffledValues(count: number, seed: number): number[] {
  const values: number[] = new Array(count);
  let state = seed >>> 0;
  for (let index = 0; index < count; index++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    values[index] = state;
  }
  return values;
}

const count = 60_000;
const shuffled = shuffledValues(count, 0x9e3779b9);
const sorted = shuffled.slice().sort((a, b) => a - b);
const uniqueSorted = [...new Set(sorted)];

const compare = (a: number, b: number): number => a - b;
const rows: Array<Record<string, string | number>> = [];

{
  const counter = countingComparator();
  const tree = new TwoThreeFourTree<number, number>(counter.compare);
  const insertMs = milliseconds(() => {
    for (const key of shuffled) {
      tree.set(key, key);
    }
  });
  if (tree.validate() !== true) {
    throw new Error("TwoThreeFourTree failed validation after insertion");
  }
  counter.calls = 0;
  const rounds = 30_000;
  const getMs = milliseconds(() => {
    for (let index = 0; index < rounds; index++) {
      tree.get(sorted[(index * 7919) % count] as number);
    }
  });
  rows.push({
    implementation: "TwoThreeFourTree",
    "shuffled insert ms": insertMs.toFixed(1),
    "get us": ((getMs * 1000) / rounds).toFixed(3),
    "get comparisons": (counter.calls / rounds).toFixed(2),
    height: tree.height,
  });
}

{
  const counter = countingComparator();
  const tree = new BTree<number, number>({
    order: 8,
    compare: counter.compare,
  });
  const insertMs = milliseconds(() => {
    for (const key of shuffled) {
      tree.set(key, key);
    }
  });
  if (tree.validate() !== true) {
    throw new Error("BTree failed validation after insertion");
  }
  counter.calls = 0;
  const rounds = 30_000;
  const getMs = milliseconds(() => {
    for (let index = 0; index < rounds; index++) {
      tree.get(sorted[(index * 7919) % count] as number);
    }
  });
  rows.push({
    implementation: "BTree(order 8)",
    "shuffled insert ms": insertMs.toFixed(1),
    "get us": ((getMs * 1000) / rounds).toFixed(3),
    "get comparisons": (counter.calls / rounds).toFixed(2),
    height: tree.height,
  });
}

{
  const counter = countingComparator();
  const tree = new BPlusTree<number, number>({
    order: 8,
    compare: counter.compare,
  });
  const insertMs = milliseconds(() => {
    for (const key of shuffled) {
      tree.set(key, key);
    }
  });
  if (tree.validate() !== true) {
    throw new Error("BPlusTree failed validation after insertion");
  }
  counter.calls = 0;
  const rounds = 30_000;
  const getMs = milliseconds(() => {
    for (let index = 0; index < rounds; index++) {
      tree.get(sorted[(index * 7919) % count] as number);
    }
  });
  rows.push({
    implementation: "BPlusTree(order 8)",
    "shuffled insert ms": insertMs.toFixed(1),
    "get us": ((getMs * 1000) / rounds).toFixed(3),
    "get comparisons": (counter.calls / rounds).toFixed(2),
    height: tree.height,
  });
}

{
  const tree = new BinarySearchTree<number, number>(compare);
  const insertMs = milliseconds(() => {
    for (const key of shuffled) {
      tree.set(key, key);
    }
  });
  const rounds = 30_000;
  const getMs = milliseconds(() => {
    for (let index = 0; index < rounds; index++) {
      tree.get(sorted[(index * 7919) % count] as number);
    }
  });
  rows.push({
    implementation: "BinarySearchTree",
    "shuffled insert ms": insertMs.toFixed(1),
    "get us": ((getMs * 1000) / rounds).toFixed(3),
    "get comparisons": "n/a",
    height: tree.height,
  });
}

console.log(`B-trees vs unbalanced BST, shuffled insert, n = ${count}`);
console.table(rows);

{
  const entries = uniqueSorted.map(
    (key): [number, number] => [key, key],
  );
  let tree: TwoThreeFourTree<number, number> | undefined;
  const bulkMs = milliseconds(() => {
    const loaded = new TwoThreeFourTree<number, number>(compare);
    loaded.bulkLoad(entries);
    tree = loaded;
  });
  if (tree === undefined || tree.validate() !== true) {
    throw new Error("bulkLoad produced an invalid tree");
  }
  const loadedTree = tree;
  const repeated = new TwoThreeFourTree<number, number>(compare);
  const repeatedMs = milliseconds(() => {
    for (const entry of entries) {
      repeated.set(entry[0], entry[1]);
    }
  });
  if (repeated.validate() !== true) {
    throw new Error("repeated set produced an invalid tree");
  }
  if (loadedTree.toArray().length !== repeated.toArray().length) {
    throw new Error("bulkLoad and repeated set disagree on size");
  }
  const rangeMs = milliseconds(() => {
    for (let round = 0; round < 5_000; round++) {
      const index = (round * 7919) % Math.max(1, uniqueSorted.length - 500);
      for (const _ of loadedTree.range(
        uniqueSorted[index] as number,
        uniqueSorted[index + 500] as number,
      )) {
        // Consume the range.
      }
    }
  });
  let generic: BTree<number, number> | undefined;
  const genericBulkMs = milliseconds(() => {
    const loaded = new BTree<number, number>({ order: 8, compare });
    loaded.bulkLoad(entries);
    generic = loaded;
  });
  if (generic === undefined || generic.validate() !== true) {
    throw new Error("BTree bulkLoad produced an invalid tree");
  }
  const genericTree = generic;
  let plus: BPlusTree<number, number> | undefined;
  const plusBulkMs = milliseconds(() => {
    const loaded = new BPlusTree<number, number>({
      order: 8,
      compare,
    });
    loaded.bulkLoad(entries);
    plus = loaded;
  });
  if (plus === undefined || plus.validate() !== true) {
    throw new Error("BPlusTree bulkLoad produced an invalid tree");
  }
  const plusTree = plus;
  const plusRangeMs = milliseconds(() => {
    for (let round = 0; round < 5_000; round++) {
      const index = (round * 7919) % Math.max(1, uniqueSorted.length - 500);
      for (const _ of plusTree.range(
        uniqueSorted[index] as number,
        uniqueSorted[index + 500] as number,
      )) {
        // Consume the linked-leaf range.
      }
    }
  });
  console.log("Sorted bulk load and range scans");
  console.table([
    {
      implementation: "TwoThreeFourTree.bulkLoad",
      "load ms": bulkMs.toFixed(1),
      height: loadedTree.height,
    },
    {
      implementation: "TwoThreeFourTree repeated set",
      "load ms": repeatedMs.toFixed(1),
      height: repeated.height,
    },
    {
      implementation: "BTree(order 8).bulkLoad",
      "load ms": genericBulkMs.toFixed(1),
      height: genericTree.height,
    },
    {
      implementation: "BPlusTree(order 8).bulkLoad",
      "load ms": plusBulkMs.toFixed(1),
      height: plusTree.height,
    },
    {
      implementation: "range of 501 entries",
      "5k scans ms": rangeMs.toFixed(1),
    },
    {
      implementation: "BPlusTree range of 501 entries",
      "5k scans ms": plusRangeMs.toFixed(1),
    },
  ]);
}
