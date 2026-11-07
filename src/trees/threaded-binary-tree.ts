import type { Comparator } from "../core/index.ts";
import {
  BinarySearchTree,
  BSTNode,
  insertBalanced,
  readBstEntries,
  serializeBstEntries,
} from "./binary-search-tree.ts";
import type { TreeNode } from "./types.ts";

export class ThreadedNode<K, V> extends BSTNode<K, V> {
  leftThread: BSTNode<K, V> | null = null;
  rightThread: BSTNode<K, V> | null = null;
}

export class ThreadedBinaryTree<K, V = K> extends BinarySearchTree<K, V> {
  protected override createNode(
    value: [K, V],
    parent: BSTNode<K, V> | null,
  ): BSTNode<K, V> {
    return new ThreadedNode(value, parent);
  }

  override serialize(): string {
    return serializeBstEntries("ThreadedBinaryTree", this.toArray());
  }

  static override deserialize<K, V>(
    json: unknown,
    compare?: Comparator<K>,
  ): ThreadedBinaryTree<K, V> {
    const entries = readBstEntries<K, V>(json, "ThreadedBinaryTree");
    const tree = new ThreadedBinaryTree<K, V>(compare);
    insertBalanced(tree, entries);
    return tree;
  }

  override successorNode(node: TreeNode<[K, V]>): TreeNode<[K, V]> | null {
    const owned = this.assertOwned(node) as ThreadedNode<K, V>;
    return owned.rightThread;
  }

  override predecessorNode(node: TreeNode<[K, V]>): TreeNode<[K, V]> | null {
    const owned = this.assertOwned(node) as ThreadedNode<K, V>;
    return owned.leftThread;
  }

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
