import { AVLTree, BinarySearchTree, RedBlackTree, WeightBalancedTree } from "../src/index.ts";
import type { BalancedTree } from "../src/balanced-trees/index.ts";
import type { OrderedMap } from "../src/core/index.ts";

interface BenchTree extends OrderedMap<number, number> {
  readonly height: number;
}

interface Factory {
  name: string;
  create(): BenchTree;
}

const factories: Factory[] = [
  { name: "WeightBalancedTree", create: () => new WeightBalancedTree<number, number>() },
  { name: "RedBlackTree", create: () => new RedBlackTree<number, number>() },
  { name: "AVLTree", create: () => new AVLTree<number, number>() },
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

console.log(`Weight-balanced vs red-black vs AVL vs unbalanced BST, random insert/delete, n = ${count}`);
console.table(rows);

const sortedCount = 5_000;
const sortedRows: Array<Record<string, string | number>> = [];
for (const factory of factories) {
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

interface JoinFactory {
  name: string;
  create(): BalancedTree<number, number>;
}

const balancedFactories: JoinFactory[] = [
  { name: "WeightBalancedTree", create: () => new WeightBalancedTree<number, number>() },
  { name: "RedBlackTree", create: () => new RedBlackTree<number, number>() },
  { name: "AVLTree", create: () => new AVLTree<number, number>() },
];

const joinRows: Array<Record<string, string | number>> = [];
const half = count >> 1;
for (const factory of balancedFactories) {
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
    let first: BalancedTree<number, number> | undefined;
    let second: BalancedTree<number, number> | undefined;
    const splitMs = milliseconds(() => {
      [first, second] = target.split(sorted[count >> 1]);
    });
    if (first === undefined || second === undefined) {
      throw new Error("split returned no trees");
    }
    if (first.validate() !== true || second.validate() !== true) {
      throw new Error(`${factory.name} split produced an invalid tree`);
    }
    joinRows.push({
      implementation: factory.name,
      round: round + 1,
      "join 15k+15k ms": joinMs.toFixed(2),
      "split 30k ms": splitMs.toFixed(2),
      "left height": first.height,
      "right height": second.height,
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

console.log("Weight-balanced vs red-black vs AVL join/split");
console.table(joinRows);
