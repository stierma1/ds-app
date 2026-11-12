import {
  BalancedTreeDepq,
  Deap,
  IntervalHeap,
  MinMaxHeap,
  SortedArrayDepq,
  TwoHeapDepq,
} from "../src/index.ts";

interface BenchQueue {
  push(value: number): void;
  popMin(): number | undefined;
  popMax(): number | undefined;
  build(values: Iterable<number>): void;
  isEmpty(): boolean;
  size: number;
}

interface Factory {
  name: string;
  create(): BenchQueue;
}

const factories: Factory[] = [
  { name: "MinMaxHeap", create: () => new MinMaxHeap<number>() },
  { name: "Deap", create: () => new Deap<number>() },
  { name: "IntervalHeap", create: () => new IntervalHeap<number>() },
  { name: "TwoHeapDepq", create: () => new TwoHeapDepq<number>() },
  { name: "SortedArrayDepq", create: () => new SortedArrayDepq<number>() },
  { name: "BalancedTreeDepq", create: () => new BalancedTreeDepq<number>() },
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

function drainAlternating(queue: BenchQueue): number {
  let popped = 0;
  while (!queue.isEmpty()) {
    if (popped % 2 === 0) {
      queue.popMin();
    } else {
      queue.popMax();
    }
    popped++;
  }
  return popped;
}

const rows: Array<Record<string, string | number>> = [];
for (const factory of factories) {
  const pushDrain = milliseconds(() => {
    const queue = factory.create();
    for (const value of values) {
      queue.push(value);
    }
    drainAlternating(queue);
  });
  const buildDrain = milliseconds(() => {
    const queue = factory.create();
    queue.build(values);
    drainAlternating(queue);
  });
  rows.push({
    implementation: factory.name,
    "push+alternate ms": pushDrain.toFixed(1),
    "build+alternate ms": buildDrain.toFixed(1),
  });
}

console.log(`DEPQ mixed workload, n = ${count}`);
console.table(rows);

const half = count >> 1;
const oneSidedRows: Array<Record<string, string | number>> = [];
for (const factory of factories) {
  const minMs = milliseconds(() => {
    const queue = factory.create();
    queue.build(values);
    while (!queue.isEmpty()) {
      queue.popMin();
    }
  });
  const maxMs = milliseconds(() => {
    const queue = factory.create();
    queue.build(values.slice(0, half));
    while (!queue.isEmpty()) {
      queue.popMax();
    }
  });
  oneSidedRows.push({
    implementation: factory.name,
    "build+popMin ms": minMs.toFixed(1),
    "build+popMax ms": maxMs.toFixed(1),
  });
}

console.log(`DEPQ one-sided drains, n = ${count} (max drain uses ${half})`);
console.table(oneSidedRows);
