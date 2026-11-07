# Part 14 — B Trees

**Module:** `ds-app/b-trees` · **Source:** `src/b-trees/` · **Status:** planned

## Scope

Multiway search trees with high fan-out, designed for block storage and
cache-efficient ordered dictionaries: B-trees, B+-trees, B*-trees, and 2-3-4
trees. All use the ordered-map surface plus bulk loading and height access.

## Common API

```ts
import type { Comparator, OrderedMap } from 'ds-app/core';

export interface BTreeOptions<K> {
  order: number;
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
  least 3. `minFill` is `ceil(order / 2)` for B-trees and B+-trees, and
  `ceil(2 · order / 3)` for B*-trees.
- Every leaf is at the same depth; `height` is the number of edges from root to
  leaf.
- In a B+-tree, internal nodes store separator keys only; all entries live in
  linked leaves. In a B-tree, entries may live in internal nodes.
- `bulkLoad` requires entries sorted by key ascending and replaces the current
  contents. Unsorted input throws `RangeError`.
- `validate()` checks node occupancy, key order, child-range containment, equal
  leaf depth, leaf links (B+-tree), and size.

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
`O(log_B n + k/B)` block transfers because leaves are linked.

### Notes

- The B-tree implementation uses the book's split-on-overflow and
  merge/borrow-on-underflow procedures.
- The B+-tree keeps all values in leaves and links leaves in key order; this
  makes range scans and sequential iteration cache-friendly.
- The B*-tree uses two-to-three redistribution before splitting, raising the
  average fill factor to about 2/3 and reducing space overhead.
- The 2-3-4 tree is the order-4 special case; it is isomorphic to a red-black
  tree and is included for teaching and cross-checking.
- `bulkLoad` builds bottom-up in linear time from sorted input: nodes are
  filled left to right and every `order`-th key is promoted to the next level,
  as a separator copy in a B+-tree or as the entry itself in a B-tree,
  B*-tree, or 2-3-4 tree. Repeated `set` on sorted input costs `O(n log n)`.
- `validate()` is O(n) and is intended for tests, not hot paths.

## Example

```js
import { BPlusTree } from 'ds-app/b-trees';

const tree = new BPlusTree({ order: 4, compare: (a, b) => a - b });
[3, 1, 4, 1, 5, 9, 2, 6].forEach((k) => tree.set(k, k * 10));

tree.get(4);              // 40
[...tree.keys()];         // [1, 2, 3, 4, 5, 6, 9]
tree.range(2, 5);         // entries for 2, 3, 4, 5
tree.validate();          // true
```

## Conformance checklist

- All variants pass the ordered-map conformance suite.
- Occupancy bounds hold after random insert/delete sequences, including
  underflow at the root.
- All leaves stay at the same depth; B+-tree leaf links match key order.
- `bulkLoad` matches repeated `set` and rejects unsorted input.
- `validate()` detects overfull/underfull nodes, an out-of-range key, and a
  broken leaf link.
- Large loads are benchmarked for block-transfer counts as well as time.
