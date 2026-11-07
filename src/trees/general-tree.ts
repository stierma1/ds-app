import {
  assertDefined,
  ContainerBase,
  parseSerialized,
  readArray,
  readInteger,
  readObject,
  readValue,
  serializeRecord,
} from "../core/index.ts";
import type { GeneralTree as GeneralTreeContract, TreeNode } from "./types.ts";

/**
 * Node in first-child/next-sibling form: `left` is the first child and `right` is the
 * next sibling, both singly linked. Two pointers per node regardless of arity, at the
 * cost of O(d) walks to reach the last child or a node's previous sibling.
 */
export class GeneralNode<T> implements TreeNode<T> {
  value: T;
  left: GeneralNode<T> | null = null;
  right: GeneralNode<T> | null = null;
  parent: GeneralNode<T> | null;

  constructor(value: T, parent: GeneralNode<T> | null) {
    this.value = value;
    this.parent = parent;
  }
}

/**
 * Rose tree (any arity) stored as a left-child/right-sibling chain over GeneralNode,
 * with parent pointers. Memory is two pointers per node and detaching a subtree is a
 * relink, but with no last-child/previous-sibling pointers and no cached count,
 * addChild/remove/children/degree are O(d) in the parent's degree and `size`,
 * `height`, and `validate` walk all n nodes per call. Every node-taking method first
 * climbs to the root (O(depth)) to verify ownership, including the trivial parent().
 * Traversals are iterative (explicit stack/queue, safe on deep trees) and each
 * materializes an O(n) array behind a snapshot iterator; direct node edits go unseen.
 */
export class GeneralTree<T>
  extends ContainerBase<T>
  implements GeneralTreeContract<T>
{
  private _root: GeneralNode<T> | null = null;

  /** O(1): adopts the given root without copying; it must already be a GeneralNode graph. */
  constructor(root: TreeNode<T> | null = null) {
    super();
    this._root = root as GeneralNode<T> | null;
  }

  /** O(1): live root node. */
  get root(): GeneralNode<T> | null {
    return this._root;
  }

  /** O(n): nothing caches the count; every read is a full iterative walk. */
  override get size(): number {
    let count = 0;
    const stack: GeneralNode<T>[] = this._root === null ? [] : [this._root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      count++;
      let child = node.left;
      while (child !== null) {
        stack.push(child);
        child = child.right;
      }
    }
    return count;
  }

  /** O(1): root check only, unlike `size`. */
  override isEmpty(): boolean {
    return this._root === null;
  }

  /** O(n): level-by-level sweep allocating one array per level; -1 when empty. */
  get height(): number {
    if (this._root === null) {
      return -1;
    }
    let height = 0;
    let level: GeneralNode<T>[] = [this._root];
    while (level.length > 0) {
      const next: GeneralNode<T>[] = [];
      for (const node of level) {
        let child = node.left;
        while (child !== null) {
          next.push(child);
          child = child.right;
        }
      }
      if (next.length > 0) {
        height++;
      }
      level = next;
    }
    return height;
  }

  /**
   * O(depth(parent) + d): climbs to the root for the ownership check, then walks the
   * parent's sibling chain to append as the LAST child (no tail pointer). Appending
   * many children to one node is therefore O(d^2) overall. Root creation is O(1).
   */
  addChild(parent: TreeNode<T> | null, value: T): GeneralNode<T> {
    assertDefined(value);
    if (parent === null) {
      if (this._root !== null) {
        throw new RangeError("tree already has a root");
      }
      const node = new GeneralNode(value, null);
      this._root = node;
      this.touch();
      return node;
    }
    const owned = this.assertOwned(parent);
    const node = new GeneralNode(value, owned);
    if (owned.left === null) {
      owned.left = node;
    } else {
      let last = owned.left;
      while (last.right !== null) {
        last = last.right;
      }
      last.right = node;
    }
    this.touch();
    return node;
  }

  /**
   * O(depth + d): ownership climb, then a walk along the sibling chain to find the
   * previous sibling (singly linked), then an O(1) relink. The whole subtree comes off
   * intact and its nodes are not visited, so cost is independent of subtree size.
   */
  remove(node: TreeNode<T>): boolean {
    const owned = this.assertOwned(node);
    if (owned === this._root) {
      this._root = null;
    } else {
      const parent = owned.parent!;
      if (parent.left === owned) {
        parent.left = owned.right;
      } else {
        let previous = parent.left!;
        while (previous.right !== owned) {
          previous = previous.right!;
        }
        previous.right = owned.right;
      }
    }
    owned.parent = null;
    owned.right = null;
    this.touch();
    return true;
  }

  /** O(depth): a pointer read, but preceded by the ownership climb to the root. */
  parent(node: TreeNode<T>): TreeNode<T> | null {
    return this.assertOwned(node).parent;
  }

  /** O(depth + d): ownership climb, then copies the sibling chain into a fresh array. */
  children(node: TreeNode<T>): Iterable<TreeNode<T>> {
    const owned = this.assertOwned(node);
    const result: GeneralNode<T>[] = [];
    let child = owned.left;
    while (child !== null) {
      result.push(child);
      child = child.right;
    }
    return result;
  }

  /** O(depth + d): builds the children array and then spreads it again; no counter is kept. */
  degree(node: TreeNode<T>): number {
    return [...this.children(node)].length;
  }

  /** O(n): iterative explicit stack, one children array per node; materialized snapshot. */
  preorder(): IterableIterator<T> {
    const values: T[] = [];
    if (this._root === null) {
      return this.snapshotIterator(values);
    }
    const stack: GeneralNode<T>[] = [this._root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      values.push(node.value);
      const children = this.childrenOf(node);
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push(children[i]);
      }
    }
    return this.snapshotIterator(values);
  }

  /** O(n): iterative frame stack (no recursion), one children array per frame; materialized. */
  postorder(): IterableIterator<T> {
    const values: T[] = [];
    if (this._root === null) {
      return this.snapshotIterator(values);
    }
    interface Frame {
      node: GeneralNode<T>;
      children: GeneralNode<T>[];
      childIndex: number;
    }
    const stack: Frame[] = [
      { node: this._root, children: this.childrenOf(this._root), childIndex: 0 },
    ];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame.childIndex < frame.children.length) {
        const child = frame.children[frame.childIndex++];
        stack.push({
          node: child,
          children: this.childrenOf(child),
          childIndex: 0,
        });
      } else {
        values.push(frame.node.value);
        stack.pop();
      }
    }
    return this.snapshotIterator(values);
  }

  /** O(n): index-cursor BFS walking sibling chains in place, no per-node arrays; materialized. */
  levelOrder(): IterableIterator<T> {
    const values: T[] = [];
    const queue: GeneralNode<T>[] = this._root === null ? [] : [this._root];
    let index = 0;
    while (index < queue.length) {
      const node = queue[index++];
      values.push(node.value);
      let child = node.left;
      while (child !== null) {
        queue.push(child);
        child = child.right;
      }
    }
    return this.snapshotIterator(values);
  }

  /** O(n): preorder walk emitting {value, parent index} per node, then one JSON.stringify. */
  serialize(): string {
    const nodes: Array<{ value: T; parent: number }> = [];
    if (this._root !== null) {
      const stack: Array<{ node: GeneralNode<T>; parent: number }> = [
        { node: this._root, parent: -1 },
      ];
      while (stack.length > 0) {
        const current = stack.pop()!;
        if (current.node.value === undefined) {
          throw new TypeError("Cannot serialize a node with an undefined value");
        }
        const index = nodes.length;
        nodes.push({ value: current.node.value, parent: current.parent });
        const children = this.childrenOf(current.node);
        for (let childIndex = children.length - 1; childIndex >= 0; childIndex--) {
          stack.push({ node: children[childIndex], parent: index });
        }
      }
    }
    return serializeRecord("GeneralTree", { nodes });
  }

  /**
   * Rebuilds via addChild per node, so each entry pays O(depth + d): about O(n) for
   * bushy trees but O(n^2) for a star (one node with n-1 children) or a long path.
   */
  static deserialize<T>(json: unknown): GeneralTree<T> {
    const record = parseSerialized(json, "GeneralTree");
    const raw = readArray(record, "nodes");
    const tree = new GeneralTree<T>();
    if (raw.length === 0) {
      return tree;
    }
    const created: GeneralNode<T>[] = [];
    for (let index = 0; index < raw.length; index++) {
      const entry = readObject(raw[index], `nodes[${index}]`);
      const value = readValue<T>(entry.value, `nodes[${index}].value`);
      const parent = readInteger(entry, "parent");
      if (index === 0) {
        if (parent !== -1) {
          throw new TypeError("root must have parent -1");
        }
        created.push(tree.addChild(null, value));
      } else {
        if (parent < 0 || parent >= index) {
          throw new TypeError(`nodes[${index}].parent must refer to an earlier node`);
        }
        created.push(tree.addChild(created[parent], value));
      }
    }
    return tree;
  }

  /** O(1): drops the root; detached nodes are left for the GC. */
  clear(): void {
    this._root = null;
    this.touch();
  }

  /** O(n) preorder; allocates twice (traversal snapshot, then the spread copy). */
  toArray(): T[] {
    return [...this.preorder()];
  }

  /** Preorder; materialized O(n) snapshot, not lazy. */
  [Symbol.iterator](): IterableIterator<T> {
    return this.preorder();
  }

  /** O(n) with a visited Set, plus a second full walk for the `size` cross-check. */
  validate(): true | string {
    if (this._root === null) {
      return true;
    }
    if (this._root.parent !== null) {
      return "root has a parent";
    }
    const seen = new Set<GeneralNode<T>>();
    const stack: GeneralNode<T>[] = [this._root];
    let count = 0;
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (seen.has(node)) {
        return "node is reachable more than once";
      }
      seen.add(node);
      count++;
      if (node.value === undefined) {
        return `node at index ${count - 1} has an undefined value`;
      }
      let child = node.left;
      while (child !== null) {
        if (child.parent !== node) {
          return `child of node at index ${count - 1} has an incorrect parent link`;
        }
        if (child.right !== null && child.right.parent !== node) {
          return `sibling chain of node at index ${count - 1} has an incorrect parent link`;
        }
        stack.push(child);
        child = child.right;
      }
    }
    if (count !== this.size) {
      return "node count changed during validation";
    }
    return true;
  }

  private childrenOf(node: GeneralNode<T>): GeneralNode<T>[] {
    const result: GeneralNode<T>[] = [];
    let child = node.left;
    while (child !== null) {
      result.push(child);
      child = child.right;
    }
    return result;
  }

  /** O(depth) climb to the root; the fixed cost of every node-taking public method. */
  private assertOwned(node: TreeNode<T>): GeneralNode<T> {
    if (!(node instanceof GeneralNode)) {
      throw new TypeError("Node does not belong to this tree");
    }
    let root: GeneralNode<T> | null = node;
    while (root.parent !== null) {
      root = root.parent;
    }
    if (root !== this._root) {
      throw new TypeError("Node does not belong to this tree");
    }
    return node;
  }
}
