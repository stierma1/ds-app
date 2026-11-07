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

export class GeneralTree<T>
  extends ContainerBase<T>
  implements GeneralTreeContract<T>
{
  private _root: GeneralNode<T> | null = null;

  constructor(root: TreeNode<T> | null = null) {
    super();
    this._root = root as GeneralNode<T> | null;
  }

  get root(): GeneralNode<T> | null {
    return this._root;
  }

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

  override isEmpty(): boolean {
    return this._root === null;
  }

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

  parent(node: TreeNode<T>): TreeNode<T> | null {
    return this.assertOwned(node).parent;
  }

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

  degree(node: TreeNode<T>): number {
    return [...this.children(node)].length;
  }

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

  clear(): void {
    this._root = null;
    this.touch();
  }

  toArray(): T[] {
    return [...this.preorder()];
  }

  [Symbol.iterator](): IterableIterator<T> {
    return this.preorder();
  }

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
