import type { Comparator } from "../core/index.ts";
import { DepqBase } from "./base.ts";
import { parseDepq } from "./serialization.ts";

interface AvlNode<T> {
  value: T;
  count: number;
  height: number;
  left: AvlNode<T> | null;
  right: AvlNode<T> | null;
}

/**
 * DEPQ backed by an AVL tree used as a multiset. Comparator-equal values share a
 * node with a multiplicity, so duplicates cost O(1) extra space per distinct
 * value. `push`, `popMin`, and `popMax` are O(log n); because the tree is
 * balanced and maintains subtree heights, `peekMin`/`peekMax` are also O(log n)
 * from the root rather than O(1).
 *
 * Iteration is ascending by value, and so is `toArray`; this is the only
 * implementation in the module whose iteration order is sorted. `build`
 * reinserts every value, which costs O(n log n).
 */
export class BalancedTreeDepq<T> extends DepqBase<T> {
  private _root: AvlNode<T> | null = null;

  constructor(compare?: Comparator<T>) {
    super(compare);
  }

  /** O(log n): insert or increment the multiplicity of a comparator-equal value. */
  push(value: T): void {
    this.requireValue(value);
    this._root = this.insertNode(this._root, value);
    this._size++;
    this.touch();
  }

  /** O(log n): remove the leftmost value. */
  popMin(): T | undefined {
    if (this._root === null) {
      return undefined;
    }
    const node = this.minNode(this._root);
    this._root = this.removeMinNode(this._root);
    this._size--;
    this.touch();
    return node.value;
  }

  /** O(log n): remove the rightmost value. */
  popMax(): T | undefined {
    if (this._root === null) {
      return undefined;
    }
    const node = this.maxNode(this._root);
    this._root = this.removeMaxNode(this._root);
    this._size--;
    this.touch();
    return node.value;
  }

  /** O(log n): the leftmost value, or undefined when empty. */
  peekMin(): T | undefined {
    if (this._root === null) {
      return undefined;
    }
    return this.minNode(this._root).value;
  }

  /** O(log n): the rightmost value, or undefined when empty. */
  peekMax(): T | undefined {
    if (this._root === null) {
      return undefined;
    }
    return this.maxNode(this._root).value;
  }

  /** O(1): height in edges of the AVL tree; 0 when empty or a single value. */
  get height(): number {
    return this._root === null ? 0 : this._root.height;
  }

  /** O(n log n): reset and reinsert every value. */
  override build(values: Iterable<T>): void {
    const items = [...values];
    for (const value of items) {
      this.requireValue(value);
    }
    this._root = null;
    this._size = 0;
    for (const value of items) {
      this._root = this.insertNode(this._root, value);
    }
    this._size = items.length;
    this.touch();
  }

  /** O(n): checks ordering, multiplicity totals, heights, and balance. */
  validate(): true | string {
    if (this._root === null) {
      return this._size === 0 ? true : "size is nonzero but the tree is empty";
    }
    const stack: Array<AvlNode<T>> = [];
    let node: AvlNode<T> | null = this._root;
    let previous: T | undefined;
    let hasPrevious = false;
    let total = 0;
    while (node !== null || stack.length > 0) {
      while (node !== null) {
        stack.push(node);
        node = node.left;
      }
      const current = stack.pop() as AvlNode<T>;
      if (!Number.isInteger(current.count) || current.count < 1) {
        return "node multiplicity is invalid";
      }
      if (hasPrevious && this.compare(previous as T, current.value) >= 0) {
        return "search order violated";
      }
      previous = current.value;
      hasPrevious = true;
      total += current.count;
      const leftHeight = heightOf(current.left);
      const rightHeight = heightOf(current.right);
      if (current.height !== 1 + Math.max(leftHeight, rightHeight)) {
        return "node height is stale";
      }
      if (Math.abs(rightHeight - leftHeight) > 1) {
        return "balance factor exceeded";
      }
      node = current.right;
    }
    if (total !== this._size) {
      return `size ${this._size} does not match multiplicity total ${total}`;
    }
    return true;
  }

  /** O(n log n): rebuilds through build() and validates the payload. */
  static deserialize<T>(
    json: unknown,
    compare?: Comparator<T>,
  ): BalancedTreeDepq<T> {
    const { values } = parseDepq(json, "BalancedTreeDepq");
    const heap = new BalancedTreeDepq<T>(compare);
    heap.build(values as T[]);
    if (heap.validate() !== true) {
      throw new TypeError(
        `Invalid BalancedTreeDepq payload: ${heap.validate()}`,
      );
    }
    return heap;
  }

  protected override get serializationType(): string {
    return "BalancedTreeDepq";
  }

  protected collectItems(): T[] {
    const values: T[] = [];
    const stack: Array<AvlNode<T>> = [];
    let node: AvlNode<T> | null = this._root;
    while (node !== null || stack.length > 0) {
      while (node !== null) {
        stack.push(node);
        node = node.left;
      }
      const current = stack.pop() as AvlNode<T>;
      for (let index = 0; index < current.count; index++) {
        values.push(current.value);
      }
      node = current.right;
    }
    return values;
  }

  protected releaseStorage(): void {
    this._root = null;
  }

  private minNode(node: AvlNode<T>): AvlNode<T> {
    let current = node;
    while (current.left !== null) {
      current = current.left;
    }
    return current;
  }

  private maxNode(node: AvlNode<T>): AvlNode<T> {
    let current = node;
    while (current.right !== null) {
      current = current.right;
    }
    return current;
  }

  private insertNode(node: AvlNode<T> | null, value: T): AvlNode<T> {
    if (node === null) {
      return { value, count: 1, height: 0, left: null, right: null };
    }
    const order = this.compare(value, node.value);
    if (order === 0) {
      node.count++;
      return node;
    }
    if (order < 0) {
      node.left = this.insertNode(node.left, value);
    } else {
      node.right = this.insertNode(node.right, value);
    }
    return this.rebalance(node);
  }

  private removeMinNode(node: AvlNode<T>): AvlNode<T> | null {
    if (node.left === null) {
      if (node.count > 1) {
        node.count--;
        return node;
      }
      return node.right;
    }
    node.left = this.removeMinNode(node.left);
    return this.rebalance(node);
  }

  private removeMaxNode(node: AvlNode<T>): AvlNode<T> | null {
    if (node.right === null) {
      if (node.count > 1) {
        node.count--;
        return node;
      }
      return node.left;
    }
    node.right = this.removeMaxNode(node.right);
    return this.rebalance(node);
  }

  private rebalance(node: AvlNode<T>): AvlNode<T> {
    updateHeight(node);
    const balance = heightOf(node.right) - heightOf(node.left);
    if (balance > 1) {
      const right = node.right as AvlNode<T>;
      if (heightOf(right.left) > heightOf(right.right)) {
        node.right = rotateRight(right);
      }
      return rotateLeft(node);
    }
    if (balance < -1) {
      const left = node.left as AvlNode<T>;
      if (heightOf(left.right) > heightOf(left.left)) {
        node.left = rotateLeft(left);
      }
      return rotateRight(node);
    }
    return node;
  }
}

function heightOf<T>(node: AvlNode<T> | null): number {
  return node === null ? -1 : node.height;
}

function updateHeight<T>(node: AvlNode<T>): void {
  node.height = 1 + Math.max(heightOf(node.left), heightOf(node.right));
}

function rotateRight<T>(node: AvlNode<T>): AvlNode<T> {
  const left = node.left as AvlNode<T>;
  node.left = left.right;
  left.right = node;
  updateHeight(node);
  updateHeight(left);
  return left;
}

function rotateLeft<T>(node: AvlNode<T>): AvlNode<T> {
  const right = node.right as AvlNode<T>;
  node.right = right.left;
  right.left = node;
  updateHeight(node);
  updateHeight(right);
  return right;
}
