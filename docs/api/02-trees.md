# Part 2 — Trees

**Module:** `ds-app/trees` · **Source:** `src/trees/` · **Status:** planned

## Scope

General and binary trees, tree traversals, threaded trees, and the basic binary
search tree. Balanced and self-adjusting search trees are specified in Parts 9,
10, 11, and 12; this part defines the shared tree surface they build on.

## Common API

```ts
import type { Container, Comparator, OrderedMap } from 'ds-app/core';

export interface TreeNode<T> {
  value: T;
  left: TreeNode<T> | null;
  right: TreeNode<T> | null;
  parent: TreeNode<T> | null;
}

export interface TreeLike<T> extends Container<T> {
  readonly root: TreeNode<T> | null;
  readonly height: number;
  preorder(): IterableIterator<T>;
  inorder(): IterableIterator<T>;
  postorder(): IterableIterator<T>;
  levelOrder(): IterableIterator<T>;
  eulerTour(): IterableIterator<T>;
}

export interface BinarySearchTree<K, V = K>
  extends OrderedMap<K, V>, TreeLike<[K, V]> {
  readonly root: TreeNode<[K, V]> | null;
  minNode(): TreeNode<[K, V]> | null;
  maxNode(): TreeNode<[K, V]> | null;
  predecessorNode(node: TreeNode<[K, V]>): TreeNode<[K, V]> | null;
  successorNode(node: TreeNode<[K, V]>): TreeNode<[K, V]> | null;
}

export interface GeneralTree<T> extends Container<T> {
  readonly root: TreeNode<T> | null;
  parent(node: TreeNode<T>): TreeNode<T> | null;
  children(node: TreeNode<T>): Iterable<TreeNode<T>>;
  degree(node: TreeNode<T>): number;
  preorder(): IterableIterator<T>;
  postorder(): IterableIterator<T>;
  levelOrder(): IterableIterator<T>;
}

export interface ThreadedBinaryTree<K, V = K> extends BinarySearchTree<K, V> {
  successorNode(node: TreeNode<[K, V]>): TreeNode<[K, V]> | null;
  predecessorNode(node: TreeNode<[K, V]>): TreeNode<[K, V]> | null;
}

export interface LowestCommonAncestor<T> {
  readonly size: number;
  lca(a: TreeNode<T>, b: TreeNode<T>): TreeNode<T>;
  depth(node: TreeNode<T>): number;
  distance(a: TreeNode<T>, b: TreeNode<T>): number;
  isAncestor(ancestor: TreeNode<T>, node: TreeNode<T>): boolean;
  validate(): true | string;
}

export function buildLca<T>(
  tree: TreeLike<T> | GeneralTree<T>,
  method?: 'euler-rmq' | 'binary-lifting',
): LowestCommonAncestor<T>;
```

Shared members come from [`Container`](./00-common-contract.md#container).
`BinarySearchTree` uses the [`OrderedMap`](./00-common-contract.md#ordered-map--ordered-set)
contract for `set/get/has/delete/min/max/range`.

### Semantics

- `inorder` of a binary search tree yields entries in ascending key order.
- `preorder`, `postorder`, and `levelOrder` yield node values, not entries.
- `eulerTour` yields each node value on entry and after each child return,
  matching the book's Euler-tour linearization.
- `height` is the number of edges on the longest root-to-leaf path; an empty tree
  has height `-1`, a single node `0`.
- `ThreadedBinaryTree` uses right threads for inorder successors and left
  threads for inorder predecessors. A thread reaches the neighbor in O(1); a
  node with a real child descends to the extreme of that subtree in O(h). A
  full inorder walk is O(n) and needs no stack, so each step is O(1)
  amortized.
- `buildLca` snapshots the tree. Mutating the tree afterwards invalidates the
  structure and `lca` then throws `ConcurrentModificationError`; a node from
  another tree throws `TypeError`. Part 25 covers the dynamic case.
- `validate()` checks parent/child consistency, BST ordering, thread targets,
  subtree sizes, and height.

## Implementations and complexity

| Operation | `BinarySearchTree` | `ThreadedBinaryTree` | `GeneralTree` |
|-----------|--------------------|----------------------|---------------|
| `set` / `insert` | O(h), worst O(n) | O(h), worst O(n) | — |
| `get` / `find` | O(h), worst O(n) | O(h), worst O(n) | — |
| `delete` | O(h), worst O(n) | O(h), worst O(n) | — |
| `min` / `max` | O(h), worst O(n) | O(h), worst O(n) | — |
| `predecessor` / `successor` (key) | O(h), worst O(n) | O(h), worst O(n) | — |
| `predecessorNode` / `successorNode` | O(h), worst O(n) | O(1) amortized over a traversal, O(h) worst | — |
| `range` | O(h + k), worst O(n + k) | O(h + k) | — |
| `inorder` traversal | O(n) | O(n) | O(n) |
| Other traversals | O(n) | O(n) | O(n) |
| Child access | O(1) per child | O(1) per child | O(deg) |
| Space | O(n) | O(n) | O(n) |

Definitions: `n` elements, `h` height, `k` reported entries, `deg` number of
children. The BST is not self-balancing: `h` is `O(log n)` only for random or
well-shaped inputs and `O(n)` in the worst case. Balanced variants in Part 9
guarantee `h = O(log n)`.

### Structural operations

| Operation | Cost | Notes |
|-----------|------|-------|
| Rotate left/right | O(1) | Pointer surgery shared by all balanced trees. |
| Join two trees | O(h) | All keys in the left tree must be smaller. |
| Split by key | O(h) | Returns the lower and upper trees. |
| Subtree size | O(1) | Maintained at each node. |
| Recompute height | O(n) | Or O(1) with maintained heights. |
| LCA, Euler tour + RMQ (Part 17) | O(n) build, O(1) query, O(n) space | Default. `distance` is `depth(a) + depth(b) − 2·depth(lca)`. |
| LCA, binary lifting | O(n log n) build, O(log n) query, O(n log n) space | Simpler; also answers level-ancestor queries. |

## Example

```js
import { BinarySearchTree } from 'ds-app/trees';

const bst = new BinarySearchTree((a, b) => a - b);
[5, 2, 8, 1, 9].forEach((k) => bst.set(k, `v${k}`));

[...bst.keys()];            // [1, 2, 5, 8, 9]
bst.successor(5);           // [8, 'v8']
bst.predecessor(1);         // undefined
bst.height;                 // 2
bst.validate();             // true
```

## Conformance checklist

- Traversals are differential-tested against a recursive reference on random
  tree shapes, including empty and single-node trees.
- Deep degenerate trees (10^5 nodes) traverse without stack overflow.
- `lca`, `depth`, `distance`, and `isAncestor` match a naive parent-walk
  reference on random trees, including the root, identical nodes, and
  ancestor/descendant pairs, for both methods.
- `successor`/`predecessor` and `successorNode`/`predecessorNode` cover first,
  last, missing key, and every node.
- Threaded and unthreaded trees agree on inorder sequences after randomized
  insert/delete sequences.
- `validate()` rejects a corrupted parent link, a violated BST order, and a
  dangling thread.
