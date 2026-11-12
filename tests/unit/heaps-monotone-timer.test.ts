import test from "node:test";
import assert from "node:assert/strict";
import {
  BucketQueue,
  CalendarQueue,
  RadixHeap,
  TimingWheel,
} from "../../src/index.ts";

interface Item {
  key: number;
  name: string;
}

function itemKey(value: Item): number {
  return value.key;
}

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function names(values: Item[]): string[] {
  return values.map((value) => value.name);
}

test("BucketQueue orders by integer key and enforces monotone pushes", () => {
  const queue = new BucketQueue<Item>(itemKey, 20);
  assert.equal(queue.peek(), undefined);
  assert.equal(queue.pop(), undefined);
  assert.equal(queue.maxKey, 20);
  queue.push({ key: 5, name: "five" });
  queue.push({ key: 1, name: "one" });
  queue.push({ key: 20, name: "twenty" });
  queue.push({ key: 5, name: "five-b" });
  assert.equal(queue.validate(), true);
  assert.equal(queue.peek()?.key, 1);
  assert.equal(queue.size, 4);
  const one = queue.pop();
  assert.equal(one?.name, "one");
  assert.equal(queue.validate(), true);
  assert.throws(() => queue.push({ key: 0, name: "zero" }), RangeError);
  queue.push({ key: 2, name: "two" });
  assert.equal(queue.peek()?.key, 2);

  const popped: string[] = [];
  while (!queue.isEmpty()) {
    const value = queue.pop();
    assert.equal(queue.validate(), true);
    if (value !== undefined) {
      popped.push(value.name);
    }
  }
  assert.deepEqual(popped, ["two", "five-b", "five", "twenty"]);
  assert.throws(() => queue.push({ key: -1, name: "negative" }), RangeError);
  assert.throws(() => queue.push({ key: 21, name: "large" }), RangeError);
  assert.throws(() => queue.push({ key: 1.5, name: "fraction" }), TypeError);
});

test("BucketQueue decreaseKey, build, and serialization", () => {
  const queue = new BucketQueue<Item>(itemKey, 30);
  const a: Item = { key: 5, name: "a" };
  const b: Item = { key: 15, name: "b" };
  const c: Item = { key: 25, name: "c" };
  queue.build([a, b, c]);
  assert.equal(queue.validate(), true);
  assert.equal(queue.decreaseKey(b, 2), true);
  b.key = 2;
  assert.equal(queue.validate(), true);
  assert.equal(queue.peek()?.name, "b");
  assert.equal(queue.decreaseKey(b, 20), false);
  assert.equal(queue.decreaseKey({ key: 15, name: "missing" } as Item, 1), false);
  assert.equal(queue.size, 3);

  const restored = BucketQueue.deserialize<Item>(queue.serialize(), itemKey);
  assert.equal(restored.validate(), true);
  assert.equal(restored.peek()?.name, "b");
  assert.equal(restored.pop()?.key, 2);
  assert.equal(restored.validate(), true);
  restored.clear();
  assert.equal(restored.size, 0);
  assert.equal(restored.validate(), true);
});

test("RadixHeap orders, peeks, and decreases keys", () => {
  const queue = new RadixHeap<Item>(itemKey, 1000);
  assert.equal(queue.peek(), undefined);
  const hundred: Item = { key: 100, name: "hundred" };
  const one: Item = { key: 1, name: "one" };
  const fiveHundred: Item = { key: 500, name: "five hundred" };
  const seven: Item = { key: 7, name: "seven" };
  const thousand: Item = { key: 1000, name: "thousand" };
  for (const value of [hundred, one, fiveHundred, seven, thousand]) {
    queue.push(value);
    assert.equal(queue.validate(), true);
  }
  assert.equal(queue.peek()?.key, 1);
  assert.equal(queue.peek()?.key, 1);
  assert.equal(queue.validate(), true);
  assert.equal(queue.decreaseKey(fiveHundred, 3), true);
  fiveHundred.key = 3;
  assert.equal(queue.validate(), true);
  assert.equal(queue.peek()?.key, 1);
  const values: number[] = [];
  while (!queue.isEmpty()) {
    const value = queue.pop();
    assert.equal(queue.validate(), true);
    values.push(value?.key as number);
  }
  assert.deepEqual(values, [1, 3, 7, 100, 1000]);
});

test("RadixHeap rejects invalid monotone operations and round-trips", () => {
  const queue = new RadixHeap<Item>(itemKey, 50);
  const twenty: Item = { key: 20, name: "twenty" };
  const thirty: Item = { key: 30, name: "thirty" };
  queue.push({ key: 10, name: "ten" });
  queue.push(twenty);
  queue.push(thirty);
  assert.equal(queue.pop()?.key, 10);
  assert.throws(() => queue.push({ key: 9, name: "nine" }), RangeError);
  assert.throws(() => queue.decreaseKey(twenty, 5), RangeError);
  assert.equal(queue.validate(), true);
  assert.equal(queue.decreaseKey(thirty, 15), true);
  thirty.key = 15;
  assert.equal(queue.validate(), true);
  const json = queue.serialize();
  const restored = RadixHeap.deserialize<Item>(json, itemKey);
  assert.equal(restored.validate(), true);
  assert.deepEqual(restored.toArray().map((value) => value.key).sort((a, b) => a - b), [15, 20]);
  assert.equal(restored.pop()?.key, 15);
  assert.equal(restored.pop()?.key, 20);
  assert.equal(restored.pop(), undefined);
});

test("BucketQueue and RadixHeap match a sorted reference over Dijkstra-like traces", () => {
  for (const kind of ["bucket", "radix"] as const) {
    const random = seeded(kind === "bucket" ? 17 : 29);
    const maxKey = 200;
    const queue =
      kind === "bucket"
        ? new BucketQueue<Item>(itemKey, maxKey)
        : new RadixHeap<Item>(itemKey, maxKey);
    let reference: Item[] = [];
    let lastPopped = -1;
    for (let step = 0; step < 400; step++) {
      if (reference.length === 0 || random() < 0.7) {
        const key = Math.max(0, lastPopped + Math.floor(random() * 20));
        const item: Item = { key, name: `k${key}-${step}` };
        queue.push(item);
        reference.push(item);
      } else {
        reference.sort((a, b) => a.key - b.key);
        const expected = reference[0];
        const actual = queue.pop();
        assert.equal(actual?.key, expected.key, kind);
        const index = reference.indexOf(actual as Item);
        assert.notEqual(index, -1, kind);
        reference.splice(index, 1);
        lastPopped = (actual as Item).key;
      }
      if (reference.length > 0 && random() < 0.2) {
        reference.sort((a, b) => a.key - b.key);
        const target = reference[Math.floor(random() * reference.length)];
        const newKey = Math.max(lastPopped, target.key - Math.floor(random() * 5));
        const changed = queue.decreaseKey(target, newKey);
        assert.equal(changed, true, kind);
        target.key = newKey;
      }
      assert.equal(queue.size, reference.length, kind);
      assert.equal(queue.validate(), true, kind);
      const expectedPeek = reference.length === 0 ? undefined : Math.min(...reference.map((value) => value.key));
      assert.equal(queue.peek()?.key, expectedPeek, kind);
    }
    reference.sort((a, b) => a.key - b.key);
    const drained: number[] = [];
    while (!queue.isEmpty()) {
      const value = queue.pop();
      drained.push((value as Item).key);
      assert.equal(queue.validate(), true, kind);
    }
    assert.deepEqual(drained, reference.map((value) => value.key), kind);
  }
});

test("CalendarQueue delivers events in time and scheduling order", () => {
  const queue = new CalendarQueue<string>({ bucketCount: 8, bucketWidth: 1 });
  assert.equal(queue.now, 0);
  assert.equal(queue.peekTime(), undefined);
  const first = queue.schedule(5, "five-a");
  const second = queue.schedule(3, "three-a");
  queue.schedule(3, "three-b");
  queue.schedule(9, "nine");
  assert.equal(queue.peekTime(), 3);
  assert.deepEqual(queue.advance(4), ["three-a", "three-b"]);
  assert.equal(queue.now, 4);
  assert.equal(queue.validate(), true);
  assert.deepEqual(queue.advance(5), ["five-a"]);
  assert.equal(queue.validate(), true);
  assert.equal(queue.cancel(second), false);
  assert.equal(queue.cancel(first), false);
  assert.deepEqual(queue.advance(9), ["nine"]);
  assert.equal(queue.peekTime(), undefined);
  assert.throws(() => queue.schedule(8, "past"), RangeError);
  assert.throws(() => queue.advance(8), RangeError);
  assert.equal(queue.validate(), true);
});

test("CalendarQueue cancellation, peekTime, and serialization", () => {
  const queue = new CalendarQueue<number>({ bucketCount: 4, bucketWidth: 2 });
  const a = queue.schedule(10, 10);
  queue.schedule(12, 12);
  queue.schedule(11, 11);
  assert.equal(queue.peekTime(), 10);
  assert.equal(queue.cancel(a), true);
  assert.equal(queue.peekTime(), 11);
  assert.equal(queue.cancel(a), false);
  assert.equal(queue.validate(), true);

  const restored = CalendarQueue.deserialize<number>(queue.serialize());
  assert.equal(restored.validate(), true);
  assert.equal(restored.now, 0);
  assert.equal(restored.peekTime(), 11);
  assert.deepEqual(restored.advance(12), [11, 12]);
  assert.equal(restored.validate(), true);
  restored.clear();
  assert.equal(restored.size, 0);
  assert.equal(restored.peekTime(), undefined);
  assert.equal(restored.validate(), true);
});

test("CalendarQueue crosses years and handles overflow", () => {
  const queue = new CalendarQueue<number>({ bucketCount: 4, bucketWidth: 1 });
  queue.schedule(1000, 1000);
  queue.schedule(2, 2);
  queue.schedule(3, 3);
  queue.schedule(500, 500);
  assert.equal(queue.validate(), true);
  assert.deepEqual(queue.advance(10), [2, 3]);
  assert.deepEqual(queue.advance(1000), [500, 1000]);
  assert.equal(queue.validate(), true);
  for (let index = 0; index < 40; index++) {
    queue.schedule(1000 + index * 50, index);
  }
  assert.equal(queue.validate(), true);
  assert.deepEqual(queue.advance(3000), Array.from({ length: 40 }, (_, index) => index));
  assert.equal(queue.validate(), true);
});

test("CalendarQueue matches a reference schedule over random operations", () => {
  const random = seeded(41);
  const queue = new CalendarQueue<number>({ bucketCount: 8, bucketWidth: 1 });
  interface ReferenceEvent {
    id: number;
    time: number;
    seq: number;
    value: number;
    active: boolean;
  }
  const events: ReferenceEvent[] = [];
  let now = 0;
  let seq = 0;
  for (let step = 0; step < 350; step++) {
    const operation = random();
    if (operation < 0.55) {
      const time = now + Math.floor(random() * 80);
      const value = seq;
      const id = queue.schedule(time, value);
      events.push({ id, time, seq, value, active: true });
      seq++;
    } else if (operation < 0.68) {
      const active = events.filter((event) => event.active);
      if (active.length > 0) {
        const target = active[Math.floor(random() * active.length)];
        assert.equal(queue.cancel(target.id), true);
        target.active = false;
      }
    } else {
      const advanced = Math.min(now + Math.floor(random() * 4), now + 1000);
      const due = events
        .filter((event) => event.active && event.time <= advanced)
        .sort((a, b) => a.time - b.time || a.seq - b.seq);
      assert.deepEqual(queue.advance(advanced), due.map((event) => event.value));
      for (const event of due) {
        event.active = false;
      }
      now = advanced;
    }
    const active = events.filter((event) => event.active);
    assert.equal(queue.size, active.length);
    assert.equal(queue.now, now);
    const expectedPeek = active.length === 0 ? undefined : Math.min(...active.map((event) => event.time));
    assert.equal(queue.peekTime(), expectedPeek);
    assert.equal(queue.validate(), true, `step ${step}`);
  }
});

test("TimingWheel delivers events in time and scheduling order", () => {
  const queue = new TimingWheel<string>({ tickSize: 1, slots: 8, levels: 3 });
  assert.equal(queue.now, 0);
  assert.equal(queue.peekTime(), undefined);
  queue.schedule(5, "five");
  queue.schedule(3, "three-a");
  queue.schedule(3, "three-b");
  queue.schedule(20, "twenty");
  assert.equal(queue.peekTime(), 3);
  assert.deepEqual(queue.advance(4), ["three-a", "three-b"]);
  assert.equal(queue.now, 4);
  assert.equal(queue.validate(), true);
  assert.deepEqual(queue.advance(5), ["five"]);
  assert.equal(queue.validate(), true);
  assert.deepEqual(queue.advance(20), ["twenty"]);
  assert.equal(queue.validate(), true);
  assert.throws(() => queue.schedule(19, "past"), RangeError);
  assert.throws(() => queue.advance(19), RangeError);
  assert.equal(queue.peekTime(), undefined);
});

test("TimingWheel cancels, serializes, and penetrates coarse ticks", () => {
  const queue = new TimingWheel<number>({ tickSize: 2, slots: 8, levels: 3 });
  const cancelled = queue.schedule(10, 10);
  queue.schedule(11, 11);
  queue.schedule(30, 30);
  assert.equal(queue.peekTime(), 10);
  assert.equal(queue.cancel(cancelled), true);
  assert.equal(queue.cancel(cancelled), false);
  assert.equal(queue.peekTime(), 11);
  assert.deepEqual(queue.advance(10), []);
  assert.deepEqual(queue.advance(12), [11]);
  assert.equal(queue.validate(), true);

  const restored = TimingWheel.deserialize<number>(queue.serialize());
  assert.equal(restored.validate(), true);
  assert.equal(restored.peekTime(), 30);
  assert.deepEqual(restored.advance(30), [30]);
  assert.equal(restored.validate(), true);
  restored.clear();
  assert.equal(restored.validate(), true);
});

test("TimingWheel handles far-future scheduling and fast-forward", () => {
  const queue = new TimingWheel<number>({ tickSize: 1, slots: 8, levels: 2 });
  queue.schedule(2_000_005, 5);
  queue.schedule(1, 1);
  assert.equal(queue.validate(), true);
  assert.deepEqual(queue.advance(9), [1]);
  assert.equal(queue.validate(), true);
  assert.deepEqual(queue.advance(2_000_005), [5]);
  assert.equal(queue.validate(), true);
  assert.equal(queue.size, 0);
});

test("TimingWheel matches a reference schedule over random operations", () => {
  const random = seeded(53);
  const queue = new TimingWheel<number>({ tickSize: 1, slots: 16, levels: 4 });
  interface ReferenceEvent {
    id: number;
    time: number;
    seq: number;
    value: number;
    active: boolean;
  }
  const events: ReferenceEvent[] = [];
  let now = 0;
  let seq = 0;
  for (let step = 0; step < 400; step++) {
    const operation = random();
    if (operation < 0.55) {
      const time = now + Math.floor(random() * 120);
      const value = seq;
      const id = queue.schedule(time, value);
      events.push({ id, time, seq, value, active: true });
      seq++;
    } else if (operation < 0.68) {
      const active = events.filter((event) => event.active);
      if (active.length > 0) {
        const target = active[Math.floor(random() * active.length)];
        assert.equal(queue.cancel(target.id), true);
        target.active = false;
      }
    } else {
      const advanced = now + Math.floor(random() * 3);
      const due = events
        .filter((event) => event.active && event.time <= advanced)
        .sort((a, b) => a.time - b.time || a.seq - b.seq);
      assert.deepEqual(queue.advance(advanced), due.map((event) => event.value));
      for (const event of due) {
        event.active = false;
      }
      now = advanced;
    }
    const active = events.filter((event) => event.active);
    assert.equal(queue.size, active.length);
    assert.equal(queue.now, now);
    const expectedPeek = active.length === 0 ? undefined : Math.min(...active.map((event) => event.time));
    assert.equal(queue.peekTime(), expectedPeek);
    assert.equal(queue.validate(), true, `step ${step}`);
  }
});
