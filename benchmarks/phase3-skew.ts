import {
  BinaryHeap,
  LeftistHeap,
  RecursiveSkewHeap,
  SkewHeap,
} from "../src/index.ts";
import type { SkewHeap as SkewHeapContract } from "../src/skew-heaps/types.ts";

interface BenchHeap {
  push(value: number): void;
  pop(): number | undefined;
  build(values: Iterable<number>): void;
  isEmpty(): boolean;
}

interface Factory {
  name: string;
  create(): BenchHeap;
}

const factories: Factory[] = [
  { name: "BinaryHeap", create: () => new BinaryHeap<number>() },
  { name: "LeftistHeap", create: () => new LeftistHeap<number>() },
  { name: "SkewHeap", create: () => new SkewHeap<number>() },
  { name: "RecursiveSkewHeap", create: () => new RecursiveSkewHeap<number>() },
];

const count = 20_000;
const values: number[] = new Array(count);
let state = 0x9e3779b9;
for (let index = 0; index < count; index++) {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  values[index] = state;
}

function milliseconds(run: () => void): number {
  const start = performance.now();
  run();
  return performance.now() - start;
}

function drain(heap: BenchHeap): number {
  let previous = -Infinity;
  let popped = 0;
  while (!heap.isEmpty()) {
    const value = heap.pop() as number;
    if (value < previous) {
      throw new Error("heap order regression");
    }
    previous = value;
    popped++;
  }
  return popped;
}

const rows: Array<Record<string, string | number>> = [];
for (const factory of factories) {
  const pushPop = milliseconds(() => {
    const heap = factory.create();
    for (const value of values) {
      heap.push(value);
    }
    drain(heap);
  });
  const buildPop = milliseconds(() => {
    const heap = factory.create();
    heap.build(values);
    drain(heap);
  });
  rows.push({
    implementation: factory.name,
    "push+pop ms": pushPop.toFixed(1),
    "build+pop ms": buildPop.toFixed(1),
  });
}

console.log(`Skew-heap mixed heap workload, n = ${count}`);
console.table(rows);

const meldFactories: Array<{
  name: string;
  create(): SkewHeapContract<number>;
}> = [
  { name: "SkewHeap", create: () => new SkewHeap<number>() },
  { name: "RecursiveSkewHeap", create: () => new RecursiveSkewHeap<number>() },
];

const half = count >> 1;
const meldRows: Array<Record<string, string | number>> = [];
for (const factory of meldFactories) {
  const left = factory.create();
  const right = factory.create();
  left.build(values.slice(0, half));
  right.build(values.slice(half));
  const meldMs = milliseconds(() => {
    left.merge(right);
  });
  const drainMs = milliseconds(() => {
    drain(left);
  });
  meldRows.push({
    implementation: factory.name,
    "merge ms": meldMs.toFixed(2),
    "drain ms": drainMs.toFixed(1),
  });
}

console.log(`Skew-heap meld of two heaps, n = ${half} each`);
console.table(meldRows);
