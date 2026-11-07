import {
  ConcurrentModificationError,
  parseSerialized,
  readArray,
  readNumberValue,
  readString,
  readValue,
  serializeRecord,
} from "../core/index.ts";
import { BinaryTree, makeNode } from "./binary-tree.ts";
import { GeneralTree } from "./general-tree.ts";
import type {
  GeneralTree as GeneralTreeContract,
  LowestCommonAncestor,
  TreeNode,
  TreeLike,
} from "./types.ts";

type LcaMethod = "euler-rmq" | "binary-lifting";

interface Versioned {
  readonly version?: number;
}

function childrenOf<T>(tree: TreeLike<T> | GeneralTreeContract<T>, node: TreeNode<T>): TreeNode<T>[] {
  if (tree instanceof GeneralTree) {
    const result: TreeNode<T>[] = [];
    let child = node.left;
    while (child !== null) {
      result.push(child);
      child = child.right;
    }
    return result;
  }
  const result: TreeNode<T>[] = [];
  if (node.left !== null) result.push(node.left);
  if (node.right !== null) result.push(node.right);
  return result;
}

class SnapshotLca<T> implements LowestCommonAncestor<T> {
  private readonly _nodes: TreeNode<T>[];
  private readonly _indexOf: Map<TreeNode<T>, number>;
  private readonly _parent: number[];
  private readonly _depth: number[];
  private readonly _children: number[][];
  private readonly _version: number | undefined;
  private readonly _tree: TreeLike<T> | GeneralTreeContract<T>;
  private readonly _method: LcaMethod;
  private readonly _up: number[][];
  private readonly _first: Int32Array | null;
  private readonly _eulerNodes: number[] | null;
  private readonly _eulerDepths: number[] | null;
  private readonly _sparse: number[][] | null;

  constructor(
    tree: TreeLike<T> | GeneralTreeContract<T>,
    method: LcaMethod,
    nodes: TreeNode<T>[],
    indexOf: Map<TreeNode<T>, number>,
    parent: number[],
    depth: number[],
    children: number[][],
    version: number | undefined,
  ) {
    this._tree = tree;
    this._method = method;
    this._nodes = nodes;
    this._indexOf = indexOf;
    this._parent = parent;
    this._depth = depth;
    this._children = children;
    this._version = version;

    let maxDepth = 0;
    for (const value of depth) {
      if (value > maxDepth) maxDepth = value;
    }
    const log = Math.max(1, Math.ceil(Math.log2(maxDepth + 2)));
    this._up = [parent.map((value) => (value < 0 ? 0 : value))];
    for (let level = 1; level < log; level++) {
      const previous = this._up[level - 1];
      this._up.push(previous.map((value) => previous[value]));
    }

    if (method === "euler-rmq") {
      const euler: number[] = [];
      const depths: number[] = [];
      const first = new Int32Array(nodes.length).fill(-1);
      if (nodes.length > 0) {
        first[0] = 0;
        euler.push(0);
        depths.push(depth[0]);
        const stack: Array<{ node: number; childIndex: number }> = [
          { node: 0, childIndex: 0 },
        ];
        while (stack.length > 0) {
          const frame = stack[stack.length - 1];
          const childList = children[frame.node];
          if (frame.childIndex < childList.length) {
            const child = childList[frame.childIndex++];
            first[child] = euler.length;
            euler.push(child);
            depths.push(depth[child]);
            stack.push({ node: child, childIndex: 0 });
          } else {
            stack.pop();
            if (stack.length > 0) {
              const parentNode = stack[stack.length - 1].node;
              euler.push(parentNode);
              depths.push(depth[parentNode]);
            }
          }
        }
      }
      this._first = first;
      this._eulerNodes = euler;
      this._eulerDepths = depths;
      if (euler.length === 0) {
        this._sparse = [];
      } else {
        const levels = Math.floor(Math.log2(euler.length)) + 1;
        const table: number[][] = [euler.map((_, index) => index)];
        for (let level = 1; level < levels; level++) {
          const previous = table[level - 1];
          const length = euler.length - (1 << level) + 1;
          const current = new Array<number>(Math.max(length, 0)).fill(0);
          for (let i = 0; i < length; i++) {
            const left = previous[i];
            const right = previous[i + (1 << (level - 1))];
            current[i] = depths[left] <= depths[right] ? left : right;
          }
          table.push(current);
        }
        this._sparse = table;
      }
    } else {
      this._first = null;
      this._eulerNodes = null;
      this._eulerDepths = null;
      this._sparse = null;
    }
  }

  get size(): number {
    return this._nodes.length;
  }

  get nodes(): readonly TreeNode<T>[] {
    return this._nodes;
  }

  lca(a: TreeNode<T>, b: TreeNode<T>): TreeNode<T> {
    this.ensureAlive();
    const left = this.indexOfNode(a);
    const right = this.indexOfNode(b);
    if (left === right) {
      return a;
    }
    const index = this._method === "euler-rmq" ? this.lcaEuler(left, right) : this.lcaLifting(left, right);
    return this._nodes[index];
  }

  depth(node: TreeNode<T>): number {
    this.ensureAlive();
    return this._depth[this.indexOfNode(node)];
  }

  distance(a: TreeNode<T>, b: TreeNode<T>): number {
    const ancestor = this.lca(a, b);
    return this.depth(a) + this.depth(b) - 2 * this.depth(ancestor);
  }

  isAncestor(ancestor: TreeNode<T>, node: TreeNode<T>): boolean {
    this.ensureAlive();
    let current = this.indexOfNode(node);
    const target = this.indexOfNode(ancestor);
    const targetDepth = this._depth[target];
    if (this._depth[current] < targetDepth) {
      return false;
    }
    while (this._depth[current] > targetDepth) {
      current = this._parent[current];
    }
    return current === target;
  }

  serialize(): string {
    const values: T[] = [];
    for (const node of this._nodes) {
      if (node.value === undefined) {
        throw new TypeError("Cannot serialize a node with an undefined value");
      }
      values.push(node.value);
    }
    return serializeRecord("LowestCommonAncestor", {
      method: this._method,
      values,
      parent: this._parent,
      children: this._children,
    });
  }

  validate(): true | string {
    this.ensureAlive();
    if (this._nodes.length === 0) {
      return true;
    }
    if (this._parent[0] !== -1) {
      return "root has a parent";
    }
    if (this._depth[0] !== 0) {
      return "root depth is not zero";
    }
    for (let index = 1; index < this._nodes.length; index++) {
      const parent = this._parent[index];
      if (parent < 0 || parent >= this._nodes.length) {
        return `node ${index} has an invalid parent index`;
      }
      if (this._depth[index] !== this._depth[parent] + 1) {
        return `node ${index} has an inconsistent depth`;
      }
      if (!this._children[parent].includes(index)) {
        return `parent of node ${index} does not list it as a child`;
      }
    }
    if (this._method === "euler-rmq") {
      const first = this._first!;
      for (let index = 0; index < this._nodes.length; index++) {
        if (first[index] < 0) {
          return `node ${index} has no first Euler occurrence`;
        }
      }
    }
    return true;
  }

  private ensureAlive(): void {
    if (this._version === undefined) {
      return;
    }
    const current = (this._tree as Versioned).version;
    if (current !== undefined && current !== this._version) {
      throw new ConcurrentModificationError("Tree was modified after the LCA snapshot");
    }
  }

  private indexOfNode(node: TreeNode<T>): number {
    const index = this._indexOf.get(node);
    if (index === undefined) {
      throw new TypeError("Node does not belong to the snapshotted tree");
    }
    return index;
  }

  private lcaEuler(left: number, right: number): number {
    const first = this._first!;
    const depths = this._eulerDepths!;
    const table = this._sparse!;
    let start = first[left];
    let end = first[right];
    if (start > end) {
      const swap = start;
      start = end;
      end = swap;
    }
    const length = end - start + 1;
    const level = Math.floor(Math.log2(length));
    const span = 1 << level;
    const leftIndex = table[level][start];
    const rightIndex = table[level][end - span + 1];
    const chosen = depths[leftIndex] <= depths[rightIndex] ? leftIndex : rightIndex;
    return this._eulerNodes![chosen];
  }

  private lcaLifting(left: number, right: number): number {
    let a = left;
    let b = right;
    if (this._depth[a] < this._depth[b]) {
      const swap = a;
      a = b;
      b = swap;
    }
    let difference = this._depth[a] - this._depth[b];
    let level = 0;
    while (difference > 0) {
      if ((difference & 1) === 1) {
        a = this._up[level][a];
      }
      difference >>= 1;
      level++;
    }
    if (a === b) {
      return a;
    }
    for (let index = this._up.length - 1; index >= 0; index--) {
      if (this._up[index][a] !== this._up[index][b]) {
        a = this._up[index][a];
        b = this._up[index][b];
      }
    }
    return this._up[0][a];
  }
}

export function deserializeLca<T>(json: unknown): LowestCommonAncestor<T> {
  const record = parseSerialized(json, "LowestCommonAncestor");
  const method = readString(record, "method");
  if (method !== "euler-rmq" && method !== "binary-lifting") {
    throw new TypeError("method must be 'euler-rmq' or 'binary-lifting'");
  }
  const values = readArray(record, "values");
  const parent = readArray(record, "parent");
  const children = readArray(record, "children");
  const size = values.length;
  if (parent.length !== size || children.length !== size) {
    throw new TypeError("values, parent, and children must have the same length");
  }
  const nodes: TreeNode<T>[] = [];
  const indexOf = new Map<TreeNode<T>, number>();
  for (let index = 0; index < size; index++) {
    const node = makeNode(readValue<T>(values[index], `values[${index}]`));
    nodes.push(node);
    indexOf.set(node, index);
  }
  const parentIndices: number[] = [];
  for (let index = 0; index < size; index++) {
    const value = readNumberValue(parent[index], `parent[${index}]`);
    if (!Number.isInteger(value)) {
      throw new TypeError(`parent[${index}] must be an integer`);
    }
    if (index === 0) {
      if (value !== -1) {
        throw new TypeError("root must have parent -1");
      }
    } else if (value < 0 || value >= index) {
      throw new TypeError(`parent[${index}] must refer to an earlier node`);
    }
    parentIndices.push(value);
    if (value >= 0) {
      nodes[index].parent = nodes[value];
    }
  }
  const childIndices: number[][] = [];
  const seenChildren = new Set<number>();
  for (let index = 0; index < size; index++) {
    const raw = children[index];
    if (!Array.isArray(raw)) {
      throw new TypeError(`children[${index}] must be an array`);
    }
    const list: number[] = [];
    for (const child of raw) {
      const value = readNumberValue(child, `children[${index}] entry`);
      if (!Number.isInteger(value) || value <= index || value >= size) {
        throw new TypeError(`children[${index}] contains an invalid child index`);
      }
      if (seenChildren.has(value)) {
        throw new TypeError(`node ${value} is listed as a child more than once`);
      }
      if (parentIndices[value] !== index) {
        throw new TypeError(`node ${value} does not have parent ${index}`);
      }
      seenChildren.add(value);
      list.push(value);
    }
    childIndices.push(list);
  }
  if (seenChildren.size !== Math.max(size - 1, 0)) {
    throw new TypeError("serialized tree is not connected");
  }
  const depth = new Array<number>(size).fill(0);
  for (let index = 1; index < size; index++) {
    depth[index] = depth[parentIndices[index]] + 1;
  }
  return new SnapshotLca<T>(
    new BinaryTree<T>(),
    method,
    nodes,
    indexOf,
    parentIndices,
    depth,
    childIndices,
    undefined,
  );
}

export function buildLca<T>(
  tree: TreeLike<T> | GeneralTreeContract<T>,
  method: LcaMethod = "euler-rmq",
): LowestCommonAncestor<T> {
  if (method !== "euler-rmq" && method !== "binary-lifting") {
    throw new TypeError("method must be 'euler-rmq' or 'binary-lifting'");
  }
  const root = tree.root;
  const nodes: TreeNode<T>[] = [];
  const indexOf = new Map<TreeNode<T>, number>();
  const parent: number[] = [];
  const depth: number[] = [];
  const children: number[][] = [];
  if (root !== null) {
    indexOf.set(root, 0);
    nodes.push(root);
    parent.push(-1);
    depth.push(0);
    children.push([]);
    const queue: number[] = [0];
    let cursor = 0;
    while (cursor < queue.length) {
      const index = queue[cursor++];
      const node = nodes[index];
      for (const child of childrenOf(tree, node)) {
        if (indexOf.has(child)) {
          throw new Error("Tree contains a cycle or shared subtree");
        }
        const childIndex = nodes.length;
        indexOf.set(child, childIndex);
        nodes.push(child);
        parent.push(index);
        depth.push(depth[index] + 1);
        children.push([]);
        children[index].push(childIndex);
        queue.push(childIndex);
      }
    }
  }
  const version = (tree as Versioned).version;
  return new SnapshotLca(
    tree,
    method,
    nodes,
    indexOf,
    parent,
    depth,
    children,
    version,
  );
}
