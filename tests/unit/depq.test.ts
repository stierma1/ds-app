import test from "node:test";
import assert from "node:assert/strict";
import {
  BalancedTreeDepq,
  ConcurrentModificationError,
  Deap,
  IntervalHeap,
  MinMaxHeap,
  SortedArrayDepq,
  SymmetricMinMaxHeap,
  TwoHeapDepq,
} from "../../src/index.ts";
import type { Depq } from "../../src/depq/types.ts";

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function ascending(values: readonly number[]): number[] {
  return [...values].sort((left, right) => left - right);
}

function drainMin(queue: Depq<number>): number[] {
  const values: number[] = [];
  while (!queue.isEmpty()) {
    values.push(queue.popMin() as number);
    assert.equal(queue.validate(), true);
  }
  return values;
}

interface Factory {
  name: string;
  create(): Depq<number>;
  deserialize(json: unknown): Depq<number>;
}

const factories: Factory[] = [
  {
    name: "MinMaxHeap",
    create: () => new MinMaxHeap<number>((a, b) => a - b),
    deserialize: (json) => MinMaxHeap.deserialize<number>(json, (a, b) => a - b),
  },
  {
    name: "Deap",
    create: () => new Deap<number>((a, b) => a - b),
    deserialize: (json) => Deap.deserialize<number>(json, (a, b) => a - b),
  },
  {
    name: "IntervalHeap",
    create: () => new IntervalHeap<number>((a, b) => a - b),
    deserialize: (json) =>
      IntervalHeap.deserialize<number>(json, (a, b) => a - b),
  },
  {
    name: "SymmetricMinMaxHeap",
    create: () => new SymmetricMinMaxHeap<number>((a, b) => a - b),
    deserialize: (json) =>
      SymmetricMinMaxHeap.deserialize<number>(json, (a, b) => a - b),
  },
  {
    name: "TwoHeapDepq",
    create: () => new TwoHeapDepq<number>((a, b) => a - b),
    deserialize: (json) =>
      TwoHeapDepq.deserialize<number>(json, (a, b) => a - b),
  },
  {
    name: "SortedArrayDepq",
    create: () => new SortedArrayDepq<number>((a, b) => a - b),
    deserialize: (json) =>
      SortedArrayDepq.deserialize<number>(json, (a, b) => a - b),
  },
  {
    name: "BalancedTreeDepq",
    create: () => new BalancedTreeDepq<number>((a, b) => a - b),
    deserialize: (json) =>
      BalancedTreeDepq.deserialize<number>(json, (a, b) => a - b),
  },
];

for (const factory of factories) {
  test(`${factory.name} implements the DEPQ contract`, () => {
    const queue = factory.create();
    assert.equal(queue.size, 0);
    assert.equal(queue.isEmpty(), true);
    assert.equal(queue.peekMin(), undefined);
    assert.equal(queue.peekMax(), undefined);
    assert.equal(queue.getMin(), undefined);
    assert.equal(queue.getMax(), undefined);
    assert.equal(queue.popMin(), undefined);
    assert.equal(queue.popMax(), undefined);
    assert.equal(queue.height, 0);
    assert.equal(queue.validate(), true);

    for (const value of [5, 1, 4, 2, 3, 3]) {
      queue.push(value);
      assert.equal(queue.validate(), true, `${factory.name} after push ${value}`);
      assert.equal(Number.isInteger(queue.height), true);
      assert.equal(queue.height >= 0, true);
    }
    assert.equal(queue.size, 6);
    assert.equal(queue.peekMin(), 1);
    assert.equal(queue.peekMax(), 5);
    assert.equal(queue.getMin(), 1);
    assert.equal(queue.getMax(), 5);
    assert.deepEqual(ascending(queue.toArray()), [1, 2, 3, 3, 4, 5]);
    assert.deepEqual(drainMin(queue), [1, 2, 3, 3, 4, 5]);
    assert.equal(queue.validate(), true);
    assert.equal(queue.height, 0);
    assert.throws(() => queue.push(undefined as never), TypeError);
  });

  test(`${factory.name} drains from both ends in sorted order`, () => {
    const random = seeded(factory.name.length * 41);
    const queue = factory.create();
    const reference: number[] = [];
    for (let step = 0; step < 400; step++) {
      if (reference.length === 0 || random() < 0.55) {
        const value = Math.floor(random() * 100);
        queue.push(value);
        reference.push(value);
        reference.sort((a, b) => a - b);
      } else if (random() < 0.5) {
        assert.equal(queue.popMin(), reference.shift());
      } else {
        assert.equal(queue.popMax(), reference.pop());
      }
      assert.equal(queue.size, reference.length);
      assert.equal(queue.validate(), true, `${factory.name} step ${step}`);
      if (reference.length > 0) {
        assert.equal(queue.peekMin(), reference[0]);
        assert.equal(queue.peekMax(), reference[reference.length - 1]);
      }
    }
    assert.deepEqual(drainMin(queue), reference);
  });

  test(`${factory.name} single element is removed from either end once`, () => {
    const minFirst = factory.create();
    minFirst.push(42);
    assert.equal(minFirst.peekMin(), 42);
    assert.equal(minFirst.peekMax(), 42);
    assert.equal(minFirst.popMin(), 42);
    assert.equal(minFirst.size, 0);
    assert.equal(minFirst.popMax(), undefined);
    assert.equal(minFirst.validate(), true);

    const maxFirst = factory.create();
    maxFirst.push(7);
    assert.equal(maxFirst.popMax(), 7);
    assert.equal(maxFirst.size, 0);
    assert.equal(maxFirst.popMin(), undefined);
    assert.equal(maxFirst.validate(), true);
  });

  test(`${factory.name} build replaces contents and matches repeated insertion`, () => {
    const queue = factory.create();
    queue.push(100);
    queue.push(200);
    queue.build([7, 1, 5, 2, 9, 3, 3]);
    assert.equal(queue.size, 7);
    assert.equal(queue.validate(), true);
    assert.equal(queue.peekMin(), 1);
    assert.equal(queue.peekMax(), 9);

    const repeated = factory.create();
    for (const value of [7, 1, 5, 2, 9, 3, 3]) {
      repeated.push(value);
    }
    assert.deepEqual(drainMin(queue), drainMin(repeated));

    queue.build([4, 2, 8, 1]);
    assert.equal(queue.validate(), true);
    assert.deepEqual(drainMin(queue), [1, 2, 4, 8]);

    queue.build([]);
    assert.equal(queue.size, 0);
    assert.equal(queue.validate(), true);

    queue.push(0);
    assert.throws(() => queue.build([1, undefined as never, 2]), TypeError);
    assert.equal(queue.size, 1);
    assert.equal(queue.peekMin(), 0);
    assert.equal(queue.validate(), true);
  });

  test(`${factory.name} serialization round-trips`, () => {
    const queue = factory.create();
    queue.build([4, 2, 8, 1]);
    const serialized = JSON.parse(queue.serialize()) as {
      type: string;
      version: number;
      values: number[];
    };
    assert.equal(serialized.type, factory.name);
    assert.equal(serialized.version, 1);
    assert.deepEqual(ascending(serialized.values), [1, 2, 4, 8]);

    const restored = factory.deserialize(queue.serialize());
    assert.equal(restored.validate(), true);
    assert.equal(restored.size, 4);
    assert.deepEqual(drainMin(restored), [1, 2, 4, 8]);

    assert.throws(
      () =>
        factory.deserialize({ type: "UnknownType", version: 1, values: [] }),
      TypeError,
    );
    assert.throws(
      () => factory.deserialize({ type: factory.name, version: 2, values: [] }),
      TypeError,
    );
    assert.throws(
      () =>
        factory.deserialize({
          type: factory.name,
          version: 1,
          values: [1, undefined],
        }),
      TypeError,
    );
  });

  test(`${factory.name} supports a reversed comparator and snapshot iteration`, () => {
    const queue = factory.create();
    const reversed = new (queue.constructor as new (
      compare: (a: number, b: number) => number,
    ) => Depq<number>)((a, b) => b - a);
    [5, 1, 9, 3].forEach((value) => reversed.push(value));
    assert.equal(reversed.peekMin(), 9);
    assert.equal(reversed.peekMax(), 1);
    assert.deepEqual(drainMin(reversed), [9, 5, 3, 1]);

    queue.build([3, 1, 2]);
    const snapshot = [...queue];
    assert.deepEqual(ascending(snapshot), [1, 2, 3]);
    const iterator = queue[Symbol.iterator]();
    queue.push(4);
    assert.throws(() => iterator.next(), ConcurrentModificationError);

    queue.clear();
    assert.equal(queue.size, 0);
    assert.equal(queue.validate(), true);
    assert.deepEqual([...queue], []);
  });
}

test("MinMaxHeap preserves the level ordering under long monotone input", () => {
  const queue = new MinMaxHeap<number>();
  const count = 10_000;
  for (let value = count; value >= 1; value--) {
    queue.push(value);
  }
  assert.equal(queue.size, count);
  assert.equal(queue.validate(), true);
  assert.equal(queue.peekMin(), 1);
  assert.equal(queue.peekMax(), count);
  let previous = 0;
  while (!queue.isEmpty()) {
    const value = queue.popMin() as number;
    assert.equal(value, previous + 1);
    previous = value;
  }
  assert.equal(queue.validate(), true);
});

test("Deap maintains the corresponding-node relation on random workloads", () => {
  const random = seeded(0xdea9);
  const queue = new Deap<number>();
  for (let step = 0; step < 2000; step++) {
    queue.push(Math.floor(random() * 1000));
    assert.equal(queue.validate(), true, `push step ${step}`);
    if (random() < 0.4) {
      queue.popMin();
      assert.equal(queue.validate(), true, `popMin step ${step}`);
    }
    if (random() < 0.4) {
      queue.popMax();
      assert.equal(queue.validate(), true, `popMax step ${step}`);
    }
  }
});

test("IntervalHeap handles the single last node across insertions and deletions", () => {
  const queue = new IntervalHeap<number>();
  const reference: number[] = [];
  for (let value = 1; value <= 40; value++) {
    queue.push(value);
    reference.push(value);
    assert.equal(queue.validate(), true);
    if (value % 3 === 0) {
      queue.popMin();
      reference.shift();
      assert.equal(queue.validate(), true);
    }
    if (value % 5 === 0) {
      queue.popMax();
      reference.pop();
      assert.equal(queue.validate(), true);
    }
    if (reference.length > 0) {
      assert.equal(queue.peekMin(), reference[0]);
      assert.equal(queue.peekMax(), reference[reference.length - 1]);
    }
  }
  assert.deepEqual(drainMin(queue), reference);
});

test("TwoHeapDepq keeps stale entries out of iteration and size", () => {
  const queue = new TwoHeapDepq<number>();
  queue.build([5, 1, 9, 3, 7]);
  assert.equal(queue.popMin(), 1);
  assert.equal(queue.popMax(), 9);
  assert.equal(queue.size, 3);
  assert.deepEqual(ascending(queue.toArray()), [3, 5, 7]);
  assert.equal(queue.validate(), true);
});

test("validate detects corrupted state in every implementation", () => {
  const minMax = new MinMaxHeap<number>();
  minMax.build([1, 2, 3, 4]);
  (minMax as unknown as { _items: number[] })._items[0] = 100;
  assert.notEqual(minMax.validate(), true);

  const deap = new Deap<number>();
  deap.build([1, 2]);
  (deap as unknown as { _items: number[] })._items[2] = 100;
  assert.notEqual(deap.validate(), true);

  const interval = new IntervalHeap<number>();
  interval.build([1, 2]);
  (interval as unknown as { _nodes: Array<{ low: number }> })._nodes[0].low = 100;
  assert.notEqual(interval.validate(), true);

  const twoHeap = new TwoHeapDepq<number>();
  twoHeap.push(1);
  (twoHeap as unknown as { _size: number })._size = 2;
  assert.notEqual(twoHeap.validate(), true);

  const sorted = new SortedArrayDepq<number>();
  sorted.build([1, 2, 3]);
  (sorted as unknown as { _items: number[] })._items[2] = 0;
  assert.notEqual(sorted.validate(), true);

  const balanced = new BalancedTreeDepq<number>();
  balanced.build([1, 2, 3]);
  (balanced as unknown as { _size: number })._size = 99;
  assert.notEqual(balanced.validate(), true);
});

test("BalancedTreeDepq keeps duplicate multiplicities and AVL balance", () => {
  const queue = new BalancedTreeDepq<number>();
  for (const value of [4, 2, 4, 1, 4, 2, 8, 8, 8]) {
    queue.push(value);
    assert.equal(queue.validate(), true);
  }
  assert.deepEqual(queue.toArray(), [1, 2, 2, 4, 4, 4, 8, 8, 8]);
  assert.equal(queue.popMin(), 1);
  assert.equal(queue.popMax(), 8);
  assert.deepEqual(queue.toArray(), [2, 2, 4, 4, 4, 8, 8]);
  assert.equal(queue.validate(), true);
});

test("BalancedTreeDepq keeps distinct elements that compare equal", () => {
  interface Item {
    k: number;
    id: string;
  }
  const byKey = (a: Item, b: Item): number => a.k - b.k;
  const queue = new BalancedTreeDepq<Item>(byKey);
  queue.push({ k: 1, id: "a" });
  queue.push({ k: 1, id: "b" });
  assert.deepEqual(queue.toArray().map((item) => item.id), ["a", "b"]);
  assert.deepEqual(
    (JSON.parse(queue.serialize()) as { values: Item[] }).values.map((item) => item.id),
    ["a", "b"],
  );
  assert.equal(queue.popMin()?.id, "a");
  assert.equal(queue.popMin()?.id, "b");
  assert.equal(queue.popMin(), undefined);

  // Many ties per key: every pushed object comes back exactly once, oldest-first from the min end
  // and newest-first from the max end, and serialization keeps them all.
  const random = seeded(0xb7ee);
  const pushed: Item[] = [];
  for (let index = 0; index < 600; index++) {
    const item = { k: Math.floor(random() * 4), id: `i${index}` };
    pushed.push(item);
    queue.push(item);
  }
  assert.equal(queue.validate(), true);
  const restored = BalancedTreeDepq.deserialize<Item>(queue.serialize(), byKey);
  assert.deepEqual(
    restored.toArray().map((item) => item.id),
    queue.toArray().map((item) => item.id),
  );
  const stable = [...pushed].sort(byKey);
  assert.deepEqual(queue.toArray(), stable);
  const returned = new Set<Item>();
  let low = 0;
  let high = stable.length - 1;
  while (!queue.isEmpty()) {
    const fromMin = random() < 0.5;
    const item = (fromMin ? queue.popMin() : queue.popMax()) as Item;
    assert.equal(item, fromMin ? stable[low++] : stable[high--]);
    assert.equal(returned.has(item), false);
    returned.add(item);
    assert.equal(queue.validate(), true);
  }
  assert.equal(returned.size, pushed.length);
});

test("TwoHeapDepq bounds stale entries so space stays O(n)", () => {
  const heapsOf = (queue: TwoHeapDepq<number>): [number, number] => {
    const internals = queue as unknown as { _minHeap: unknown[]; _maxHeap: unknown[] };
    return [internals._minHeap.length, internals._maxHeap.length];
  };
  const queue = new TwoHeapDepq<number>();
  for (let index = 0; index < 100_000; index++) {
    queue.push(index);
    assert.equal(queue.popMin(), index);
  }
  assert.equal(queue.size, 0);
  const [minLength, maxLength] = heapsOf(queue);
  assert.equal(minLength + maxLength <= 64, true, `heaps hold ${minLength}+${maxLength} entries`);
  assert.equal(queue.validate(), true);

  const random = seeded(0x2bea);
  const reference: number[] = [];
  for (let step = 0; step < 20_000; step++) {
    if (reference.length === 0 || random() < 0.5) {
      const value = Math.floor(random() * 1000);
      queue.push(value);
      reference.push(value);
      reference.sort((left, right) => left - right);
    } else if (random() < 0.5) {
      assert.equal(queue.popMin(), reference.shift());
    } else {
      assert.equal(queue.popMax(), reference.pop());
    }
    const [minSize, maxSize] = heapsOf(queue);
    assert.equal(minSize <= 2 * queue.size + 32 && maxSize <= 2 * queue.size + 32, true);
    assert.equal(queue.peekMin(), reference[0]);
    assert.equal(queue.peekMax(), reference[reference.length - 1]);
  }
  assert.equal(queue.validate(), true);

  // validate reports a heap that exceeds the stale-entry bound.
  const bloated = new TwoHeapDepq<number>();
  bloated.push(1);
  const internals = bloated as unknown as { _maxHeap: Array<{ value: number; id: number; active: boolean }> };
  for (let index = 0; index < 40; index++) {
    internals._maxHeap.push({ value: 0, id: -index - 1, active: false });
  }
  assert.notEqual(bloated.validate(), true);
});

test("every DEPQ rejects values the default comparator cannot order, even alone", () => {
  const classes = [
    MinMaxHeap,
    Deap,
    IntervalHeap,
    SymmetricMinMaxHeap,
    TwoHeapDepq,
    SortedArrayDepq,
    BalancedTreeDepq,
  ];
  for (const Queue of classes) {
    const queue = new Queue<unknown>();
    assert.throws(() => queue.push(null), TypeError, `${Queue.name} push(null)`);
    assert.throws(() => queue.push({}), TypeError, `${Queue.name} push({})`);
    assert.equal(queue.size, 0);
    queue.push(3);
    assert.throws(() => queue.build([1, null]), TypeError);
    assert.throws(() => queue.build([null]), TypeError);
    assert.deepEqual(queue.toArray(), [3], `${Queue.name} failed build leaves contents unchanged`);
    for (const values of [[null], [null, 1], [{}]]) {
      const json = JSON.stringify({ type: Queue.name, version: 1, values });
      assert.throws(() => Queue.deserialize(json), TypeError, `${Queue.name} ${json}`);
    }
    // An explicit comparator decides what is orderable.
    const nullable = new Queue<number | null>((a, b) => (a ?? -1) - (b ?? -1));
    nullable.push(null);
    nullable.push(2);
    assert.equal(nullable.peekMin(), null);
    assert.equal(nullable.validate(), true);
  }
});

test("SymmetricMinMaxHeap handles sizes 0-4 and odd/even boundaries exactly", () => {
  // Every push order of up to 4 values (with duplicates), drained by every popMin/popMax pattern.
  const pools = [[], [7], [3, 3], [1, 2, 3], [2, 2, 1, 4], [5, 1, 5, 0]];
  const permutations = (values: number[]): number[][] =>
    values.length <= 1
      ? [values]
      : values.flatMap((value, index) =>
          permutations([...values.slice(0, index), ...values.slice(index + 1)]).map((rest) => [value, ...rest]),
        );
  for (const pool of pools) {
    for (const order of permutations(pool)) {
      for (let pattern = 0; pattern < 1 << order.length; pattern++) {
        const queue = new SymmetricMinMaxHeap<number>();
        const reference: number[] = [];
        for (const value of order) {
          queue.push(value);
          reference.push(value);
          reference.sort((left, right) => left - right);
          assert.equal(queue.validate(), true);
          assert.equal(queue.peekMin(), reference[0]);
          assert.equal(queue.peekMax(), reference[reference.length - 1]);
        }
        for (let step = 0; step < order.length; step++) {
          const fromMax = ((pattern >> step) & 1) === 1;
          assert.equal(fromMax ? queue.popMax() : queue.popMin(), fromMax ? reference.pop() : reference.shift());
          assert.equal(queue.validate(), true);
          assert.equal(queue.size, reference.length);
          assert.equal(queue.peekMin(), reference[0]);
          assert.equal(queue.peekMax(), reference[reference.length - 1]);
        }
        assert.equal(queue.popMin(), undefined);
        assert.equal(queue.popMax(), undefined);
      }
    }
  }
  // Height in edges below the empty root, matching Deap: nodes 2-3 are level 0, 4-7 level 1.
  const heights = [0, 0, 0, 1, 1, 1, 1, 2, 2];
  const queue = new SymmetricMinMaxHeap<number>();
  for (let size = 0; size < heights.length; size++) {
    assert.equal(queue.height, heights[size], `height at size ${size}`);
    queue.push(size);
  }
});

test("SymmetricMinMaxHeap with comparator objects, duplicates, and serialization", () => {
  interface Task {
    priority: number;
    name: string;
  }
  const byPriority = (a: Task, b: Task): number => a.priority - b.priority;
  const random = seeded(0x5a11);
  const queue = new SymmetricMinMaxHeap<Task>(byPriority);
  const reference: Task[] = [];
  for (let step = 0; step < 4000; step++) {
    const roll = random();
    if (roll < 0.5 || reference.length === 0) {
      const task = { priority: Math.floor(random() * 8), name: `t${step}` };
      queue.push(task);
      reference.push(task);
    } else {
      reference.sort(byPriority);
      const task = (roll < 0.75 ? queue.popMin() : queue.popMax()) as Task;
      const expected = roll < 0.75 ? reference[0] : reference[reference.length - 1];
      assert.equal(task.priority, (expected as Task).priority);
      reference.splice(reference.indexOf(task), 1);
    }
    if (step % 97 === 0) {
      assert.equal(queue.validate(), true);
      const restored = SymmetricMinMaxHeap.deserialize<Task>(queue.serialize(), byPriority);
      assert.equal(restored.validate(), true);
      assert.deepEqual(restored.toArray(), queue.toArray());
    }
  }
  assert.deepEqual(new Set(queue.toArray()), new Set(reference));
  assert.throws(() => SymmetricMinMaxHeap.deserialize('{"type":"MinMaxHeap","version":1,"values":[]}'), TypeError);
});

test("SymmetricMinMaxHeap validate catches each violated property", () => {
  const corrupt = (mutate: (items: number[]) => void): true | string => {
    const queue = new SymmetricMinMaxHeap<number>();
    queue.build([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.equal(queue.validate(), true);
    mutate((queue as unknown as { _items: number[] })._items);
    return queue.validate();
  };
  // Layout after inserting 1..9: node 2 = 1 (min), node 3 = 9 (max).
  assert.match(String(corrupt((items) => {
    [items[4], items[5]] = [items[5] as number, items[4] as number];
  })), /sibling/);
  assert.notEqual(corrupt((items) => {
    items[2] = 100;
  }), true);
  assert.notEqual(corrupt((items) => {
    items[3] = -100;
  }), true);
  assert.notEqual(corrupt((items) => {
    items.push(10);
  }), true);
});
