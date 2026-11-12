import {
  BinaryHeap,
  BinomialHeap,
  BucketQueue,
  CalendarQueue,
  DaryHeap,
  FibonacciHeap,
  IndexedBinaryHeap,
  PairingHeap,
  RadixHeap,
  SortedArrayHeap,
  TimingWheel,
} from "../src/index.ts";
import type { Heap } from "../src/heaps/types.ts";

interface Factory {
  name: string;
  create(): Heap<number>;
}

const factories: Factory[] = [
  { name: "BinaryHeap", create: () => new BinaryHeap<number>() },
  { name: "DaryHeap(4)", create: () => new DaryHeap<number>(undefined, { arity: 4 }) },
  { name: "PairingHeap", create: () => new PairingHeap<number>() },
  { name: "BinomialHeap", create: () => new BinomialHeap<number>() },
  { name: "FibonacciHeap", create: () => new FibonacciHeap<number>() },
  { name: "SortedArrayHeap", create: () => new SortedArrayHeap<number>() },
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

function drain(heap: Heap<number>): number {
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

const indexedCount = 10_000;
const indexed = new IndexedBinaryHeap<number, number>();
const indexedMs = milliseconds(() => {
  for (let index = 0; index < indexedCount; index++) {
    indexed.insert(index * 2, index);
  }
  for (let index = 1; index < indexedCount; index++) {
    indexed.decreaseKey(index * 2, index * 2 - 1);
  }
  while (!indexed.isEmpty()) {
    indexed.pop();
  }
});
rows.push({ implementation: "IndexedBinaryHeap", "push+pop ms": indexedMs.toFixed(1), "build+pop ms": "—" });

const keyed = (value: { key: number }): number => value.key;
const monotoneCount = 10_000;
const bucket = new BucketQueue<{ key: number }>(keyed, monotoneCount);
const bucketMs = milliseconds(() => {
  for (let index = 0; index < monotoneCount; index++) {
    bucket.push({ key: index });
  }
  while (!bucket.isEmpty()) {
    bucket.pop();
  }
});
const radix = new RadixHeap<{ key: number }>(keyed, monotoneCount);
const radixMs = milliseconds(() => {
  for (let index = 0; index < monotoneCount; index++) {
    radix.push({ key: index });
  }
  while (!radix.isEmpty()) {
    radix.pop();
  }
});
rows.push({ implementation: "BucketQueue", "push+pop ms": bucketMs.toFixed(1), "build+pop ms": "—" });
rows.push({ implementation: "RadixHeap", "push+pop ms": radixMs.toFixed(1), "build+pop ms": "—" });

const timerCount = 10_000;
const calendar = new CalendarQueue<number>({ bucketCount: 256, bucketWidth: 1 });
const calendarMs = milliseconds(() => {
  for (let index = 0; index < timerCount; index++) {
    calendar.schedule(index * 2, index);
  }
  calendar.advance(timerCount * 2);
});
const wheel = new TimingWheel<number>({ tickSize: 1, slots: 64, levels: 4 });
const wheelMs = milliseconds(() => {
  for (let index = 0; index < timerCount; index++) {
    wheel.schedule(index * 2, index);
  }
  wheel.advance(timerCount * 2);
});
rows.push({ implementation: "CalendarQueue", "push+pop ms": calendarMs.toFixed(1), "build+pop ms": "—" });
rows.push({ implementation: "TimingWheel", "push+pop ms": wheelMs.toFixed(1), "build+pop ms": "—" });

console.log(`Mixed heap workload, n = ${count}`);
console.table(rows);
