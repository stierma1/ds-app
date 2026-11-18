import type { Comparator } from "../core/index.ts";
import { readRandomizedEntries } from "./serialization.ts";
import { RandomizedTreeBase, updateTreeNode } from "./tree-base.ts";
import type { RandomOptions } from "./types.ts";

/** Randomized-BST node: a BST key/value pair and a cached subtree size. */
class RandomizedBSTNode<K, V> {
  key: K;
  value: V;
  left: RandomizedBSTNode<K, V> | null = null;
  right: RandomizedBSTNode<K, V> | null = null;
  size = 1;

  constructor(key: K, value: V) {
    this.key = key;
    this.value = value;
  }
}

/**
 * Randomized binary search tree (Martínez–Roura style insertion). A new key becomes the root of a
 * subtree with probability `1 / (n + 1)`, where `n` is that subtree's size; otherwise the insertion
 * recurses into the left or right subtree. No per-node priority is stored, so the shape is
 * distributed like a BST built from a uniformly random insertion order.
 *
 * Deletion joins the two remaining subtrees by choosing their root in proportion to subtree size,
 * which preserves the random-BST distribution. Expected bounds are O(log n); the worst case is
 * O(n). `validate()` checks BST order, cached sizes, and the node count, not balance.
 */
export class RandomizedBST<K, V = K> extends RandomizedTreeBase<
  K,
  V,
  RandomizedBSTNode<K, V>
> {
  /** O(1); `compare` defaults to natural order and `rng` defaults to a CSPRNG seed. */
  constructor(compare?: Comparator<K>, options?: RandomOptions) {
    super(compare, options);
  }

  /** O(n log n) expected: rebuilds by inserting the sorted entries with fresh random choices. */
  static deserialize<K, V>(
    json: unknown,
    compare?: Comparator<K>,
    options?: RandomOptions,
  ): RandomizedBST<K, V> {
    const entries = readRandomizedEntries<K, V>(json, "RandomizedBST");
    const tree = new RandomizedBST<K, V>(compare, options);
    for (const [key, value] of entries) {
      tree.set(key, value);
    }
    return tree;
  }

  protected override createNode(key: K, value: V): RandomizedBSTNode<K, V> {
    return new RandomizedBSTNode<K, V>(key, value);
  }

  /**
   * O(log n) expected: becomes the subtree root with probability `1 / (n + 1)`, splitting the
   * subtree at the key, or recurses into the appropriate side.
   */
  protected override insertNode(
    root: RandomizedBSTNode<K, V> | null,
    node: RandomizedBSTNode<K, V>,
  ): RandomizedBSTNode<K, V> {
    if (root === null) {
      return node;
    }
    const atRoot = this.rng.next();
    if (typeof atRoot !== "number" || !Number.isFinite(atRoot)) {
      throw new TypeError("rng.next() must return a finite number");
    }
    if (atRoot < 1 / (root.size + 1)) {
      const [left, right] = this.splitByKey(root, node.key);
      node.left = left;
      node.right = right;
      updateTreeNode(node);
      return node;
    }
    if (this.compare(node.key, root.key) < 0) {
      root.left = this.insertNode(root.left, node);
    } else {
      root.right = this.insertNode(root.right, node);
    }
    updateTreeNode(root);
    return root;
  }

  /** O(log n) expected: replaces the removed node by a size-weighted random join of its subtrees. */
  protected override deleteNode(
    root: RandomizedBSTNode<K, V>,
    key: K,
  ): [RandomizedBSTNode<K, V> | null, boolean] {
    const comparison = this.compare(key, root.key);
    if (comparison < 0) {
      if (root.left === null) {
        return [root, false];
      }
      const [left, deleted] = this.deleteNode(root.left, key);
      if (!deleted) {
        return [root, false];
      }
      root.left = left;
      updateTreeNode(root);
      return [root, true];
    }
    if (comparison > 0) {
      if (root.right === null) {
        return [root, false];
      }
      const [right, deleted] = this.deleteNode(root.right, key);
      if (!deleted) {
        return [root, false];
      }
      root.right = right;
      updateTreeNode(root);
      return [root, true];
    }
    return [this.joinNodes(root.left, root.right), true];
  }

  protected override get serializationType(): string {
    return "RandomizedBST";
  }

  /** O(log n) expected: split a subtree into keys `< key` and keys `>= key`. */
  private splitByKey(
    root: RandomizedBSTNode<K, V> | null,
    key: K,
  ): [RandomizedBSTNode<K, V> | null, RandomizedBSTNode<K, V> | null] {
    if (root === null) {
      return [null, null];
    }
    if (this.compare(root.key, key) < 0) {
      const [left, right] = this.splitByKey(root.right, key);
      root.right = left;
      updateTreeNode(root);
      return [root, right];
    }
    const [left, right] = this.splitByKey(root.left, key);
    root.left = right;
    updateTreeNode(root);
    return [left, root];
  }

  /**
   * O(log n) expected: joins two fully ordered subtrees by choosing the root from the left with
   * probability `size(left) / (size(left) + size(right))`. With uniformly random input subtrees the
   * result is again a uniformly random BST.
   */
  private joinNodes(
    left: RandomizedBSTNode<K, V> | null,
    right: RandomizedBSTNode<K, V> | null,
  ): RandomizedBSTNode<K, V> | null {
    if (left === null) {
      return right;
    }
    if (right === null) {
      return left;
    }
    const total = left.size + right.size;
    const draw = this.rng.next();
    if (typeof draw !== "number" || !Number.isFinite(draw)) {
      throw new TypeError("rng.next() must return a finite number");
    }
    if (draw * total < left.size) {
      left.right = this.joinNodes(left.right, right);
      updateTreeNode(left);
      return left;
    }
    right.left = this.joinNodes(left, right.left);
    updateTreeNode(right);
    return right;
  }
}
