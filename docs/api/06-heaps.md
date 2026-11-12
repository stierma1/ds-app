# Part 6 — Heaps

**Module:** `ds-app/heaps` · **Source:** `src/heaps/` · **Status:** done

## Scope

Single-ended priority queues and their indexed variants. Min-max heaps, deaps,
and interval heaps are double-ended structures and are specified in
[Part 7](./07-depq.md); leftist and skew heaps are specified in Parts 4 and 5.
This part defines the shared `PriorityQueue` surface and the heap
implementations that use it.

## Common API

```ts
import type { Container, Comparator, MeldablePriorityQueue } from 'ds-app/core';

export interface Heap<T> extends MeldablePriorityQueue<T> {
  readonly compare: Comparator<T>;
  build(values: Iterable<T>): void;
  readonly height: number;
  merge(other: Heap<T>): Heap<T>;
}

export interface IndexedPriorityQueue<K, V> extends Container<[K, V]> {
  readonly compare: Comparator<K>;
  insert(key: K, value: V): boolean;
  get(key: K): V | undefined;
  has(key: K): boolean;
  delete(key: K): boolean;
  update(key: K, value: V): boolean;
  decreaseKey(key: K, newKey: K): boolean;
  increaseKey(key: K, newKey: K): boolean;
  peek(): [K, V] | undefined;
  pop(): [K, V] | undefined;
  peekKey(): K | undefined;
}

export interface MonotonePriorityQueue<T> extends PriorityQueue<T> {
  readonly key: (value: T) => number;
  readonly maxKey: number;
  decreaseKey(value: T, newKey: number): boolean;
}

export interface TimerQueue<T> extends Container<T> {
  readonly now: number;
  schedule(time: number, value: T): number;
  cancel(id: number): boolean;
  advance(time: number): T[];
  peekTime(): number | undefined;
}

export interface DaryHeapOptions {
  arity?: number;
}

export interface CalendarQueueOptions {
  bucketCount?: number;
  bucketWidth?: number;
  now?: number;
}

export interface TimingWheelOptions {
  tickSize?: number;
  slots?: number;
  levels?: number;
  now?: number;
}
```

`Heap` extends the shared
[`MeldablePriorityQueue`](./00-common-contract.md#meldable-priority-queue)
contract for `push`, `pop`, `peek`, and `merge`. `IndexedPriorityQueue` keys the heap by `K` and
stores a satellite `V`; `decreaseKey`/`increaseKey` return `false` when the new
key would violate the requested direction.

### Semantics

- `build(values)` replaces the contents in O(n) where supported; it is not
  additive.
- `merge` is destructive and consumes `other`; implementations that cannot
  merge cheaply rebuild in O(n). `IndexedBinaryHeap` does not support `merge`
  and throws `UnsupportedError`.
- `height` is the number of edges on the longest root-to-leaf path.
- Ties are broken arbitrarily; heaps are not stable.
- Iteration and `toArray()` use implementation-defined heap order, not sorted
  order.
- `IndexedPriorityQueue` maintains a key-to-position index so `get`, `has`,
  `update`, `delete`, `decreaseKey`, and `increaseKey` find a key in O(1)
  before sifting.
- `MonotonePriorityQueue` holds integer keys in `[0, maxKey]` and requires
  keys to be popped in non-decreasing order: a `push` with a key smaller than
  the last popped key throws `RangeError`. It serves Dijkstra-style workloads.
- `TimerQueue` holds events keyed by time for discrete-event simulation and
  timeouts. `schedule` returns a cancellation id; scheduling before `now`
  throws `RangeError`. `advance(t)` sets `now = t` and returns every event
  with time `<= t` in non-decreasing time order, ties by scheduling order.
- `validate()` checks heap order, index consistency, and size.
- `PairingHeap` and `FibonacciHeap` expose `decreaseKey(value, newValue)` for values unique by identity; it targets the most recently pushed node holding that value. `BucketQueue` and `RadixHeap` expose the monotone `decreaseKey(value, newKey)` with the same identity rule, cancelling the old entry and inserting the replacement.
- `DaryHeap` defaults to arity 4. `CalendarQueue` defaults to 32 buckets of width 1, and `TimingWheel` defaults to tick size 1, 64 slots, and 4 levels; both grow their geometry as events arrive.
- With `tickSize > 1`, the timing wheel quantizes event times to tick boundaries at or after the requested time, so an event is delivered when `now` reaches its tick boundary.

## Implementations and complexity

| Implementation | `push` | `pop` | `peek` | `decreaseKey` | `merge` | `build` | Space |
|----------------|--------|-------|--------|---------------|--------|---------|-------|
| `BinaryHeap` | O(log n) | O(log n) | O(1) | O(log n) indexed | O(n) | O(n) | O(n) |
| `DaryHeap` (d-ary) | O(log_d n) | O(d·log_d n) | O(1) | O(log_d n) indexed | O(n) | O(n) | O(n) |
| `PairingHeap` | O(1) | O(log n) amortized | O(1) | O(log n) amortized | O(1) | O(n) | O(n) |
| `BinomialHeap` | O(1) amortized | O(log n) | O(log n), O(1) with min pointer | O(log n) | O(log n) | O(n) | O(n) |
| `FibonacciHeap` | O(1) | O(log n) amortized | O(1) | O(1) amortized | O(1) | O(n) | O(n) |
| `IndexedBinaryHeap` | O(log n) | O(log n) | O(1) | O(log n) | — | O(n) | O(n) |
| `SortedArrayHeap` | O(n) | O(1) with a head index | O(1) | O(n) | O(n) | O(n log n) | O(n) |
| `BucketQueue` (Dial, monotone) | O(1) | O(1) amortized over a monotone sequence, O(C) worst | O(1) amortized | O(1) | — | O(n + C) | O(n + C) |
| `RadixHeap` (monotone) | O(1) | O(log C) amortized | O(1) | O(1) amortized | — | O(n) | O(n + log C) |
| `CalendarQueue` (timer) | O(1) amortized | O(1) amortized under a stable event-time distribution, O(n) worst | O(1) | — | — | O(n) | O(n + buckets) |
| `TimingWheel` (hierarchical timer) | O(1) | O(1) amortized per tick, O(levels) per cascade | O(1) | — | — | O(n) | O(n + slots) |

Definitions: `n` = number of elements, `d` = arity, `C` = maximum integer key
of a monotone queue. `merge` is the cost of
merging two heaps; only the meldable implementations support it cheaply, and it
is destructive.

### Indexed operations

`IndexedBinaryHeap` supports the full `IndexedPriorityQueue` contract:

| Operation | Cost | Notes |
|-----------|------|-------|
| `insert` | O(log n) | Rejects a duplicate key and returns `false`. |
| `get` / `has` | O(1) | Direct index map lookup. |
| `delete` | O(log n) | Removes by key. |
| `update` | O(log n) | Replaces the satellite value. |
| `decreaseKey` | O(log n) | Sift up. |
| `increaseKey` | O(log n) | Sift down. |
| `peek` / `pop` | O(1) / O(log n) | Pops the minimum entry. |

### Notes

- `BinaryHeap` uses 0-based array storage and Floyd's bottom-up `build`.
- `DaryHeap` trades shallower height for more comparisons per sift; `d = 4` is
  a common cache-friendly choice.
- `PairingHeap` is a simple meldable heap with good practical performance;
  its bounds are amortized.
- `BinomialHeap` represents the heap as a forest of binomial trees; `merge`
  combines trees of equal order.
- `FibonacciHeap` uses lazy consolidation; `decreaseKey` cuts nodes and defers
  restructuring to `pop`.
- `SortedArrayHeap` is a teaching/reference implementation with O(1) `peek`
  and O(1) `pop` from the front, at the cost of O(n) insertion.
- `BucketQueue` keeps one bucket per integer key and a cursor that only moves
  forward; `pop` advances the cursor to the next non-empty bucket. Total cost
  of a Dijkstra run is `O(E + C)`.
- `RadixHeap` keeps `O(log C)` buckets whose ranges double; an element is
  redistributed at most `O(log C)` times over its life, which gives the
  amortized `pop` bound and `O(E + V log C)` for Dijkstra.
- `CalendarQueue` (Brown) buckets events by time modulo a "year"; bucket width
  and count are resized from the observed event density, which gives O(1)
  amortized operations when event times are spread evenly, as in most
  discrete-event simulations.
- `TimingWheel` (Varghese and Lauck) quantizes time into ticks and keeps a
  hierarchy of wheels; an event cascades down one level each time a coarser
  wheel turns over. It is the standard structure for network and runtime
  timers where most events are cancelled before they fire.

## Example

```js
import { BinaryHeap } from 'ds-app/heaps';

const heap = new BinaryHeap((a, b) => a.priority - b.priority);
heap.push({ id: 'a', priority: 3 });
heap.push({ id: 'b', priority: 1 });

heap.peek(); // { id: 'b', priority: 1 }
heap.pop();  // { id: 'b', priority: 1 }
heap.validate(); // true
```

```js
import { IndexedBinaryHeap } from 'ds-app/heaps';

const index = new IndexedBinaryHeap((a, b) => a - b);
index.insert(10, 'ten');
index.insert(5, 'five');
index.decreaseKey(10, 1); // sift up
index.peek(); // [1, 'ten']
```

## Conformance checklist

- Each heap drains to the same sorted sequence as a reference implementation.
- `build` produces the same multiset as repeated `push`.
- Indexed heaps keep the key index consistent after every operation.
- `decreaseKey`/`increaseKey` reject invalid directions.
- Duplicate keys are rejected by indexed heaps and allowed by plain heaps.
- Randomized operation logs are differential-tested against a sorted array.
- Monotone queues reject a key below the last popped key and match a binary
  heap on recorded Dijkstra traces.
- Timer queues deliver events in non-decreasing time and match a binary heap
  on recorded simulation traces, across bucket resizes, wheel cascades, and
  cancellations.
