# balanced-trees — AVL tree

Ordered dictionary with a worst-case logarithmic height. Currently this module
ships `AVLTree`; red-black and weight-balanced trees remain planned.

## Contract

`AVLTree<K, V>` implements `BalancedTree<K, V>` from
[`docs/api/09-balanced-binary-trees.md`](../../docs/api/09-balanced-binary-trees.md),
which extends `OrderedMap<K, V>`:

- `set/get/has/delete`, `min/max`, `predecessor/successor`, `at/indexOf`, and
  ascending `range/keys/values/entries` iteration.
- `height` is cached in O(1) per node.
- `join(other)` requires every key in the receiver to be smaller than every key
  in `other`; it consumes both inputs and returns a fresh tree.
- `split(key)` consumes the receiver and returns `[< key, >= key]`.
- `validate()` checks BST order, parent links, cached heights and sizes, and the
  AVL balance condition.
- `serialize()` / `AVLTree.deserialize(json, compare?)` use the stable
  `{ type: "AVLTree", version: 1, entries }` shape.

## Complexity

`n` elements, `k` reported entries, `h` height.

| Operation | Time | Notes |
|-----------|------|-------|
| `get` / `has` | O(log n) | Worst case, `h ≤ 1.44 log₂(n + 2)`. |
| `set` | O(log n) | At most one single or double rotation. |
| `delete` | O(log n) | Rotations may cascade, but only O(log n) of them. |
| `min` / `max` | O(log n) | Spine walk; no cached extreme pointers. |
| `predecessor` / `successor` | O(log n) | Works for absent keys. |
| `at` / `indexOf` | O(log n) | Cached subtree sizes. |
| `range` | O(log n + k) | Materialized snapshot of the k entries. |
| `join` / `split` | O(log n) | Height-based join; destructive. |
| `height` | O(1) | Cached per node. |
| Iteration / `toArray` | O(n) | Ascending by key. |
| Space | O(n) | Parent pointers, height, and subtree size per node. |

## Invariants

1. In-order traversal is strictly increasing under `compare`.
2. Every node's cached height is `1 + max(height(left), height(right))`, with
   the null tree at `-1`.
3. Every node's cached size is `1 + size(left) + size(right)`.
4. Every balance factor `height(right) - height(left)` is in `[-1, 1]`.
5. Every child points back to its parent; the root's parent is `null`.
6. A tree consumed by `join` or `split` throws `ConsumedError` on every later
   operation.

## Example

```js
import { AVLTree } from 'ds-app/balanced-trees';

const map = new AVLTree((a, b) => a.localeCompare(b));
map.set('delta', 4).set('alpha', 1).set('charlie', 3);

[...map.keys()];      // ['alpha', 'charlie', 'delta']
map.at(1);            // ['charlie', 3]
map.range('b', 'e');  // ['charlie', 3], ['delta', 4]
map.validate();       // true
```
