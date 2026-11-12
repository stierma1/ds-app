import test from "node:test";
import assert from "node:assert/strict";
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
} from "../../src/heaps/index.ts";
import {
  ConsumedError,
  takeForMerge,
  UnsupportedError,
} from "../../src/core/index.ts";
import type { Comparator } from "../../src/core/index.ts";
import type { Heap } from "../../src/heaps/types.ts";

const numeric: Comparator<number> = (a, b) => a - b;

type HeapClass = {
  name: string;
  create(compare?: Comparator<number>): Heap<number>;
};

const heapClasses: HeapClass[] = [
  { name: "BinaryHeap", create: (c) => new BinaryHeap<number>(c) },
  { name: "DaryHeap", create: (c) => new DaryHeap<number>(c) },
  { name: "SortedArrayHeap", create: (c) => new SortedArrayHeap<number>(c) },
  { name: "PairingHeap", create: (c) => new PairingHeap<number>(c) },
  { name: "BinomialHeap", create: (c) => new BinomialHeap<number>(c) },
  { name: "FibonacciHeap", create: (c) => new FibonacciHeap<number>(c) },
];
const copyingClasses = new Set(["BinaryHeap", "DaryHeap", "SortedArrayHeap"]);

function filled(kind: HeapClass, values: number[], compare?: Comparator<number>): Heap<number> {
  const heap = kind.create(compare);
  for (const value of values) {
    heap.push(value);
  }
  return heap;
}

function drain(heap: Heap<number>): number[] {
  const values: number[] = [];
  while (!heap.isEmpty()) {
    values.push(heap.pop() as number);
  }
  return values;
}

/** Best-of-three wall time in milliseconds. */
function timed(run: () => void): number {
  let best = Infinity;
  for (let attempt = 0; attempt < 3; attempt++) {
    const start = performance.now();
    run();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

/** Fails when a 16x larger input costs far more than 16x (a quadratic loop costs ~256x). */
function assertNearLinear(label: string, run: (n: number) => void, small: number): void {
  run(small); // warm up the JIT
  const smallTime = timed(() => run(small));
  const largeTime = timed(() => run(small * 16));
  assert.ok(
    largeTime < 40 || largeTime < smallTime * 64,
    `${label}: ${small} -> ${smallTime.toFixed(1)}ms, ${small * 16} -> ${largeTime.toFixed(1)}ms`,
  );
}

// ---- Shared merge rule -------------------------------------------------------------------------

test("merge rejects a different comparator function with TypeError before changing anything", () => {
  for (const kind of heapClasses) {
    const heap = filled(kind, [3, 1], numeric);
    const other = filled(kind, [2], (a, b) => a - b);
    assert.throws(() => heap.merge(other), TypeError, kind.name);
    assert.equal(heap.size, 2, kind.name);
    assert.equal(other.size, 1, kind.name);
    // Two default-comparator heaps share the one default function and merge fine.
    const left = filled(kind, [5, 4]);
    const right = filled(kind, [6]);
    left.merge(right);
    assert.deepEqual(drain(left), [4, 5, 6], kind.name);
    assert.throws(() => right.size, ConsumedError, kind.name);
  }
});

test("array heaps copy another implementation through takeForMerge and consume it", () => {
  for (const receiver of heapClasses.filter((kind) => copyingClasses.has(kind.name))) {
    for (const source of heapClasses) {
      if (source.name === receiver.name) {
        continue;
      }
      const heap = filled(receiver, [9, 1, 7], numeric);
      const other = filled(source, [8, 2, 6], numeric);
      heap.merge(other);
      assert.equal(heap.validate(), true, `${receiver.name} <- ${source.name}`);
      assert.deepEqual(drain(heap), [1, 2, 6, 7, 8, 9], `${receiver.name} <- ${source.name}`);
      assert.throws(() => other.push(1), ConsumedError);
      assert.throws(() => other.size, ConsumedError);
    }
  }
});

test("array heaps take elements from any module's takeForMerge source", () => {
  let consumed = false;
  const foreign = {
    compare: numeric,
    [takeForMerge](): number[] {
      consumed = true;
      return [4, 0];
    },
  };
  const heap = filled(heapClasses[0], [3], numeric);
  heap.merge(foreign as unknown as Heap<number>);
  assert.equal(consumed, true);
  assert.deepEqual(drain(heap), [0, 3, 4]);
});

test("O(1) and O(log n) meldable heaps reject other implementations without mutating either", () => {
  for (const receiver of heapClasses.filter((kind) => !copyingClasses.has(kind.name))) {
    for (const source of heapClasses) {
      if (source.name === receiver.name) {
        continue;
      }
      const heap = filled(receiver, [9, 1], numeric);
      const other = filled(source, [8, 2], numeric);
      assert.throws(() => heap.merge(other), UnsupportedError, `${receiver.name} <- ${source.name}`);
      assert.deepEqual(drain(heap), [1, 9]);
      assert.deepEqual(drain(other), [2, 8]);
    }
  }
});

test("merge with an argument lacking takeForMerge throws UnsupportedError and copies nothing", () => {
  for (const kind of heapClasses) {
    let read = false;
    const plain = {
      compare: numeric,
      toArray(): number[] {
        read = true;
        return [0];
      },
    };
    const heap = filled(kind, [1], numeric);
    assert.throws(() => heap.merge(plain as unknown as Heap<number>), UnsupportedError, kind.name);
    assert.equal(read, false, kind.name);
    assert.deepEqual(drain(heap), [1], kind.name);
  }
});

// ---- 10. Consumed heaps ------------------------------------------------------------------------

test("consumed heaps throw ConsumedError from size, isEmpty, validate, and height", () => {
  for (const kind of heapClasses) {
    const heap = filled(kind, [1], numeric);
    const other = filled(kind, [2], numeric);
    heap.merge(other);
    assert.throws(() => other.size, ConsumedError, kind.name);
    assert.throws(() => other.isEmpty(), ConsumedError, kind.name);
    assert.throws(() => other.validate(), ConsumedError, kind.name);
    assert.throws(() => other.height, ConsumedError, kind.name);
    assert.throws(() => other.serialize(), ConsumedError, kind.name);
    assert.throws(() => other.merge(kind.create(numeric)), ConsumedError, kind.name);
    assert.equal(heap.size, 2, kind.name);
  }
});

// ---- 5. decreaseKey with duplicate values ------------------------------------------------------

test("PairingHeap and FibonacciHeap decreaseKey keeps indexing duplicate values", () => {
  for (const create of [() => new PairingHeap<number>(), () => new FibonacciHeap<number>()]) {
    const heap = create();
    heap.push(1);
    heap.push(1);
    assert.equal(heap.decreaseKey(1, 0), true);
    assert.equal(heap.validate(), true);
    assert.equal(heap.pop(), 0);
    assert.equal(heap.decreaseKey(1, 0), true);
    assert.equal(heap.validate(), true);
    assert.deepEqual(heap.toArray(), [0]);

    const other = create();
    other.push(5);
    other.push(5);
    other.pop();
    assert.equal(other.decreaseKey(5, 1), true);
    assert.deepEqual(other.toArray(), [1]);

    // Decreasing into an existing value, then popping one of the pair, leaves the other findable.
    const into = create();
    into.push(5);
    into.push(3);
    assert.equal(into.decreaseKey(5, 3), true);
    into.pop();
    assert.equal(into.decreaseKey(3, 0), true);
    assert.equal(into.validate(), true);
    assert.deepEqual(into.toArray(), [0]);
  }
});

test("decreaseKey duplicates survive a same-class merge", () => {
  const left = new PairingHeap<number>();
  const right = new PairingHeap<number>();
  left.push(4);
  right.push(4);
  right.push(4);
  left.merge(right);
  for (let index = 0; index < 3; index++) {
    assert.equal(left.decreaseKey(4, index), true);
    assert.equal(left.validate(), true);
  }
  assert.deepEqual(drain(left), [0, 1, 2]);
});

// ---- 6. Serialization keeps iteration order ----------------------------------------------------

test("PairingHeap and FibonacciHeap round trips preserve iteration order", () => {
  const pairing = new PairingHeap<number>();
  for (const value of [1, 2, 3]) {
    pairing.push(value);
  }
  const before = pairing.toArray();
  assert.deepEqual(PairingHeap.deserialize<number>(pairing.serialize()).toArray(), before);

  for (const kind of [
    { create: () => new PairingHeap<number>(), restore: (json: string) => PairingHeap.deserialize<number>(json) },
    { create: () => new FibonacciHeap<number>(), restore: (json: string) => FibonacciHeap.deserialize<number>(json) },
  ]) {
    for (let trial = 0; trial < 50; trial++) {
      const heap = kind.create();
      for (let index = 0; index < 20; index++) {
        heap.push((index * 7919 + trial * 31) % 23);
      }
      for (let index = 0; index < 3; index++) {
        heap.pop();
      }
      const restored = kind.restore(heap.serialize());
      assert.deepEqual(restored.toArray(), heap.toArray());
      assert.equal(restored.validate(), true);
      assert.deepEqual(kind.restore(restored.serialize()).toArray(), heap.toArray());
    }
  }
});

// ---- 1. RadixHeap keys beyond 32 bits, and O(1) peek -------------------------------------------

test("RadixHeap orders keys at and beyond 2^31 up to MAX_SAFE_INTEGER", () => {
  const heap = new RadixHeap<number>((value) => value, 2 ** 31);
  heap.push(2 ** 31);
  heap.push(5);
  assert.equal(heap.validate(), true);
  assert.equal(heap.pop(), 5);
  assert.equal(heap.pop(), 2 ** 31);

  for (const maxKey of [2 ** 32 + 5, 2 ** 40, Number.MAX_SAFE_INTEGER]) {
    const queue = new RadixHeap<number>((value) => value, maxKey);
    const keys = [maxKey, 5, 2 ** 31 - 1, 2 ** 31, 2 ** 32, 0, maxKey - 1];
    for (const key of keys) {
      queue.push(key);
      assert.equal(queue.validate(), true);
    }
    const drained: number[] = [];
    while (!queue.isEmpty()) {
      drained.push(queue.pop() as number);
      assert.equal(queue.validate(), true);
    }
    assert.deepEqual(drained, [...keys].sort((a, b) => a - b), `maxKey ${maxKey}`);
  }
  assert.throws(() => new RadixHeap<number>((value) => value, 2 ** 53), RangeError);
});

test("RadixHeap peek stays O(1) under alternating push and peek", () => {
  assertNearLinear("RadixHeap push+peek", (n) => {
    const heap = new RadixHeap<number>((value) => value, 1 << 20);
    for (let index = 0; index < n; index++) {
      heap.push(n - index);
      heap.peek();
    }
  }, 2000);
  const heap = new RadixHeap<{ key: number }>((value) => value.key, 100);
  const items = [40, 10, 70, 10].map((key) => ({ key }));
  for (const item of items) {
    heap.push(item);
  }
  assert.equal(heap.peek()?.key, 10);
  assert.equal(heap.decreaseKey(items[2], 3), true);
  items[2].key = 3;
  assert.equal(heap.peek(), items[2]);
  assert.equal(heap.pop(), items[2]);
  assert.equal(heap.peek()?.key, 10);
  assert.equal(heap.validate(), true);
});

// ---- BucketQueue.clear is O(n) -----------------------------------------------------------------

test("BucketQueue.clear touches only used buckets", () => {
  const queue = new BucketQueue<number>((value) => value, 2_000_000);
  const start = performance.now();
  for (let round = 0; round < 300; round++) {
    queue.push(round);
    queue.push(1_999_999);
    queue.clear();
  }
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 1000, `300 clears took ${elapsed.toFixed(0)}ms`);
  assert.equal(queue.size, 0);
  assert.equal(queue.validate(), true);
  queue.push(7);
  assert.equal(queue.pop(), 7);
});

// ---- 9. Malformed payloads throw TypeError -----------------------------------------------------

test("malformed monotone and timer payloads throw TypeError", () => {
  const key = (): number => 0;
  const cases: Array<[string, () => unknown]> = [
    ["bucket key out of range", () => BucketQueue.deserialize({ type: "BucketQueue", version: 1, entries: [[99, "x"]], maxKey: 10, lastPopped: -1 }, key)],
    ["bucket lastPopped", () => BucketQueue.deserialize({ type: "BucketQueue", version: 1, entries: [], maxKey: 10, lastPopped: 50 }, key)],
    ["bucket maxKey -1", () => BucketQueue.deserialize({ type: "BucketQueue", version: 1, entries: [], maxKey: -1, lastPopped: -1 }, key)],
    ["radix base", () => RadixHeap.deserialize({ type: "RadixHeap", version: 1, entries: [], maxKey: 10, base: 99, lastPopped: -1 }, key)],
    ["radix maxKey -1", () => RadixHeap.deserialize({ type: "RadixHeap", version: 1, entries: [], maxKey: -1, base: 0, lastPopped: -1 }, key)],
    ["radix key below base", () => RadixHeap.deserialize({ type: "RadixHeap", version: 1, entries: [[2, "x"]], maxKey: 10, base: 4, lastPopped: 4 }, key)],
    ["calendar now -1", () => CalendarQueue.deserialize({ type: "CalendarQueue", version: 1, events: [], now: -1, bucketCount: 2, bucketWidth: 1 })],
    ["calendar width 0", () => CalendarQueue.deserialize({ type: "CalendarQueue", version: 1, events: [], now: 0, bucketCount: 2, bucketWidth: 0 })],
    ["calendar duplicate id", () => CalendarQueue.deserialize({ type: "CalendarQueue", version: 1, events: [[1, 1, 0, "a"], [1, 2, 1, "b"]], now: 0, bucketCount: 2, bucketWidth: 1 })],
    ["calendar stale nextId", () => CalendarQueue.deserialize({ type: "CalendarQueue", version: 1, events: [[3, 1, 0, "a"]], now: 0, bucketCount: 2, bucketWidth: 1, nextId: 2 })],
    ["wheel slots 1", () => TimingWheel.deserialize({ type: "TimingWheel", version: 1, events: [], now: 0, tickSize: 1, slots: 1, levels: 1 })],
    ["wheel tick overflow", () => TimingWheel.deserialize({ type: "TimingWheel", version: 1, events: [[1, 1e308, 0, "x"]], now: 0, tickSize: 1e-10, slots: 2, levels: 1 })],
    ["wheel overdue event", () => TimingWheel.deserialize({ type: "TimingWheel", version: 1, events: [[1, 1, 0, "x"]], now: 5, tickSize: 1, slots: 4, levels: 1 })],
  ];
  for (const [label, run] of cases) {
    assert.throws(run, TypeError, label);
  }
});

// ---- 2, 3, minor: TimingWheel delivery rule ----------------------------------------------------

test("TimingWheel with tickSize <= 1 delivers fractional times exactly", () => {
  const wheel = new TimingWheel<string>();
  wheel.schedule(0.5, "a");
  wheel.schedule(0.9, "b");
  assert.deepEqual(wheel.advance(0.7), ["a"]);
  assert.equal(wheel.peekTime(), 0.9);
  assert.equal(wheel.validate(), true);
  assert.deepEqual(wheel.advance(0.9), ["b"]);

  const fine = new TimingWheel<string>({ tickSize: 0.25, slots: 4, levels: 2 });
  fine.schedule(0.3, "x");
  fine.schedule(0.4, "y");
  assert.deepEqual(fine.advance(0.35), ["x"]);
  const restored = TimingWheel.deserialize<string>(fine.serialize());
  assert.equal(restored.validate(), true);
  assert.deepEqual(restored.advance(0.4), ["y"]);
});

test("TimingWheel accepts quantized events pending past now in validate and round trips", () => {
  const wheel = new TimingWheel<string>({ tickSize: 5 });
  wheel.schedule(3, "a");
  assert.deepEqual(wheel.advance(4), []);
  assert.equal(wheel.validate(), true);
  const restored = TimingWheel.deserialize<string>(wheel.serialize());
  assert.equal(restored.validate(), true);
  assert.equal(restored.size, 1);
  assert.deepEqual(restored.advance(5), ["a"]);
});

test("TimingWheel fast-forward and stepped advance agree on tick boundaries", () => {
  const jumped = new TimingWheel<string>({ tickSize: 10 });
  const stepped = new TimingWheel<string>({ tickSize: 10 });
  jumped.schedule(10_000_015, "x");
  stepped.schedule(10_000_015, "x");
  stepped.advance(5_000_000);
  assert.deepEqual(jumped.advance(10_000_016), []);
  assert.deepEqual(stepped.advance(10_000_016), []);
  assert.equal(jumped.validate(), true);
  assert.deepEqual(jumped.advance(10_000_020), ["x"]);
  assert.deepEqual(stepped.advance(10_000_020), ["x"]);

  const exact = new TimingWheel<string>();
  exact.schedule(20_000_000.5, "y");
  assert.deepEqual(exact.advance(20_000_000.4), []);
  assert.deepEqual(exact.advance(20_000_000.5), ["y"]);
});

// ---- 4. Ids are never reused after a round trip ------------------------------------------------

test("timer queues keep their id counter across serialization", () => {
  for (const kind of [
    { create: () => new CalendarQueue<string>(), restore: (json: unknown) => CalendarQueue.deserialize<string>(json) },
    { create: () => new TimingWheel<string>(), restore: (json: unknown) => TimingWheel.deserialize<string>(json) },
  ]) {
    const queue = kind.create();
    const a = queue.schedule(10, "a");
    const b = queue.schedule(5, "b");
    assert.equal(queue.cancel(b), true);
    const restored = kind.restore(queue.serialize());
    const c = restored.schedule(20, "c");
    assert.notEqual(c, a);
    assert.notEqual(c, b);
    assert.equal(restored.cancel(b), false);
    assert.deepEqual(restored.toArray(), ["a", "c"]);

    // Payloads written before nextId was serialized fall back to max(id) + 1.
    const legacy = JSON.parse(queue.serialize()) as Record<string, unknown>;
    delete legacy.nextId;
    assert.equal(kind.restore(legacy).schedule(30, "d"), a + 1);
  }
});

// ---- 8, Brown resize, O(1) peekTime: CalendarQueue ---------------------------------------------

test("CalendarQueue validates with fractional bucket widths", () => {
  const queue = new CalendarQueue<string>({ bucketWidth: 0.1, bucketCount: 3, now: 3 });
  assert.equal(queue.validate(), true);
  for (const now of [1, 7, 30, 1234, 99_999]) {
    const shifted = new CalendarQueue<string>({ bucketWidth: 0.1, bucketCount: 3 });
    shifted.advance(now);
    assert.equal(shifted.validate(), true, `advance(${now})`);
    shifted.schedule(now, "a");
    assert.deepEqual(shifted.advance(now), ["a"]);
    assert.equal(shifted.validate(), true);
  }
});

test("CalendarQueue resizes width and count from event separations (Brown)", () => {
  const queue = new CalendarQueue<number>();
  for (let index = 0; index < 2000; index++) {
    queue.schedule(1e9 + index * 1000, index);
  }
  assert.equal(queue.validate(), true);
  assert.ok(queue.bucketCount >= 1000, `bucketCount ${queue.bucketCount}`);
  assert.ok(Math.abs(queue.bucketWidth - 3000) < 1e-6, `bucketWidth ${queue.bucketWidth}`);
  assert.equal(queue.peekTime(), 1e9);
  assert.deepEqual(queue.advance(1e9 + 1_998_000), Array.from({ length: 1999 }, (_, index) => index));
  assert.equal(queue.validate(), true);
  assert.ok(queue.bucketCount <= 2, `shrunk to ${queue.bucketCount}`);
  assert.deepEqual(queue.advance(2e9), [1999]);
  assert.equal(queue.validate(), true);

  assertNearLinear("CalendarQueue far-future schedule", (n) => {
    const calendar = new CalendarQueue<number>();
    for (let index = 0; index < n; index++) {
      calendar.schedule(index % 7 === 0 ? 1e12 + index : index * 0.5, index);
    }
  }, 2000);
});

test("timer peekTime stays O(1) under alternating schedule and peek", () => {
  for (const create of [() => new CalendarQueue<number>(), () => new TimingWheel<number>()]) {
    assertNearLinear(create().constructor.name, (n) => {
      const queue = create();
      for (let index = 0; index < n; index++) {
        queue.schedule(index % 30, index);
        queue.peekTime();
      }
    }, 1000);
  }
  for (const queue of [new CalendarQueue<number>(), new TimingWheel<number>()]) {
    const first = queue.schedule(4, 4);
    queue.schedule(9, 9);
    queue.schedule(6, 6);
    assert.equal(queue.peekTime(), 4);
    queue.cancel(first);
    assert.equal(queue.peekTime(), 6);
    assert.deepEqual(queue.advance(7), [6]);
    assert.equal(queue.peekTime(), 9);
    assert.equal(queue.validate(), true);
  }
});

// ---- Follow-up 1: IndexedBinaryHeap key identity -----------------------------------------------

test("IndexedBinaryHeap identifies keys by default-comparator equality", () => {
  const dates = new IndexedBinaryHeap<Date, string>();
  assert.equal(dates.insert(new Date(5), "a"), true);
  assert.equal(dates.insert(new Date(5), "b"), false);
  assert.equal(dates.size, 1);
  assert.equal(dates.has(new Date(5)), true);
  assert.equal(dates.get(new Date(5)), "a");
  assert.equal(dates.insert(new Date(9), "c"), true);
  assert.equal(dates.decreaseKey(new Date(9), new Date(5)), false); // identity taken
  assert.equal(dates.decreaseKey(new Date(9), new Date(1)), true);
  assert.equal(dates.has(new Date(9)), false);
  assert.equal(dates.delete(new Date(1)), true);
  assert.equal(dates.validate(), true);

  const numbers = new IndexedBinaryHeap<unknown, string>();
  numbers.insert(1, "one");
  assert.equal(numbers.has("1"), false);
  assert.equal(numbers.has(1n), false);
  assert.equal(numbers.has({ valueOf: () => 1 }), true); // valueOf primitive equals 1
  assert.equal(numbers.insert(-0, "zero"), true);
  assert.equal(numbers.has(0), true);
  assert.throws(() => numbers.insert({}, "plain"), TypeError);
  assert.throws(() => numbers.insert(Number.NaN, "nan"), TypeError);
  assert.throws(() => numbers.has([1, 2]), TypeError);
});

test("IndexedBinaryHeap keyOf identifies other key types and survives a round trip", () => {
  interface Task {
    id: string;
    priority: number;
  }
  const byPriority = (a: Task, b: Task): number => a.priority - b.priority;
  const options = { keyOf: (task: Task) => task.id };
  const heap = new IndexedBinaryHeap<Task, number>(byPriority, options);
  assert.equal(heap.insert({ id: "a", priority: 5 }, 1), true);
  assert.equal(heap.insert({ id: "a", priority: 9 }, 2), false);
  assert.equal(heap.insert({ id: "b", priority: 7 }, 3), true);
  assert.equal(heap.decreaseKey({ id: "b", priority: 7 }, { id: "b", priority: 1 }), true);
  assert.deepEqual(heap.peek(), [{ id: "b", priority: 1 }, 3]);
  assert.equal(heap.validate(), true);
  assert.throws(() => new IndexedBinaryHeap<Task, number>(byPriority).insert({ id: "x", priority: 1 }, 0), TypeError);
  assert.throws(() => new IndexedBinaryHeap<Task, number>(byPriority, { keyOf: () => ({}) as never }).insert({ id: "x", priority: 1 }, 0), TypeError);

  const restored = IndexedBinaryHeap.deserialize<Task, number>(heap.serialize(), byPriority, options);
  assert.equal(restored.validate(), true);
  assert.deepEqual(restored.toArray(), heap.toArray());
  assert.equal(restored.has({ id: "a", priority: 0 }), true);
  assert.throws(
    () =>
      IndexedBinaryHeap.deserialize<Task, number>(
        { type: "IndexedBinaryHeap", version: 1, entries: [[{ id: "a", priority: 1 }, 1], [{ id: "a", priority: 2 }, 2]] },
        byPriority,
        options,
      ),
    TypeError,
  );
});

// ---- Follow-up 4: TimingWheel earliest event without a side heap -------------------------------

test("TimingWheel peekTime tracks slot minima across levels, cascades, and cancels", () => {
  const random = (() => {
    let state = 12345;
    return (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  })();
  for (const options of [{ slots: 4, levels: 1 }, { slots: 40, levels: 2 }, { tickSize: 3, slots: 8 }]) {
    const wheel = new TimingWheel<number>(options);
    const live = new Map<number, number>();
    for (let step = 0; step < 1500; step++) {
      const roll = random();
      if (roll < 0.5) {
        const time = wheel.now + Math.floor(random() * [5, 60, 4000][step % 3]);
        live.set(wheel.schedule(time, step), time);
      } else if (roll < 0.75 && live.size > 0) {
        // Prefer cancelling the earliest event so slot and global minima are removed often.
        let target = [...live.entries()].reduce((best, entry) => (entry[1] < best[1] ? entry : best));
        if (random() < 0.4) {
          target = [...live.entries()][Math.floor(random() * live.size)];
        }
        assert.equal(wheel.cancel(target[0]), true);
        live.delete(target[0]);
      } else {
        const delivered = wheel.advance(wheel.now + Math.floor(random() * 40));
        assert.ok(Array.isArray(delivered));
        live.clear();
        // Rebuild the reference from the wheel's own serialized events.
        const payload = JSON.parse(wheel.serialize()) as { events: Array<[number, number]> };
        for (const [id, time] of payload.events) {
          live.set(id, time);
        }
      }
      const expected = live.size === 0 ? undefined : Math.min(...live.values());
      assert.equal(wheel.peekTime(), expected, `step ${step}`);
      assert.equal(wheel.validate(), true, `step ${step}`);
    }
  }
});

// ---- Follow-up 2: Pairing/Fibonacci handles and the lazy value index ---------------------------

type HandleHeap = PairingHeap<number> | FibonacciHeap<number>;
const handleKinds: Array<{ name: string; create: (compare?: Comparator<number>) => HandleHeap }> = [
  { name: "PairingHeap", create: (compare) => new PairingHeap<number>(compare) },
  { name: "FibonacciHeap", create: (compare) => new FibonacciHeap<number>(compare) },
];

test("handle decreaseKey and delete work on Pairing and Fibonacci heaps", () => {
  for (const kind of handleKinds) {
    const heap = kind.create();
    const handles = [50, 40, 30, 20, 10].map((value) => heap.push(value));
    heap.pop(); // 10 leaves; the others are now in a deeper tree
    assert.equal(heap.decreaseKey(handles[0], 5), true, kind.name);
    assert.equal(handles[0].value, 5);
    assert.equal(heap.peek(), 5);
    assert.equal(heap.decreaseKey(handles[1], 99), false, kind.name); // would increase
    assert.equal(heap.delete(handles[2]), true, kind.name);
    assert.equal(heap.validate(), true, kind.name);
    assert.deepEqual(drain(heap), [5, 20, 40], kind.name);
    assert.equal(heap.hasValueIndex, false, `${kind.name} handle path never builds the index`);

    // Duplicate values: each handle targets its own node.
    const dup = kind.create();
    const first = dup.push(7);
    const second = dup.push(7);
    assert.equal(dup.decreaseKey(first, 1), true);
    assert.equal(dup.delete(second), true);
    assert.deepEqual(drain(dup), [1]);
  }
});

test("stale handles return false and foreign handles throw TypeError", () => {
  for (const kind of handleKinds) {
    const heap = kind.create();
    const popped = heap.push(1);
    const deleted = heap.push(2);
    const kept = heap.push(3);
    heap.pop();
    heap.delete(deleted);
    assert.equal(heap.decreaseKey(popped, 0), false, kind.name);
    assert.equal(heap.delete(popped), false, kind.name);
    assert.equal(heap.decreaseKey(deleted, 0), false, kind.name);
    heap.clear();
    assert.equal(heap.decreaseKey(kept, 0), false, `${kind.name} after clear`);
    const rebuilt = heap.push(4);
    heap.build([8, 9]);
    assert.equal(heap.delete(rebuilt), false, `${kind.name} after build`);
    assert.equal(heap.validate(), true);

    const other = kind.create();
    const foreign = other.push(5);
    assert.throws(() => heap.decreaseKey(foreign, 0), TypeError, kind.name);
    assert.throws(() => heap.delete(foreign), TypeError, kind.name);
    assert.throws(() => heap.delete({ value: 1 } as never), TypeError, kind.name);
    const otherClass = handleKinds.find((entry) => entry.name !== kind.name)!.create();
    const crossClass = otherClass.push(5);
    assert.throws(() => heap.decreaseKey(crossClass as never, 0), TypeError, kind.name);
    assert.deepEqual(drain(heap), [8, 9]);
  }
});

test("handles survive merges and refer to the receiving heap", () => {
  for (const kind of handleKinds) {
    // A chain of merges: every heap is melded into the next, so owners nest repeatedly.
    let receiver = kind.create(numeric);
    const handles: Array<ReturnType<HandleHeap["push"]>> = [];
    const consumed: HandleHeap[] = [];
    for (let round = 0; round < 30; round++) {
      const next = kind.create(numeric);
      handles.push(next.push(1000 + round));
      handles.push(receiver.push(2000 + round));
      if (round % 2 === 0) {
        next.merge(receiver);
        consumed.push(receiver);
        receiver = next;
      } else {
        receiver.merge(next);
        consumed.push(next);
      }
    }
    for (let index = 0; index < handles.length; index++) {
      assert.equal(receiver.decreaseKey(handles[index], index), true, `${kind.name} handle ${index}`);
    }
    assert.equal(receiver.validate(), true);
    assert.equal(receiver.delete(handles[3]), true);
    assert.deepEqual(drain(receiver), Array.from({ length: 60 }, (_, index) => index).filter((v) => v !== 3));
    for (const heap of consumed) {
      assert.throws(() => heap.decreaseKey(handles[0], -1), ConsumedError, kind.name);
      assert.throws(() => heap.delete(handles[0]), ConsumedError, kind.name);
    }
  }
});

test("same-class merge does O(1) work when neither heap has a value index", () => {
  for (const kind of handleKinds) {
    for (const size of [10, 10_000]) {
      let comparisons = 0;
      const counting: Comparator<number> = (a, b) => {
        comparisons++;
        return a - b;
      };
      const left = kind.create(counting);
      const right = kind.create(counting);
      for (let index = 0; index < size; index++) {
        left.push(index * 2);
        right.push(index * 2 + 1);
      }
      comparisons = 0;
      const start = performance.now();
      left.merge(right);
      const elapsed = performance.now() - start;
      assert.ok(comparisons <= 1, `${kind.name} size ${size}: ${comparisons} comparisons`);
      assert.ok(elapsed < 5, `${kind.name} size ${size}: merge took ${elapsed.toFixed(2)}ms`);
      assert.equal(left.hasValueIndex, false);
      assert.equal(left.size, size * 2);
    }
  }
});

test("value-based decreaseKey builds the index lazily and keeps its semantics across merges", () => {
  for (const kind of handleKinds) {
    const heap = kind.create(numeric);
    heap.push(4);
    heap.push(4);
    assert.equal(heap.hasValueIndex, false);
    assert.equal(heap.decreaseKey(4, 1), true); // most recently pushed 4
    assert.equal(heap.hasValueIndex, true);
    assert.equal(heap.validate(), true);

    const unindexed = kind.create(numeric);
    unindexed.push(4);
    unindexed.push(6);
    heap.merge(unindexed); // indexed + unindexed: the other side is indexed during the merge
    assert.equal(heap.hasValueIndex, true);
    assert.equal(heap.validate(), true);
    assert.equal(heap.decreaseKey(4, 2), true); // newest 4 came from the merged heap
    assert.equal(heap.decreaseKey(4, 3), true); // then the original remaining 4
    assert.equal(heap.decreaseKey(4, 0), false);
    assert.equal(heap.decreaseKey(6, 5), true);
    assert.deepEqual(drain(heap), [1, 2, 3, 5]);
  }
});
