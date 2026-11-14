# balanced-trees — AVL and red-black trees

Ordered dictionaries with a worst-case logarithmic height. This module ships
`AVLTree` and `RedBlackTree`; weight-balanced trees remain planned.

## Contract

`AVLTree<K, V>` and `RedBlackTree<K, V>` implement `BalancedTree<K, V>` from
[`docs/api/09-balanced-binary-trees.md`](../../docs/api/09-balanced-binary-trees.md),
which extends `OrderedMap<K, V>`:

- `set/get/has/delete`, `min/max`, `predecessor/successor`, `at/indexOf`, and
  ascending `range/keys/values/entries` iteration.
- `height` is cached in O(1) per node.
- `join(other)` requires every key in the receiver to be smaller than every key
  in `other`; it consumes both inputs and returns a fresh tree.
- `split(key)` consumes the receiver and returns `[< key, >= key]`.
- `validate()` checks BST order, parent links, cached heights/sizes, and the
  implementation balance condition. `RedBlackTree` additionally checks root
  color, red-red edges, and equal black-height on both sides of every node.
- `serialize()` / `deserialize(json, compare?)` use the stable
  `{ type: "AVLTree" | "RedBlackTree", version: 1, entries }` shape.

## Complexity

`n` elements, `k` reported entries, `h` height.

| Operation | Time | Notes |
|-----------|------|-------|
| `get` / `has` | O(log n) | AVL `h ≤ 1.44 log₂(n + 2)`; red-black `h ≤ 2 log₂(n + 1)`. |
| `set` | O(log n) | AVL needs at most one rotation; red-black at most two. |
| `delete` | O(log n) | AVL rotations may cascade; red-black needs at most three. |
| `min` / `max` | O(log n) | Spine walk; no cached extreme pointers. |
| `predecessor` / `successor` | O(log n) | Works for absent keys. |
| `at` / `indexOf` | O(log n) | Cached subtree sizes. |
| `range` | O(log n + k) | Materialized snapshot of the k entries. |
| `join` / `split` | O(log n) | Black-height/height-based join; destructive. |
| `height` | O(1) | Cached per node. |
| Iteration / `toArray` | O(n) | Ascending by key. |
| Space | O(n) | Parent pointers, height, subtree size, and (for red-black) black-height per node. |

## Invariants

1. In-order traversal is strictly increasing under `compare`.
2. Every node's cached height is `1 + max(height(left), height(right))`, with
   the null tree at `-1`.
3. Every node's cached size is `1 + size(left) + size(right)`.
4. Every AVL balance factor `height(right) - height(left)` is in `[-1, 1]`.
5. Every red-black node is red or black; the root is black, red nodes have
   black children, and both children of every node have the same black-height.
6. Every child points back to its parent; the root's parent is `null`.
7. A tree consumed by `join` or `split` throws `ConsumedError` on every later
   operation.

## Example

```js
import { AVLTree, RedBlackTree } from 'ds-app/balanced-trees';

const map = new RedBlackTree((a, b) => a.localeCompare(b));
map.set('delta', 4).set('alpha', 1).set('charlie', 3);

[...map.keys()];      // ['alpha', 'charlie', 'delta']
map.at(1);            // ['charlie', 3]
map.range('b', 'e');  // ['charlie', 3], ['delta', 4]
map.validate();       // true

const avl = new AVLTree((a, b) => a.localeCompare(b));
avl.set('delta', 4).set('alpha', 1).set('charlie', 3);
avl.validate();       // true
```
