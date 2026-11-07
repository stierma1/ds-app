import type {
  Comparator,
  Container,
  OrderedMap,
  Serializable,
} from "../core/index.ts";

export interface TreeNode<T> {
  value: T;
  left: TreeNode<T> | null;
  right: TreeNode<T> | null;
  parent: TreeNode<T> | null;
}

export interface TreeLike<T> extends Container<T>, Serializable {
  readonly root: TreeNode<T> | null;
  readonly height: number;
  preorder(): IterableIterator<T>;
  inorder(): IterableIterator<T>;
  postorder(): IterableIterator<T>;
  levelOrder(): IterableIterator<T>;
  eulerTour(): IterableIterator<T>;
}

export interface BinarySearchTree<K, V = K>
  extends OrderedMap<K, V>,
    TreeLike<[K, V]> {
  readonly root: TreeNode<[K, V]> | null;
  minNode(): TreeNode<[K, V]> | null;
  maxNode(): TreeNode<[K, V]> | null;
  predecessorNode(node: TreeNode<[K, V]>): TreeNode<[K, V]> | null;
  successorNode(node: TreeNode<[K, V]>): TreeNode<[K, V]> | null;
}

export interface GeneralTree<T> extends Container<T>, Serializable {
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
