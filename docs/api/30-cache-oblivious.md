# Part 30 — Cache-Oblivious Data Structures

**Module:** `ds-app/cache-oblivious` · **Source:** `src/cache-oblivious/` · **Status:** planned

## Scope

Structures whose memory-transfer cost is optimal for every cache size and
block size without knowing either: the van Emde Boas layout for static search,
the packed-memory array, the cache-oblivious B-tree, funnel sort, and the
funnel heap. Bounds are stated in memory transfers in the ideal-cache model,
with `B` the (unknown) block size and `M` the cache size.

## Common API

```ts
import type { Comparator, OrderedMap, PriorityQueue } from 'ds-app/core';

export interface StaticSearchTree<K, V = K> {
  readonly size: number;
  readonly compare: Comparator<K>;
  get(key: K): V | undefined;
  predecessor(key: K): [K, V] | undefined;
  successor(key: K): [K, V] | undefined;
  range(lo: K, hi: K): IterableIterator<[K, V]>;
  validate(): true | string;
}

export interface PackedMemoryArray<T> {
  readonly size: number;
  readonly capacity: number;
  readonly compare: Comparator<T>;
  insert(value: T): void;
  delete(value: T): boolean;
  scan(lo?: T, hi?: T): IterableIterator<T>;
  validate(): true | string;
}

export interface CacheObliviousBTree<K, V = K> extends OrderedMap<K, V> {
  readonly transfers: number;   // simulated, see notes
}

export interface FunnelHeap<T> extends PriorityQueue<T> {
  readonly compare: Comparator<T>;
}

export function funnelSort<T>(values: ArrayLike<T>, compare?: Comparator<T>): T[];
```

`CacheObliviousBTree` implements the shared
[`OrderedMap`](./00-common-contract.md#ordered-map--ordered-set) contract and
`FunnelHeap` the shared [`PriorityQueue`](./00-common-contract.md#priority-queue)
contract. `StaticSearchTree` and `PackedMemoryArray` are narrower,
read-mostly structures.

### Semantics

- Static structures are built once from sorted input and throw
  `UnsupportedError` on mutation.
- A `PackedMemoryArray` keeps elements sorted in an array with gaps; `scan`
  skips gaps and iterates in order.
- Element storage uses typed arrays where the element type allows, so the
  layout actually controls memory locality in JavaScript engines.
- `transfers` is a count from the simulated block model used in tests and
  benchmarks (see notes); it is `0` outside simulation.
- `validate()` checks layout order, density thresholds (PMA), and tree index
  consistency.

## Implementations and complexity

Bounds are memory transfers; comparison counts are the usual O(log n).

| Structure | Build | Search | Insert / delete | Range scan of k | Space |
|-----------|-------|--------|-----------------|-----------------|-------|
| `VebLayoutTree` (static) | O(n/B) after sorting | O(log_B n) | — | O(log_B n + k/B) | O(n) |
| `PackedMemoryArray` | O(n/B) | O(log n) by binary search, O(log_B n) with an index | O(log² n / B) amortized | O(k/B) | O(n) |
| `CacheObliviousBTree` | O(n/B) from sorted input | O(log_B n) | O(log_B n + log² n / B) amortized | O(log_B n + k/B) | O(n) |
| `FunnelHeap` | — | `peek` O(1) | O((1/B) log_{M/B}(n/B)) amortized | — | O(n) |
| `funnelSort` | — | — | — | O((n/B) log_{M/B}(n/B)) total | O(n) |

Definitions: `n` elements, `k` reported elements, `B` block size, `M` cache
size, both unknown to the algorithm. Bounds hold under the tall-cache
assumption `M = Ω(B²)`.

### Notes

- **vEB layout:** a complete binary search tree stored by recursively splitting
  at half height, so any root-to-leaf path touches O(log_B n) blocks for every
  `B`.
- **Packed-memory array:** maintains density within windows of a binary
  hierarchy; an overflowing window is rebalanced by spreading elements, which
  costs O(log² n) amortized element moves but only O(log² n / B) transfers.
- **Cache-oblivious B-tree:** a vEB-layout index over a packed-memory array
  (Bender, Demaine, and Farach-Colton); updates rebalance the array and patch
  the index.
- **Funnel sort and funnel heap:** k-mergers built from recursively laid-out
  buffers; the heap is a sequence of growing funnels (Brodal and Fagerberg).
- Transfers cannot be observed in JavaScript, so benchmarks run the same code
  over a simulated memory with configurable `B` and `M` that counts block
  loads, and over real typed arrays for wall-clock time.

## Example

```js
import { CacheObliviousBTree, funnelSort } from 'ds-app/cache-oblivious';

const tree = new CacheObliviousBTree((a, b) => a - b);
for (const k of [9, 2, 7, 4]) tree.set(k, k * 10);
tree.get(7);              // 70
[...tree.range(3, 8)];    // [[4, 40], [7, 70]]
tree.validate();          // true

funnelSort([3, 1, 2]);    // [1, 2, 3]
```

## Conformance checklist

- `CacheObliviousBTree` passes the ordered-map conformance suite.
- `funnelSort` matches `Array.prototype.sort` with the same comparator on
  random, sorted, and reversed input.
- Simulated transfer counts scale as documented when `B` is varied over three
  orders of magnitude.
- PMA density stays within thresholds after random insert/delete sequences.
- `validate()` detects a misordered layout and a density violation.
