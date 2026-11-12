import type { Comparator } from "../core/index.ts";
import { HeapBase } from "./base.ts";
import { parseHeap } from "./serialization.ts";
import type { Heap } from "./types.ts";

interface BinomialNode<T> {
  value: T;
  degree: number;
  children: Array<BinomialNode<T>>;
}

/**
 * Binomial heap: a forest with at most one tree of each degree stored in a degree-indexed array.
 * push is O(1) amortized (like incrementing a binary counter), peek is O(1) through the cached min
 * pointer, and pop/merge are O(log n). pop removes the minimum root and re-inserts its children,
 * which are binomial trees of every lower degree.
 *
 * merge is a single O(log n) pass that adds the two forests like binary numbers. Iteration is a
 * pre-order forest walk, not sorted order. Duplicates are allowed.
 */
export class BinomialHeap<T> extends HeapBase<T> {
  private _trees: Array<BinomialNode<T> | null> = [];
  private _min: BinomialNode<T> | null = null;

  constructor(compare?: Comparator<T>) {
    super(compare);
  }

  /** O(1) amortized: add a singleton tree and update the min pointer. */
  push(value: T): void {
    this.assertLive();
    this.requireValue(value);
    const node: BinomialNode<T> = { value, degree: 0, children: [] };
    this.addTree(node);
    if (this._min === null || this.compare(value, this._min.value) < 0) {
      this._min = node;
    }
    this._size++;
    this.touch();
  }

  /** O(log n): remove the min root, add its children as roots, and rescan the forest. */
  pop(): T | undefined {
    this.assertLive();
    const minimum = this._min;
    if (minimum === null) {
      return undefined;
    }
    this._trees[minimum.degree] = null;
    for (const child of minimum.children) {
      this.addTree(child);
    }
    minimum.children = [];
    this._size--;
    this.recomputeMinimum();
    this.touch();
    return minimum.value;
  }

  /** O(1): cached minimum root. */
  peek(): T | undefined {
    this.assertLive();
    return this._min?.value;
  }

  /**
   * Destructive merge. Two binomial heaps combine in O(log n) by binary-carry addition over the
   * degree arrays; any other Heap is drained and pushed. `other` is consumed either way.
   */
  merge(other: Heap<T>): BinomialHeap<T> {
    this.assertLive();
    if (other === this) {
      throw new TypeError("cannot merge a heap with itself");
    }
    if (other instanceof BinomialHeap) {
      other.assertLive();
      const otherTrees = other._trees;
      const otherSize = other._size;
      other.markConsumed();
      this.combineForests(otherTrees);
      this._size += otherSize;
      this.recomputeMinimum();
      this.touch();
      return this;
    }
    const values = this.extractForMerge(other);
    for (const value of values) {
      this.push(value);
    }
    return this;
  }

  /** O(log n): the tallest binomial tree has degree equal to its height. */
  get height(): number {
    this.assertLive();
    let maximum = 0;
    for (const tree of this._trees) {
      if (tree !== null && tree.degree > maximum) {
        maximum = tree.degree;
      }
    }
    return maximum;
  }

  /** O(n): validates tree shape, degrees, heap order, size, and the cached minimum. */
  validate(): true | string {
    let count = 0;
    let minimum: BinomialNode<T> | null = null;
    let minIsRoot = false;
    for (let degree = 0; degree < this._trees.length; degree++) {
      const tree = this._trees[degree];
      if (tree === null) {
        continue;
      }
      if (tree.degree !== degree) {
        return `tree at index ${degree} has degree ${tree.degree}`;
      }
      if (tree === this._min) {
        minIsRoot = true;
      }
      if (minimum === null || this.compare(tree.value, minimum.value) < 0) {
        minimum = tree;
      }
      const problem = this.validateTree(tree);
      if (typeof problem === "string") {
        return problem;
      }
      count += this.countTree(tree);
    }
    if (count !== this._size) {
      return `size ${this._size} does not match node count ${count}`;
    }
    if (this._size === 0) {
      if (this._min !== null) {
        return "empty heap still has a minimum";
      }
      return true;
    }
    if (this._min === null) {
      return "non-empty heap has no minimum pointer";
    }
    if (!minIsRoot) {
      return "minimum pointer is not a root";
    }
    if (minimum === null || this.compare(this._min.value, minimum.value) !== 0) {
      return "minimum pointer does not point at the smallest root";
    }
    return true;
  }

  /** O(n): rebuilds by pushing every value and validates the payload. */
  static deserialize<T>(json: unknown, compare?: Comparator<T>): BinomialHeap<T> {
    const { values } = parseHeap(json, "BinomialHeap");
    const heap = new BinomialHeap<T>(compare);
    heap.build(values as T[]);
    if (heap.validate() !== true) {
      throw new TypeError(`Invalid BinomialHeap payload: ${heap.validate()}`);
    }
    return heap;
  }

  protected override get serializationType(): string {
    return "BinomialHeap";
  }

  protected collectItems(): T[] {
    const values: T[] = [];
    const stack: BinomialNode<T>[] = [];
    for (const tree of this._trees) {
      if (tree !== null) {
        stack.push(tree);
      }
    }
    while (stack.length > 0) {
      const node = stack.pop() as BinomialNode<T>;
      values.push(node.value);
      for (const child of node.children) {
        stack.push(child);
      }
    }
    return values;
  }

  protected releaseStorage(): void {
    this._trees = [];
    this._min = null;
  }

  private recomputeMinimum(): void {
    this._min = null;
    for (const tree of this._trees) {
      if (tree !== null && (this._min === null || this.compare(tree.value, this._min.value) < 0)) {
        this._min = tree;
      }
    }
  }

  private addTree(node: BinomialNode<T>): void {
    let current = node;
    while (true) {
      const degree = current.degree;
      const existing = this._trees[degree] ?? null;
      if (existing === null) {
        this._trees[degree] = current;
        return;
      }
      this._trees[degree] = null;
      current = this.link(existing, current);
    }
  }

  private combineForests(otherTrees: Array<BinomialNode<T> | null>): void {
    const length = Math.max(this._trees.length, otherTrees.length);
    const result: Array<BinomialNode<T> | null> = [];
    let carry: BinomialNode<T> | null = null;
    for (let degree = 0; degree < length; degree++) {
      const a = this._trees[degree] ?? null;
      const b = otherTrees[degree] ?? null;
      const present = (a !== null ? 1 : 0) + (b !== null ? 1 : 0) + (carry !== null ? 1 : 0);
      if (present === 0) {
        result[degree] = null;
      } else if (present === 1) {
        result[degree] = a ?? b ?? carry;
        carry = null;
      } else if (present === 2) {
        const first = a ?? b;
        const second = a !== null && b !== null ? b : carry;
        carry = this.link(first as BinomialNode<T>, second as BinomialNode<T>);
        result[degree] = null;
      } else {
        result[degree] = a;
        carry = this.link(b as BinomialNode<T>, carry as BinomialNode<T>);
      }
    }
    if (carry !== null) {
      result[length] = carry;
    }
    this._trees = result;
  }

  /**
   * Links two trees of equal degree; the larger root becomes the first child. On a tie, prefer to
   * keep the current minimum a root so the cached min pointer never becomes a child.
   */
  private link(a: BinomialNode<T>, b: BinomialNode<T>): BinomialNode<T> {
    const comparison = this.compare(a.value, b.value);
    if (comparison < 0 || (comparison === 0 && this._min !== b)) {
      a.children.unshift(b);
      a.degree++;
      return a;
    }
    b.children.unshift(a);
    b.degree++;
    return b;
  }

  private validateTree(node: BinomialNode<T>): true | string {
    if (node.value === undefined) {
      return "node value is undefined";
    }
    if (node.degree !== node.children.length) {
      return "degree does not match child count";
    }
    let expected = node.degree - 1;
    for (const child of node.children) {
      if (child.degree !== expected) {
        return "children are not in decreasing degree order";
      }
      if (this.compare(node.value, child.value) > 0) {
        return "heap order violated";
      }
      const problem = this.validateTree(child);
      if (typeof problem === "string") {
        return problem;
      }
      expected--;
    }
    return true;
  }

  private countTree(node: BinomialNode<T>): number {
    let count = 1;
    for (const child of node.children) {
      count += this.countTree(child);
    }
    return count;
  }
}
