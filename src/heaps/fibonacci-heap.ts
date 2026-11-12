import { assertDefined } from "../core/index.ts";
import type { Comparator } from "../core/index.ts";
import { HeapBase } from "./base.ts";
import { parseHeap } from "./serialization.ts";
import type { Heap } from "./types.ts";

interface FibonacciNode<T> {
  value: T;
  degree: number;
  marked: boolean;
  parent: FibonacciNode<T> | null;
  child: FibonacciNode<T> | null;
  left: FibonacciNode<T>;
  right: FibonacciNode<T>;
}

/**
 * Fibonacci heap: a circular root list of heap-ordered trees with lazy consolidation. push and
 * merge are O(1), peek is O(1) through the min pointer, pop is O(log n) amortized, and decreaseKey
 * is O(1) amortized (cut plus cascading cuts) for values that are unique in the heap. Restructuring
 * is deferred until pop, where roots of equal degree are linked.
 *
 * The constant factors are larger than BinaryHeap and PairingHeap for pure push/pop workloads; the
 * structure pays off when decreaseKey dominates, as in Dijkstra with a dense graph. Duplicate
 * values are allowed, but decreaseKey targets the most recently pushed node with that value.
 * Iteration is a pre-order forest walk, not sorted order.
 */
export class FibonacciHeap<T> extends HeapBase<T> {
  private _root: FibonacciNode<T> | null = null;
  private _min: FibonacciNode<T> | null = null;
  private _byValue = new Map<T, FibonacciNode<T>>();

  constructor(compare?: Comparator<T>) {
    super(compare);
  }

  /** O(1): create a singleton and splice it into the root list. */
  push(value: T): void {
    this.assertLive();
    this.requireValue(value);
    const node = this.createNode(value);
    this.addRoot(node);
    this._byValue.set(value, node);
    this._size++;
    this.touch();
  }

  /** O(log n) amortized: remove the min, promote its children, and consolidate equal degrees. */
  pop(): T | undefined {
    this.assertLive();
    const minimum = this._min;
    if (minimum === null) {
      return undefined;
    }
    while (minimum.child !== null) {
      const child = minimum.child;
      if (child.right === child) {
        minimum.child = null;
      } else {
        minimum.child = child.right;
        this.unlink(child);
      }
      child.parent = null;
      child.marked = false;
      child.left = child;
      child.right = child;
      this.addRoot(child);
    }
    minimum.degree = 0;
    this.removeRoot(minimum);
    if (this._byValue.get(minimum.value) === minimum) {
      this._byValue.delete(minimum.value);
    }
    this._size--;
    this._min = null;
    if (this._root !== null) {
      this.consolidate();
    }
    this.touch();
    return minimum.value;
  }

  /** O(1): cached minimum root. */
  peek(): T | undefined {
    this.assertLive();
    return this._min?.value;
  }

  /**
   * Decreases the value of the most recently pushed node holding `value`. Returns false when the
   * value is absent or the new value is greater. Cuts the node and applies cascading cuts, so the
   * operation is O(1) amortized.
   */
  decreaseKey(value: T, newValue: T): boolean {
    this.assertLive();
    this.requireValue(value);
    this.requireValue(newValue, "newValue");
    const node = this._byValue.get(value);
    if (node === undefined) {
      return false;
    }
    if (this.compare(newValue, node.value) > 0) {
      return false;
    }
    if (Object.is(newValue, node.value)) {
      return true;
    }
    if (this._byValue.get(value) === node) {
      this._byValue.delete(value);
    }
    node.value = newValue;
    this._byValue.set(newValue, node);
    const parent = node.parent;
    if (parent !== null && this.compare(node.value, parent.value) < 0) {
      this.cut(node, parent);
      this.cascadingCut(parent);
    }
    if (this._min === null || this.compare(node.value, this._min.value) < 0) {
      this._min = node;
    }
    this.touch();
    return true;
  }

  /**
   * Destructive merge. Two Fibonacci heaps concatenate root lists in O(1); a foreign Heap is drained
   * and pushed. `other` is consumed either way.
   */
  merge(other: Heap<T>): FibonacciHeap<T> {
    this.assertLive();
    if (other === this) {
      throw new TypeError("cannot merge a heap with itself");
    }
    if (other instanceof FibonacciHeap) {
      other.assertLive();
      const otherRoot = other._root;
      const otherMin = other._min;
      const otherSize = other._size;
      const otherMap = other._byValue;
      other.markConsumed();
      if (otherRoot !== null) {
        if (this._root === null) {
          this._root = otherRoot;
          this._min = otherMin;
        } else {
          this.spliceLists(this._root, otherRoot);
          if (otherMin !== null && (this._min === null || this.compare(otherMin.value, this._min.value) < 0)) {
            this._min = otherMin;
          }
        }
      }
      for (const [value, node] of otherMap) {
        this._byValue.set(value, node);
      }
      this._size += otherSize;
      this.touch();
      return this;
    }
    const values = this.extractForMerge(other);
    for (const value of values) {
      this.push(value);
    }
    return this;
  }

  /** O(n): iterative pre-order walk over every tree, tracking the deepest level. */
  get height(): number {
    this.assertLive();
    if (this._root === null) {
      return 0;
    }
    let maximum = 0;
    const stack: Array<[FibonacciNode<T>, number]> = [];
    for (const root of this.collectRoots()) {
      stack.push([root, 0]);
    }
    while (stack.length > 0) {
      const [node, depth] = stack.pop() as [FibonacciNode<T>, number];
      if (depth > maximum) {
        maximum = depth;
      }
      if (node.child !== null) {
        let child = node.child;
        do {
          stack.push([child, depth + 1]);
          child = child.right;
        } while (child !== node.child);
      }
    }
    return maximum;
  }

  /** O(n): validates circular lists, degrees, heap order, size, and the decrease-key index. */
  validate(): true | string {
    if (this._size === 0) {
      if (this._root !== null || this._min !== null) {
        return "empty heap still has a root or minimum";
      }
      if (this._byValue.size !== 0) {
        return "empty heap still has indexed nodes";
      }
      return true;
    }
    if (this._root === null || this._min === null) {
      return "non-empty heap has no root or minimum";
    }
    const visited = new Set<FibonacciNode<T>>();
    const roots = this.collectRoots();
    let count = 0;
    for (const root of roots) {
      if (root.parent !== null) {
        return "root has a parent";
      }
      if (root.marked) {
        return "root is marked";
      }
      const problem = this.validateTree(root, visited);
      if (typeof problem === "string") {
        return problem;
      }
    }
    count = visited.size;
    if (count !== this._size) {
      return `size ${this._size} does not match node count ${count}`;
    }
    if (!visited.has(this._min)) {
      return "minimum pointer is not in the heap";
    }
    for (const root of roots) {
      if (this.compare(root.value, this._min.value) < 0) {
        return "minimum pointer is not the smallest root";
      }
    }
    for (const [value, node] of this._byValue) {
      if (!visited.has(node)) {
        return "index points to a node outside the heap";
      }
      if (!Object.is(node.value, value)) {
        return "index key does not match the node value";
      }
    }
    return true;
  }

  /** O(n): rebuilds by pushing every value and validates the payload. */
  static deserialize<T>(json: unknown, compare?: Comparator<T>): FibonacciHeap<T> {
    const { values } = parseHeap(json, "FibonacciHeap");
    const heap = new FibonacciHeap<T>(compare);
    heap.build(values as T[]);
    if (heap.validate() !== true) {
      throw new TypeError(`Invalid FibonacciHeap payload: ${heap.validate()}`);
    }
    return heap;
  }

  protected override get serializationType(): string {
    return "FibonacciHeap";
  }

  /** O(n): pre-order forest walk. */
  protected collectItems(): T[] {
    const values: T[] = [];
    if (this._root === null) {
      return values;
    }
    const stack: FibonacciNode<T>[] = [];
    for (const root of this.collectRoots()) {
      stack.push(root);
    }
    while (stack.length > 0) {
      const node = stack.pop() as FibonacciNode<T>;
      values.push(node.value);
      if (node.child !== null) {
        let child = node.child;
        do {
          stack.push(child);
          child = child.right;
        } while (child !== node.child);
      }
    }
    return values;
  }

  protected releaseStorage(): void {
    this._root = null;
    this._min = null;
    this._byValue = new Map();
  }

  private createNode(value: T): FibonacciNode<T> {
    const node = {
      value,
      degree: 0,
      marked: false,
      parent: null,
      child: null,
      left: null as unknown as FibonacciNode<T>,
      right: null as unknown as FibonacciNode<T>,
    };
    node.left = node;
    node.right = node;
    return node;
  }

  /** O(1): inserts a singleton into the circular list and returns the (possibly new) head. */
  private insertIntoList(
    head: FibonacciNode<T> | null,
    node: FibonacciNode<T>,
  ): FibonacciNode<T> {
    if (head === null) {
      node.left = node;
      node.right = node;
      return node;
    }
    node.right = head;
    node.left = head.left;
    head.left.right = node;
    head.left = node;
    return head;
  }

  private unlink(node: FibonacciNode<T>): void {
    node.left.right = node.right;
    node.right.left = node.left;
  }

  /** O(1): adds a detached node to the root list and updates the min pointer. */
  private addRoot(node: FibonacciNode<T>): void {
    node.parent = null;
    this._root = this.insertIntoList(this._root, node);
    if (this._min === null || this.compare(node.value, this._min.value) < 0) {
      this._min = node;
    }
  }

  private removeRoot(node: FibonacciNode<T>): void {
    if (node.right === node) {
      this._root = null;
    } else {
      if (this._root === node) {
        this._root = node.right;
      }
      this.unlink(node);
    }
    node.left = node;
    node.right = node;
  }

  private collectRoots(): FibonacciNode<T>[] {
    const roots: FibonacciNode<T>[] = [];
    if (this._root === null) {
      return roots;
    }
    let node = this._root;
    do {
      roots.push(node);
      node = node.right;
    } while (node !== this._root);
    return roots;
  }

  /** O(log n) amortized: link roots of equal degree until every degree is unique. */
  private consolidate(): void {
    const roots = this.collectRoots();
    this._root = null;
    this._min = null;
    const table: Array<FibonacciNode<T> | null> = [];
    for (const node of roots) {
      node.parent = null;
      node.left = node;
      node.right = node;
      node.marked = false;
      let current = node;
      let degree = current.degree;
      while (table[degree] !== null && table[degree] !== undefined) {
        const other = table[degree] as FibonacciNode<T>;
        table[degree] = null;
        if (this.compare(other.value, current.value) < 0) {
          const swap = current;
          current = other;
          // The two nodes are still detached; the larger one becomes a child below.
          this.linkChild(current, swap);
        } else {
          this.linkChild(current, other);
        }
        degree = current.degree;
      }
      table[degree] = current;
    }
    for (const node of table) {
      if (node !== null && node !== undefined) {
        this.addRoot(node);
      }
    }
  }

  /** O(1): hang `child` below `parent`, making `parent` the minimum root. */
  private linkChild(parent: FibonacciNode<T>, child: FibonacciNode<T>): void {
    child.parent = parent;
    child.marked = false;
    parent.child = this.insertIntoList(parent.child, child);
    parent.degree++;
  }

  private spliceLists(a: FibonacciNode<T>, b: FibonacciNode<T>): void {
    const aRight = a.right;
    const bLeft = b.left;
    a.right = b;
    b.left = a;
    aRight.left = bLeft;
    bLeft.right = aRight;
  }

  private cut(node: FibonacciNode<T>, parent: FibonacciNode<T>): void {
    if (parent.child === node) {
      parent.child = node.right === node ? null : node.right;
    }
    this.unlink(node);
    parent.degree--;
    node.parent = null;
    node.marked = false;
    node.left = node;
    node.right = node;
    this.addRoot(node);
  }

  private cascadingCut(parent: FibonacciNode<T>): void {
    let current = parent;
    while (current.parent !== null) {
      if (!current.marked) {
        current.marked = true;
        return;
      }
      const grandparent = current.parent;
      this.cut(current, grandparent);
      current = grandparent;
    }
  }

  private validateTree(
    node: FibonacciNode<T>,
    visited: Set<FibonacciNode<T>>,
  ): true | string {
    if (visited.has(node)) {
      return "cycle or shared node detected";
    }
    visited.add(node);
    if (node.value === undefined) {
      return "node value is undefined";
    }
    if (node.left.right !== node || node.right.left !== node) {
      return "sibling links are inconsistent";
    }
    let childCount = 0;
    if (node.child !== null) {
      const first = node.child;
      let child = first;
      do {
        if (child.parent !== node) {
          return "child does not point back to its parent";
        }
        if (child.left.right !== child || child.right.left !== child) {
          return "child sibling links are inconsistent";
        }
        if (this.compare(node.value, child.value) > 0) {
          return "heap order violated";
        }
        const problem = this.validateTree(child, visited);
        if (typeof problem === "string") {
          return problem;
        }
        childCount++;
        child = child.right;
      } while (child !== first);
    }
    if (childCount !== node.degree) {
      return "degree does not match child count";
    }
    return true;
  }
}
