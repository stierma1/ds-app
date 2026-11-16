# splay-trees — bottom-up and top-down self-adjusting search trees

Ordered dictionaries that move every accessed node to the root. This module ships
`SplayTree` (bottom-up, parent pointers) and `TopDownSplayTree` (top-down, no
parent pointers); `BottomUpSplayTree` is an alias of `SplayTree`.

## Contract

Both classes implement `SplayTreeLike<K, V>`, which extends `OrderedMap<K, V>`
from [`docs/api/11-splay-trees.md`](../../docs/api/11-splay-trees.md):

- `set/get/has/delete`, `min/max`, `predecessor/successor`, `at/indexOf`, and
  ascending `range/keys/values/entries` iteration.
- Every `get`, `has`, `set`, `delete`, `splay`, `min`, `max`, `predecessor`, and
  `successor` splays the accessed node — or the last node on the search path when
  the key is absent — to the root. Those operations therefore invalidate live
  iterators, even when the key is missing. `at` and `indexOf` are pure queries
  and do not splay.
- `root` exposes the raw root node for teaching and invariant inspection.
- `join(other)` requires every key in the receiver to be smaller than every key
  in `other`; it consumes both inputs and returns a fresh tree.
- `split(key)` consumes the receiver and returns `[< key, >= key]`.
- `validate()` checks BST order, parent links (bottom-up only), cached subtree
  sizes, and the container size. Balance is not an invariant and is not checked.
- `serialize()` / `deserialize(json, compare?)` use the stable
  `{ type: "SplayTree" | "TopDownSplayTree", version: 1, entries }` shape.

## Complexity

`n` elements, `k` reported entries, `h` height. All operation bounds are
amortized over a sequence of accesses starting from an empty tree; a single
operation can be O(n) worst case.

| Operation | Time | Notes |
|-----------|------|-------|
| `get` / `has` | O(log n) | Splays the accessed node or search-path leaf. |
| `set` | O(log n) | Replaces the value, or inserts and splays the new node. |
| `delete` | O(log n) | Splays the key, then joins the two root subtrees. |
| `splay` | O(log n) | Single, zig-zig, and zig-zag steps; iterative. |
| `min` / `max` | O(log n) | Spine walk followed by a splay. |
| `predecessor` / `successor` | O(log n) | Works for absent keys; splays the result. |
| `at` / `indexOf` | O(h) | Cached subtree sizes; O(n) for a path-shaped tree. Pure query. |
| `range` | O(log n + k) | Lower bound plus k in-order steps; materialized snapshot. |
| `join` / `split` | O(log n) | Destructive; each consumes its inputs. |
| Iteration / `toArray` | O(n) | Ascending by key, iterative. |
| Space | O(n) | Parents (bottom-up only) and a subtree size per node. |

## Invariants

1. In-order traversal is strictly increasing under `compare`.
2. Every node's cached size is `1 + size(left) + size(right)`.
3. Every child points back to its parent; the root's parent is `null`
   (bottom-up only).
4. The tree contains exactly `size` nodes.
5. A tree consumed by `join` or `split` throws `ConsumedError` on every later
   operation.

No balance condition is maintained. Sorted insertion produces a path-shaped
tree; locality of access is what keeps amortized cost logarithmic.

## Example

```js
import { SplayTree, TopDownSplayTree } from 'ds-app/splay-trees';

const splay = new SplayTree((a, b) => a - b);
[5, 2, 8, 1, 9].forEach((key) => splay.set(key, `v${key}`));

splay.get(9);        // 'v9'; 9 is now the root
splay.min();         // [1, 'v1']; 1 is now the root
[...splay.keys()];   // [1, 2, 5, 8, 9]
splay.validate();    // true

const topDown = new TopDownSplayTree((a, b) => a - b);
topDown.set(4, 'd').set(2, 'b').set(6, 'f');
topDown.get(2);      // 'b'; 2 is now the root
topDown.validate();  // true
```
