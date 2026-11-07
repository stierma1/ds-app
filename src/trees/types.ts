import type {
  Comparator,
  Container,
  OrderedMap,
  Serializable,
} from "../core/index.ts";

/**
 * Raw node shape shared by every tree in this module. Each node carries a parent
 * pointer, so upward walks (successor, ownership checks, LCA depth) need no stack.
 * BinaryTree/BinarySearchTree use left/right as children; GeneralTree reuses them as
 * first-child/next-sibling, so read a GeneralTree node's children via children().
 */
export interface TreeNode<T> {
  value: T;
  left: TreeNode<T> | null;
  right: TreeNode<T> | null;
  parent: TreeNode<T> | null;
}

/**
 * Binary-tree traversal contract. Every implementation in this module walks
 * iteratively with an explicit stack/queue (safe on degenerate, path-shaped trees)
 * but materializes the full O(n) result array before returning a snapshot iterator,
 * so none of the traversals is lazy; eulerTour yields 2n-1 values.
 */
export interface TreeLike<T> extends Container<T>, Serializable {
  readonly root: TreeNode<T> | null;
  readonly height: number;
  preorder(): IterableIterator<T>;
  inorder(): IterableIterator<T>;
  postorder(): IterableIterator<T>;
  levelOrder(): IterableIterator<T>;
  eulerTour(): IterableIterator<T>;
}

/**
 * Ordered-map-on-a-BST contract. Implementations are unbalanced: every keyed
 * operation is O(h) with h the tree height, which is about log2(n) for random
 * insertion order but O(n) after sorted input. Node-based neighbor queries also pay
 * an O(depth) ownership check that climbs parent pointers to the root.
 */
export interface BinarySearchTree<K, V = K>
  extends OrderedMap<K, V>,
    TreeLike<[K, V]> {
  readonly root: TreeNode<[K, V]> | null;
  minNode(): TreeNode<[K, V]> | null;
  maxNode(): TreeNode<[K, V]> | null;
  predecessorNode(node: TreeNode<[K, V]>): TreeNode<[K, V]> | null;
  successorNode(node: TreeNode<[K, V]>): TreeNode<[K, V]> | null;
}

/**
 * Rose-tree (arbitrary arity) contract. The implementation stores children as a
 * singly linked first-child/next-sibling chain, so children()/degree() are O(d) in
 * the node's degree and allocate, and there is no O(1) size counter.
 */
export interface GeneralTree<T> extends Container<T>, Serializable {
  readonly root: TreeNode<T> | null;
  parent(node: TreeNode<T>): TreeNode<T> | null;
  children(node: TreeNode<T>): Iterable<TreeNode<T>>;
  degree(node: TreeNode<T>): number;
  preorder(): IterableIterator<T>;
  postorder(): IterableIterator<T>;
  levelOrder(): IterableIterator<T>;
}

/**
 * Same contract as BinarySearchTree; the implementation answers successorNode and
 * predecessorNode from stored thread pointers in O(1) after the O(depth) ownership
 * check, instead of descending into a subtree or climbing to an ancestor.
 */
export interface ThreadedBinaryTree<K, V = K> extends BinarySearchTree<K, V> {
  successorNode(node: TreeNode<[K, V]>): TreeNode<[K, V]> | null;
  predecessorNode(node: TreeNode<[K, V]>): TreeNode<[K, V]> | null;
}

/**
 * Immutable LCA snapshot built by buildLca(). Preprocessing is O(n log n) for the
 * default Euler-tour + sparse-table method (O(1) lca) or O(n log D) for binary
 * lifting (O(log D) lca), D being the max depth. Queries throw
 * ConcurrentModificationError if the source tree's version changed after the build.
 */
export interface LowestCommonAncestor<T> extends Serializable {
  readonly size: number;
  readonly nodes: readonly TreeNode<T>[];
  lca(a: TreeNode<T>, b: TreeNode<T>): TreeNode<T>;
  depth(node: TreeNode<T>): number;
  distance(a: TreeNode<T>, b: TreeNode<T>): number;
  isAncestor(ancestor: TreeNode<T>, node: TreeNode<T>): boolean;
  validate(): true | string;
}

export type { Comparator };
