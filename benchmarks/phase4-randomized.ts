import {
  BinaryHeap,
  BinarySearchTree,
  PairingHeap,
  RandomizedBST,
  RandomizedMeldableHeap,
  SkipList,
  Treap,
} from "../src/index.ts";
import type { OrderedMap, PriorityQueue } from "../src/core/index.ts";

interface BenchTree extends OrderedMap<number, number> {
  validate(): true | string;
  readonly height: number;
}

interface TreeFactory {
  name: string;
  create(): BenchTree;
}

interface HeapFactory {
  name: string;
  create(): PriorityQueue<number> & { validate(): true | string };
}

const trees: TreeFactory[] = [
  { name: "Treap", create: () => new Treap<number, number>(undefined, { rng: 1 }) },
  {
    name: "RandomizedBST",
    create: () => new RandomizedBST<number, number>(undefined, { rng: 2 }),
  },
  { name: "SkipList", create: () => new SkipList<number, number>(undefined, { rng: 3 }) },
  { name: "BinarySearchTree", create: () => new BinarySearchTree<number, number>() },
];

const heaps: HeapFactory[] = [
  {
    name: "RandomizedMeldableHeap",
    create: () => new RandomizedMeldableHeap<number>(undefined, { rng: 4 }),
  },
  { name: "PairingHeap", create: () => new PairingHeap<number>() },
  { name: "BinaryHeap", create: () => new BinaryHeap<number>() },
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

const count = 25_000;
const shuffled = randomValues(count, 0x9e3779b9);
const sorted = shuffled.slice().sort((a, b) => a - b);

const rows: Array<Record<string, string | number>> = [];
for (const factory of trees) {
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
    for (const key of shuffled) {
      if (tree.get(key) !== undefined) {
        hits++;
      }
    }
  });

  let ranged = 0;
  const rangeMs = milliseconds(() => {
    for (const entry of tree.range(sorted[count >> 2], sorted[(3 * count) >> 2])) {
      ranged += entry[1];
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
    "lookup ms": lookupMs.toFixed(1),
    "range ms": rangeMs.toFixed(1),
    "delete half ms": deleteMs.toFixed(1),
    height: tree.height,
    hits,
    ranged,
  });
}

console.log(`Randomized ordered maps vs unbalanced BST, n = ${count}`);
console.table(rows);

const sortedRows: Array<Record<string, string | number>> = [];
const sortedCount = 5_000;
for (const factory of trees) {
  const tree = factory.create();
  const elapsed = milliseconds(() => {
    for (let key = 0; key < sortedCount; key++) {
      tree.set(key, key);
    }
    for (let key = 0; key < sortedCount; key++) {
      tree.get(key);
    }
  });
  sortedRows.push({
    implementation: factory.name,
    "sorted insert+lookup ms": elapsed.toFixed(1),
    height: tree.height,
  });
}

console.log(`Sorted input, n = ${sortedCount}`);
console.table(sortedRows);

const heapCount = 60_000;
const heapRows: Array<Record<string, string | number>> = [];
for (const factory of heaps) {
  const heap = factory.create();
  const pushMs = milliseconds(() => {
    for (const value of shuffled.slice(0, heapCount)) {
      heap.push(value);
    }
  });
  if (heap.validate() !== true) {
    throw new Error(`${factory.name} failed validation after push`);
  }
  const popMs = milliseconds(() => {
    while (!heap.isEmpty()) {
      heap.pop();
    }
  });
  if (heap.validate() !== true) {
    throw new Error(`${factory.name} failed validation after drain`);
  }
  heapRows.push({
    implementation: factory.name,
    "push 60k ms": pushMs.toFixed(1),
    "pop 60k ms": popMs.toFixed(1),
  });
}

console.log(`Priority queues, random values, n = ${heapCount}`);
console.table(heapRows);
