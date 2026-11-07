import type { Comparator } from "../core/index.ts";
import {
  BinarySearchTree,
  BSTNode,
  insertBalanced,
  readBstEntries,
  serializeBstEntries,
} from "./binary-search-tree.ts";
import type { TreeNode } from "./types.ts";

/**
 * BSTNode plus explicit leftThread/rightThread pointers to the in-order predecessor
 * and successor. Unlike the classic scheme that reuses null child slots, these are
 * two extra fields on every node, kept alongside the real left/right/parent links.
 */
export class ThreadedNode<K, V> extends BSTNode<K, V> {
  leftThread: BSTNode<K, V> | null = null;
  rightThread: BSTNode<K, V> | null = null;
}

/**
 * BinarySearchTree whose nodes also form a doubly linked in-order list through
 * leftThread/rightThread. Same O(h) set/get/delete/at/indexOf/range and the same
 * O(n) height on sorted input; threads are patched in O(1) on each insert/delete
 * from neighbors the base search already found, so they cost no extra traversal,
 * only two pointers per node. The payoff is successorNode/predecessorNode: an O(1)
 * pointer read with no stack or subtree descent, after an O(1) ownership check.
 * Iteration and range() do not use the threads;
 * they are the base class's materialized snapshots. Prefer this for node stepping.
 */
export class ThreadedBinaryTree<K, V = K> extends BinarySearchTree<K, V> {
  /** O(1): allocates a ThreadedNode so the base insert path needs no changes. */
  protected override createNode(
    value: [K, V],
    parent: BSTNode<K, V> | null,
  ): BSTNode<K, V> {
    return new ThreadedNode(value, parent);
  }

  /** O(n): same sorted entry dump as the base; threads are not stored, they are rebuilt. */
  override serialize(): string {
    return serializeBstEntries("ThreadedBinaryTree", this.toArray());
  }

  /** O(n log n): median-first inserts yield a balanced tree with threads rebuilt by the hooks. */
  static override deserialize<K, V>(
    json: unknown,
    compare?: Comparator<K>,
  ): ThreadedBinaryTree<K, V> {
    const entries = readBstEntries<K, V>(json, "ThreadedBinaryTree");
    const tree = new ThreadedBinaryTree<K, V>(compare);
    insertBalanced(tree, entries);
    return tree;
  }

  /**
   * O(1): an ownership check and a thread read; no stack and no descent into the right
   * subtree, unlike the base class's O(h) step.
   */
  override successorNode(node: TreeNode<[K, V]>): TreeNode<[K, V]> | null {
    const owned = this.assertOwned(node) as ThreadedNode<K, V>;
    return owned.rightThread;
  }

  /** O(1): ownership check plus a leftThread read (the base class steps O(h)). */
  override predecessorNode(node: TreeNode<[K, V]>): TreeNode<[K, V]> | null {
    const owned = this.assertOwned(node) as ThreadedNode<K, V>;
    return owned.leftThread;
  }

  /** O(n): base validate(), then one in-order sweep checking every thread pointer. */
  override validate(): true | string {
    const base = super.validate();
    if (base !== true) {
      return base;
    }
    const first = this.minNode();
    let node: BSTNode<K, V> | null = first;
    let previous: BSTNode<K, V> | null = null;
    let count = 0;
    while (node !== null) {
      if (!(node instanceof ThreadedNode)) {
        return "node is not a threaded node";
      }
      if (node.leftThread !== previous) {
        return `left thread at index ${count} points to the wrong predecessor`;
      }
      const next = this._successorNode(node);
      if (node.rightThread !== next) {
        return `right thread at index ${count} points to the wrong successor`;
      }
      previous = node;
      node = next;
      count++;
      if (count > this.size) {
        return "thread traversal exceeds size";
      }
    }
    if (count !== this.size) {
      return `thread traversal visited ${count} of ${this.size} nodes`;
    }
    return true;
  }

  /** O(1): four pointer writes splicing the new node between its predecessor and successor. */
  protected override onInserted(
    node: BSTNode<K, V>,
    predecessor: BSTNode<K, V> | null,
    successor: BSTNode<K, V> | null,
  ): void {
    const threaded = node as ThreadedNode<K, V>;
    threaded.leftThread = predecessor;
    threaded.rightThread = successor;
    if (predecessor !== null) {
      (predecessor as ThreadedNode<K, V>).rightThread = threaded;
    }
    if (successor !== null) {
      (successor as ThreadedNode<K, V>).leftThread = threaded;
    }
  }

  /** O(1): relinks neighbors around the removed node and repoints a two-child replacement. */
  protected override onRemoved(
    node: BSTNode<K, V>,
    predecessor: BSTNode<K, V> | null,
    successor: BSTNode<K, V> | null,
    replacement: BSTNode<K, V> | null,
  ): void {
    if (predecessor !== null) {
      (predecessor as ThreadedNode<K, V>).rightThread = successor;
    }
    if (successor !== null) {
      (successor as ThreadedNode<K, V>).leftThread = predecessor;
    }
    if (replacement !== null) {
      const threaded = replacement as ThreadedNode<K, V>;
      if (threaded.rightThread === node) {
        threaded.rightThread = successor;
      }
    }
    const removed = node as ThreadedNode<K, V>;
    removed.leftThread = null;
    removed.rightThread = null;
  }
}
