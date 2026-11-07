import {
  ContainerBase,
  parseSerialized,
  readArray,
  readInteger,
  readObject,
  readValue,
  serializeRecord,
} from "../core/index.ts";
import type { TreeNode, TreeLike } from "./types.ts";

/** O(1): allocates a detached node; link it into a parent's left/right yourself. */
export function makeNode<T>(
  value: T,
  parent: TreeNode<T> | null = null,
): TreeNode<T> {
  return { value, left: null, right: null, parent };
}

/**
 * Plain pointer-linked binary tree over TreeNode records with parent pointers; no
 * ordering and no cached node count, so `size`, `height`, and `validate` each walk
 * all n nodes per call. Every traversal (pre/in/post/level order, Euler tour) is
 * iterative with an explicit stack or queue, safe on deep or path-shaped trees, but
 * each materializes a full O(n) array before returning a snapshot iterator; none is
 * lazy. The snapshot throws ConcurrentModificationError only if the version changes,
 * and only `clear()` bumps it; edits made directly through exposed nodes go unseen.
 * Prefer BinarySearchTree for keyed lookup, GeneralTree for arbitrary arity.
 */
export class BinaryTree<T> extends ContainerBase<T> implements TreeLike<T> {
  private _root: TreeNode<T> | null;

  /** O(1): adopts an existing node graph as-is without copying or validating it. */
  constructor(root: TreeNode<T> | null = null) {
    super();
    this._root = root;
  }

  /**
   * O(n) node allocations from a level-order array with null holes. The BFS queue is
   * drained with Array.shift(), which can be linear per call depending on the engine,
   * so very large inputs may trend toward O(n^2).
   */
  static fromComplete<T>(values: Array<T | null>): BinaryTree<T> {
    if (values.length === 0 || values[0] === null) {
      return new BinaryTree<T>(null);
    }
    const root = makeNode(values[0]);
    const queue: TreeNode<T>[] = [root];
    let index = 1;
    while (queue.length > 0 && index < values.length) {
      const parent = queue.shift()!;
      const left = values[index++];
      if (left !== null && left !== undefined) {
        const child = makeNode(left, parent);
        parent.left = child;
        queue.push(child);
      }
      if (index >= values.length) {
        break;
      }
      const right = values[index++];
      if (right !== null && right !== undefined) {
        const child = makeNode(right, parent);
        parent.right = child;
        queue.push(child);
      }
    }
    return new BinaryTree(root);
  }

  /** O(1): returns the live root node, not a copy. */
  get root(): TreeNode<T> | null {
    return this._root;
  }

  /** O(n): no count is cached, so every read walks the whole tree; cache it if you poll. */
  override get size(): number {
    let count = 0;
    const stack: TreeNode<T>[] = this._root === null ? [] : [this._root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      count++;
      if (node.right !== null) stack.push(node.right);
      if (node.left !== null) stack.push(node.left);
    }
    return count;
  }

  /** O(1): checks the root pointer only, unlike `size`. */
  override isEmpty(): boolean {
    return this._root === null;
  }

  /** O(n): breadth-first level sweep allocating one array per level; -1 when empty. */
  get height(): number {
    if (this._root === null) {
      return -1;
    }
    let height = 0;
    let level: TreeNode<T>[] = [this._root];
    while (level.length > 0) {
      const next: TreeNode<T>[] = [];
      for (const node of level) {
        if (node.left !== null) next.push(node.left);
        if (node.right !== null) next.push(node.right);
      }
      if (next.length > 0) {
        height++;
      }
      level = next;
    }
    return height;
  }

  /** O(n) time and space: iterative explicit-stack walk, materialized into a snapshot array. */
  preorder(): IterableIterator<T> {
    const values: T[] = [];
    const stack: TreeNode<T>[] = this._root === null ? [] : [this._root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      values.push(node.value);
      if (node.right !== null) stack.push(node.right);
      if (node.left !== null) stack.push(node.left);
    }
    return this.snapshotIterator(values);
  }

  /** O(n) time and space: iterative explicit-stack walk; returns a materialized snapshot. */
  inorder(): IterableIterator<T> {
    const values: T[] = [];
    const stack: TreeNode<T>[] = [];
    let node = this._root;
    while (node !== null || stack.length > 0) {
      while (node !== null) {
        stack.push(node);
        node = node.left;
      }
      node = stack.pop()!;
      values.push(node.value);
      node = node.right;
    }
    return this.snapshotIterator(values);
  }

  /** O(n): reversed root-right-left preorder, so one stack plus an array reverse; not lazy. */
  postorder(): IterableIterator<T> {
    const values: T[] = [];
    const stack: TreeNode<T>[] = this._root === null ? [] : [this._root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      values.push(node.value);
      if (node.left !== null) stack.push(node.left);
      if (node.right !== null) stack.push(node.right);
    }
    values.reverse();
    return this.snapshotIterator(values);
  }

  /** O(n): BFS with an index cursor instead of Array.shift(); materialized snapshot. */
  levelOrder(): IterableIterator<T> {
    const values: T[] = [];
    const queue: TreeNode<T>[] = this._root === null ? [] : [this._root];
    let index = 0;
    while (index < queue.length) {
      const node = queue[index++];
      values.push(node.value);
      if (node.left !== null) queue.push(node.left);
      if (node.right !== null) queue.push(node.right);
    }
    return this.snapshotIterator(values);
  }

  /**
   * O(n) time, 2n-1 values materialized: iterative frame stack, no recursion. Each
   * frame re-filters its [left, right] pair per visit, so expect a few small
   * allocations per node beyond the output array.
   */
  eulerTour(): IterableIterator<T> {
    const values: T[] = [];
    if (this._root === null) {
      return this.snapshotIterator(values);
    }
    interface Frame {
      node: TreeNode<T>;
      entered: boolean;
      childIndex: number;
    }
    const stack: Frame[] = [{ node: this._root, entered: false, childIndex: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (!frame.entered) {
        frame.entered = true;
        values.push(frame.node.value);
        continue;
      }
      const children = [frame.node.left, frame.node.right].filter(
        (child): child is TreeNode<T> => child !== null,
      );
      if (frame.childIndex < children.length) {
        const child = children[frame.childIndex++];
        stack.push({ node: child, entered: false, childIndex: 0 });
      } else {
        stack.pop();
        if (stack.length > 0) {
          values.push(stack[stack.length - 1].node.value);
        }
      }
    }
    return this.snapshotIterator(values);
  }

  /** O(n): preorder walk emitting {value, parent, side} per node, then one JSON.stringify. */
  serialize(): string {
    const nodes: Array<{
      value: T;
      parent: number;
      side: "left" | "right" | null;
    }> = [];
    if (this._root !== null) {
      const stack: Array<{
        node: TreeNode<T>;
        parent: number;
        side: "left" | "right" | null;
      }> = [{ node: this._root, parent: -1, side: null }];
      while (stack.length > 0) {
        const current = stack.pop()!;
        if (current.node.value === undefined) {
          throw new TypeError("Cannot serialize a node with an undefined value");
        }
        const index = nodes.length;
        nodes.push({
          value: current.node.value,
          parent: current.parent,
          side: current.side,
        });
        if (current.node.right !== null) {
          stack.push({ node: current.node.right, parent: index, side: "right" });
        }
        if (current.node.left !== null) {
          stack.push({ node: current.node.left, parent: index, side: "left" });
        }
      }
    }
    return serializeRecord("BinaryTree", { nodes });
  }

  /** O(n) single pass: entries reference earlier indices, so linking needs no search. */
  static deserialize<T>(json: unknown): BinaryTree<T> {
    const record = parseSerialized(json, "BinaryTree");
    const raw = readArray(record, "nodes");
    const tree = new BinaryTree<T>();
    if (raw.length === 0) {
      return tree;
    }
    const created: TreeNode<T>[] = [];
    for (let index = 0; index < raw.length; index++) {
      const entry = readObject(raw[index], `nodes[${index}]`);
      const value = readValue<T>(entry.value, `nodes[${index}].value`);
      const parent = readInteger(entry, "parent");
      const side = entry.side;
      if (side !== null && side !== "left" && side !== "right") {
        throw new TypeError(`nodes[${index}].side must be 'left', 'right', or null`);
      }
      const node = makeNode(value);
      if (index === 0) {
        if (parent !== -1 || side !== null) {
          throw new TypeError("root must have parent -1 and side null");
        }
        tree._root = node;
      } else {
        if (parent < 0 || parent >= index) {
          throw new TypeError(`nodes[${index}].parent must refer to an earlier node`);
        }
        if (side === null) {
          throw new TypeError(`nodes[${index}].side must be 'left' or 'right'`);
        }
        const parentNode = created[parent];
        if (side === "left") {
          if (parentNode.left !== null) {
            throw new TypeError(`nodes[${index}] would replace an existing left child`);
          }
          parentNode.left = node;
        } else {
          if (parentNode.right !== null) {
            throw new TypeError(`nodes[${index}] would replace an existing right child`);
          }
          parentNode.right = node;
        }
        node.parent = parentNode;
      }
      created.push(node);
    }
    return tree;
  }

  /** O(1): drops the root pointer (no per-node work) and bumps the version. */
  clear(): void {
    this._root = null;
    this.touch();
  }

  /** O(n) preorder; allocates twice (the traversal snapshot, then the spread copy). */
  toArray(): T[] {
    return [...this.preorder()];
  }

  /** Preorder; see preorder(): materialized O(n) snapshot, not lazy. */
  [Symbol.iterator](): IterableIterator<T> {
    return this.preorder();
  }

  /** O(n) with a Set of visited nodes, plus a second full walk for the `size` cross-check. */
  validate(): true | string {
    if (this._root === null) {
      return true;
    }
    if (this._root.parent !== null) {
      return "root has a parent";
    }
    const seen = new Set<TreeNode<T>>();
    const stack: TreeNode<T>[] = [this._root];
    let count = 0;
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (seen.has(node)) {
        return "cycle detected in tree links";
      }
      seen.add(node);
      count++;
      if (node.value === undefined) {
        return `node at index ${count - 1} has an undefined value`;
      }
      if (node.left !== null) {
        if (node.left.parent !== node) {
          return `left child of node ${count - 1} has an incorrect parent link`;
        }
        stack.push(node.left);
      }
      if (node.right !== null) {
        if (node.right.parent !== node) {
          return `right child of node ${count - 1} has an incorrect parent link`;
        }
        stack.push(node.right);
      }
    }
    if (count !== this.size) {
      return "node count changed during validation";
    }
    return true;
  }
}
