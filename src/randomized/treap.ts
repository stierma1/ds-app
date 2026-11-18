import type { Comparator } from "../core/index.ts";
import { readRandomizedEntries } from "./serialization.ts";
import { RandomizedTreeBase, updateTreeNode } from "./tree-base.ts";
import type { RandomOptions } from "./types.ts";

/**
 * Treap node: a BST key, its value, a random priority, and a cached subtree size. The tree is
 * ordered by key and heap-ordered by priority (smaller priority nearer the root).
 */
class TreapNode<K, V> {
  key: K;
  value: V;
  priority: number;
  left: TreapNode<K, V> | null = null;
  right: TreapNode<K, V> | null = null;
  size = 1;

  constructor(key: K, value: V, priority: number) {
    this.key = key;
    this.value = value;
    this.priority = priority;
  }
}

/**
 * Treap: a randomized binary search tree that stores a random priority per node and maintains
 * min-heap order on those priorities alongside BST order on keys.
 *
 * Push, get, and delete are O(log n) expected and O(n) worst case over the random priorities. The
 * priority stream is the constructor's `rng`, so the same seed and operation sequence reproduce the
 * same shape. Priorities are internal and are not serialized.
 *
 * `validate()` checks BST order, heap order on priorities, cached subtree sizes, and the node count.
 * It never requires balance: expected balance comes from the priorities, not from a stored invariant.
 */
export class Treap<K, V = K> extends RandomizedTreeBase<
  K,
  V,
  TreapNode<K, V>
> {
  /** O(1); `compare` defaults to natural order and `rng` defaults to a CSPRNG seed. */
  constructor(compare?: Comparator<K>, options?: RandomOptions) {
    super(compare, options);
  }

  /** O(n log n) expected: rebuilds by inserting the sorted entries; priorities are fresh. */
  static deserialize<K, V>(
    json: unknown,
    compare?: Comparator<K>,
    options?: RandomOptions,
  ): Treap<K, V> {
    const entries = readRandomizedEntries<K, V>(json, "Treap");
    const tree = new Treap<K, V>(compare, options);
    for (const [key, value] of entries) {
      tree.set(key, value);
    }
    return tree;
  }

  protected override createNode(key: K, value: V): TreapNode<K, V> {
    const priority = this.rng.next();
    if (typeof priority !== "number" || !Number.isFinite(priority)) {
      throw new TypeError("rng.next() must return a finite number");
    }
    return new TreapNode<K, V>(key, value, priority);
  }

  /**
   * O(log n) expected: if the new priority beats the subtree root, split at the key and make the
   * new node the root; otherwise recurse and re-cache sizes.
   */
  protected override insertNode(
    root: TreapNode<K, V> | null,
    node: TreapNode<K, V>,
  ): TreapNode<K, V> {
    if (root === null) {
      return node;
    }
    if (node.priority < root.priority) {
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

  /** O(log n) expected: meld the two subtrees of the removed node by priority. */
  protected override deleteNode(
    root: TreapNode<K, V>,
    key: K,
  ): [TreapNode<K, V> | null, boolean] {
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
    return [this.mergeNodes(root.left, root.right), true];
  }

  /** O(1): detects a priority that is not a finite number or breaks heap order. */
  protected override checkNode(node: TreapNode<K, V>): true | string {
    if (!Number.isFinite(node.priority)) {
      return "node priority is not finite";
    }
    if (node.left !== null && node.left.priority < node.priority) {
      return "treap heap order is violated at a left child";
    }
    if (node.right !== null && node.right.priority < node.priority) {
      return "treap heap order is violated at a right child";
    }
    return true;
  }

  protected override get serializationType(): string {
    return "Treap";
  }

  /** O(log n) expected: split a tree into keys `< key` and keys `>= key`. */
  private splitByKey(
    root: TreapNode<K, V> | null,
    key: K,
  ): [TreapNode<K, V> | null, TreapNode<K, V> | null] {
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
   * O(log n) expected: meld two treaps whose keys are fully ordered (everything in `left` is less
   * than everything in `right`) by comparing priorities.
   */
  private mergeNodes(
    left: TreapNode<K, V> | null,
    right: TreapNode<K, V> | null,
  ): TreapNode<K, V> | null {
    if (left === null) {
      return right;
    }
    if (right === null) {
      return left;
    }
    if (left.priority <= right.priority) {
      left.right = this.mergeNodes(left.right, right);
      updateTreeNode(left);
      return left;
    }
    right.left = this.mergeNodes(left, right.left);
    updateTreeNode(right);
    return right;
  }
}
