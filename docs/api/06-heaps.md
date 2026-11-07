# Part 6 — Heaps

**Module:** `ds-app/heaps` · **Source:** `src/heaps/` · **Status:** planned

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
- `validate()` checks heap order, index consistency, and size.

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
