# b-trees — B-tree, B+-tree, and 2-3-4 tree

Multiway ordered dictionaries for cache-friendly storage. This module ships
`BTree`, the general order-parameterized B-tree, `BPlusTree`, the linked-leaf
B+-tree, and `TwoThreeFourTree`, its order-4 special case; the B*-tree variant
is planned.

## Contract

`BTree<K, V>`, `BPlusTree<K, V>`, and `TwoThreeFourTree<K, V>` implement the
`BTree<K, V>` contract from
[`docs/api/14-b-trees.md`](../../docs/api/14-b-trees.md), which extends
`OrderedMap<K, V>`:

- `set/get/has/delete`, `min/max`, `predecessor/successor`, `at/indexOf`, and
  ascending `range/keys/values/entries` iteration.
- `BTree` and `BPlusTree` accept any integer `order` of at least 3 and default
  to 4; `TwoThreeFourTree` always uses order 4 and rejects any other explicit
  value with `RangeError`. `minFill` is `ceil(order / 2)`, and `height` is the
  number of edges from the root to a leaf (`-1` when empty). The constructor
  accepts either a comparator or `BTreeOptions`.
- `BPlusTree` stores separator keys in internal nodes and all entries in
  linked leaves. `range` performs one root descent and then follows the leaf
  chain, so sequential scans never revisit internal nodes.
- `bulkLoad(entries)` requires ascending keys, replaces the contents in linear
  time, and throws `RangeError` before modifying the tree when a key is smaller
  than its predecessor. Comparator-equal keys keep the last value, matching
  repeated `set`.
- `validate()` checks occupancy, strict separator and leaf key order,
  child-range containment, parent links, equal leaf depth, cached subtree
  counts, size, and the doubly linked leaf chain.
- `serialize()` / `deserialize(json, compareOrOptions?)` use the stable
  `{ type: "BTree" | "BPlusTree" | "TwoThreeFourTree", version: 1, entries }`
  shape.

## Complexity

`n` entries, `k` reported entries.

| Operation | Time | Notes |
|-----------|------|-------|
| `get` / `has` | O(log n) | Root descent through up to `order - 1` keys per node. |
| `set` | O(log n) | Splits at most one node per level on overflow. |
| `delete` | O(log n) | Predecessor substitution, then borrow/merge up the path. |
| `min` / `max` | O(log n) | Leftmost or rightmost spine. |
| `predecessor` / `successor` | O(log n) | Works for absent keys. |
| `at` / `indexOf` | O(log n) | Cached subtree entry counts. |
| `range` | O(log n + k) | B-tree prunes an in-order walk; B+-tree follows linked leaves in O(k). |
| `bulkLoad` | O(n) | Direct construction from sorted entries. |
| `height` | O(1) | Cached and updated on root splits/collapses. |
| Iteration / `toArray` | O(n) | Ascending by key; B+-tree follows the leaf chain. |
| Space | O(n) | One parent pointer and one count per node. |

## Invariants

1. In-order traversal is strictly increasing under `compare`.
2. Every node holds at most `order - 1` entries, and an internal node has
   exactly one more child than it has entries. The 2-3-4 tree therefore holds
   1-3 entries per node.
3. Every non-root node holds at least `ceil(order / 2) - 1` entries; the root
   may hold a single entry but never zero.
4. All leaves are at the same depth, and that depth equals `height`.
5. Every child pointer agrees with its parent pointer, and the root's parent is
   `null`.
6. Every cached subtree count equals the number of entries below it, and the
   root count equals `size`.
7. In a B+-tree, internal nodes hold no values; every entry lives in a leaf,
   and the leaves form a doubly linked list in ascending key order. An internal
   separator is at most the smallest key of its right subtree and greater than
   every key of its left subtree.
8. `bulkLoad` produces the same ordered content as repeated `set` over the same
   deduplicated keys.

## Example

```js
import { BTree } from 'ds-app/b-trees';

const wide = new BTree({ order: 8 });
[3, 1, 4, 1, 5, 9, 2, 6].forEach((key) => wide.set(key, key * 10));

wide.get(4);          // 40
wide.order;           // 8
wide.minFill;         // 4
wide.validate();      // true
```

```js
import { BPlusTree } from 'ds-app/b-trees';

const index = new BPlusTree({ order: 8 });
for (const key of [3, 1, 4, 1, 5, 9, 2, 6]) {
  index.set(key, key * 10);
}

index.get(4);         // 40
[...index.range(2, 5)]; // [[2, 20], [3, 30], [4, 40], [5, 50]]
index.height;         // 0
index.validate();     // true

index.bulkLoad([[10, 100], [20, 200]]);
index.size;           // 2
index.height;         // 0
```

```js
import { TwoThreeFourTree } from 'ds-app/b-trees';

const tree = new TwoThreeFourTree((a, b) => a - b);
for (const key of [3, 1, 4, 1, 5, 9, 2, 6]) {
  tree.set(key, key * 10);
}

tree.get(4);          // 40
[...tree.keys()];     // [1, 2, 3, 4, 5, 6, 9]
tree.at(2);           // [3, 30]
tree.range(2, 5);     // entries for 2, 3, 4, 5
tree.height;          // 1
tree.validate();      // true

tree.bulkLoad([[10, 100], [20, 200]]);
tree.size;            // 2
tree.height;          // 0
```
