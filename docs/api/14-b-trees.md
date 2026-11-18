# Part 14 — B Trees

**Module:** `ds-app/b-trees` · **Source:** `src/b-trees/` · **Status:** in progress

## Scope

Multiway search trees with high fan-out, designed for block storage and
cache-efficient ordered dictionaries: B-trees, B+-trees, B*-trees, and 2-3-4
trees. All use the ordered-map surface plus bulk loading and height access.

Current implementation: `BTree`, the general order-parameterized tree,
`BPlusTree`, the linked-leaf B+-tree, and `TwoThreeFourTree`, the order-4
special case. All ship the full ordered-map surface, top-down search with
split-on-overflow insertion, borrow/merge underflow repair, linear-time
`bulkLoad`, cached subtree counts for `at`/`indexOf`, and serialization.
`BPlusTree` stores separator keys only in internal nodes and all entries in
doubly linked leaves, so range scans and sequential iteration follow the leaf
chain after one root descent. The B*-tree variant is planned.

## Common API

```ts
import type { Comparator, OrderedMap } from 'ds-app/core';

export interface BTreeOptions<K> {
  order?: number;
  compare?: Comparator<K>;
}

export interface BTree<K, V = K> extends OrderedMap<K, V> {
  readonly order: number;
  readonly height: number;
  readonly minFill: number;
  bulkLoad(entries: Iterable<[K, V]>): void;
}
```

Shared members come from [`Container`](./00-common-contract.md#container);
`set/get/has/delete/min/max/predecessor/successor/range` come from
[`OrderedMap`](./00-common-contract.md#ordered-map--ordered-set).

### Semantics

- `order` is the maximum number of children per internal node; it must be at
  least 3. `TwoThreeFourTree` fixes it to 4 and throws `RangeError` for any
  other explicit value. `minFill` is `ceil(order / 2)` for B-trees and
  B+-trees, and `ceil(2 · order / 3)` for B*-trees; the 2-3-4 tree reports 2.
- Every leaf is at the same depth; `height` is the number of edges from root to
  leaf.
- In a B+-tree, internal nodes store separator keys only; all entries live in
  linked leaves. In a B-tree, entries may live in internal nodes.
- `bulkLoad` requires entries sorted by key ascending and replaces the current
  contents. Unsorted input throws `RangeError` before the tree is changed;
  comparator-equal keys keep the last value, matching repeated `set`.
- `validate()` checks node occupancy, key order, child-range containment, equal
  leaf depth, parent links, cached subtree counts, leaf links (B+-tree), and
  size.

## Implementations and complexity

| Operation | B-tree | B+-tree | B*-tree | 2-3-4 tree |
|-----------|--------|---------|---------|------------|
| `get` / `has` | O(log n) | O(log n) | O(log n) | O(log n) |
| `set` | O(log n) | O(log n) | O(log n) | O(log n) |
| `delete` | O(log n) | O(log n) | O(log n) | O(log n) |
| `min` / `max` | O(log n) | O(log n) | O(log n) | O(log n) |
| `predecessor` / `successor` | O(log n) | O(log n) | O(log n) | O(log n) |
| `range` | O(log n + k) | O(log n + k), O(k) sequential scan | O(log n + k) | O(log n + k) |
| `bulkLoad` (sorted) | O(n) | O(n) | O(n) | O(n) |
| `height` | O(1) | O(1) | O(1) | O(1) |
| Space | O(n) | O(n) | O(n) | O(n) |

Definitions: `n` entries, `k` reported entries. With node capacity `B`, a search
touches `O(log_B n)` nodes. On block storage, B+-tree range scans cost
`O(log_B n + k/B)` block transfers because leaves are linked. The table lists
the full family; the B-tree, B+-tree, and 2-3-4 columns are implemented today.

### Notes

- `BTree`, `BPlusTree`, and `TwoThreeFourTree` use split-on-overflow insertion
  and merge/borrow-on-underflow deletion. Each node caches its subtree entry
  count, so `at` and `indexOf` are `O(log n)` and stay consistent through
  splits, borrows, merges, and `bulkLoad`.
- The general `BTree` and `BPlusTree` accept any integer `order` of at least 3,
  defaulting to 4. `TwoThreeFourTree` is the same algorithm with `order` fixed
  to 4.
- The B+-tree keeps all values in leaves and links leaves in key order; this
  makes range scans and sequential iteration cache-friendly.
- The B*-tree uses two-to-three redistribution before splitting, raising the
  average fill factor to about 2/3 and reducing space overhead.
- The 2-3-4 tree is the order-4 special case; it is isomorphic to a red-black
  tree and is included for teaching and cross-checking.
- `bulkLoad` constructs the tree directly in linear time from sorted input. The
  2-3-4 tree chooses the smallest height that fits the input, then fills each
  node with a feasible number of separator entries and recursively partitions
  the remaining entries across its children, so every subtree lands inside its
  occupancy window. Repeated `set` on sorted input costs `O(n log n)`.
- `validate()` is O(n) and is intended for tests, not hot paths.

## Example

```js
import { BTree } from 'ds-app/b-trees';

const wide = new BTree({ order: 8 });
[3, 1, 4, 1, 5, 9, 2, 6].forEach((k) => wide.set(k, k * 10));

wide.get(4);              // 40
wide.order;               // 8
wide.minFill;             // 4
wide.height;              // 0
wide.validate();          // true
```

```js
import { BPlusTree } from 'ds-app/b-trees';

const index = new BPlusTree({ order: 8 });
[3, 1, 4, 1, 5, 9, 2, 6].forEach((k) => index.set(k, k * 10));

index.get(4);             // 40
[...index.range(2, 5)];   // [[2, 20], [3, 30], [4, 40], [5, 50]]
index.height;             // 0
index.validate();         // true
```

```js
import { TwoThreeFourTree } from 'ds-app/b-trees';

const tree = new TwoThreeFourTree((a, b) => a - b);
[3, 1, 4, 1, 5, 9, 2, 6].forEach((k) => tree.set(k, k * 10));

tree.get(4);              // 40
[...tree.keys()];         // [1, 2, 3, 4, 5, 6, 9]
tree.range(2, 5);         // entries for 2, 3, 4, 5
tree.validate();          // true

tree.bulkLoad([[10, 100], [20, 200]]);
tree.height;              // 0
```

## Conformance checklist

- All variants pass the ordered-map conformance suite. `BTree` is covered by
  `tests/unit/b-trees.test.ts`, `BPlusTree` by
  `tests/unit/b-trees-bplus.test.ts`, and `TwoThreeFourTree` by
  `tests/unit/b-trees-234.test.ts`.
- Occupancy bounds hold after random insert/delete sequences, including
  underflow at the root.
- All leaves stay at the same depth; B+-tree leaf links match key order.
- `bulkLoad` matches repeated `set` and rejects unsorted input.
- `validate()` detects overfull/underfull nodes, an out-of-range key, a stale
  subtree count, and a broken leaf link.
- Large loads are benchmarked for block-transfer counts as well as time; run
  `npm run benchmark:phase4-b-trees` for the current B-tree comparisons.
