import { assertMergeCompatible } from "../core/index.ts";
import type { Comparator } from "../core/index.ts";
import { HeapBase } from "./base.ts";
import { parseHeap } from "./serialization.ts";
import { createOwner, findOwner, handleBrand, isHeapHandle, PushOrder, unionOwners } from "./handles.ts";
import type { HeapHandle, HeapOwner } from "./handles.ts";
import type { Heap } from "./types.ts";
import { indexFromPushOrder, ValueIndex } from "./value-index.ts";

/** A Fibonacci-forest node; `push` hands it out as an opaque HeapHandle. */
class FibonacciNode<T> implements HeapHandle<T> {
  degree = 0;
  marked = false;
  parent: FibonacciNode<T> | null = null;
  child: FibonacciNode<T> | null = null;
  left: FibonacciNode<T> = this;
  right: FibonacciNode<T> = this;
  /** Value-index chain links (only meaningful once the heap's index is built). */
  older: FibonacciNode<T> | null = null;
  newer: FibonacciNode<T> | null = null;
  pushedBefore: FibonacciNode<T> | null = null;
  pushedAfter: FibonacciNode<T> | null = null;
  /** Owner token of the heap holding the node; null once the node has left its heap. */
  owner: HeapOwner | null;
  value: T;
  readonly [handleBrand] = true;

  constructor(value: T, owner: HeapOwner) {
    this.value = value;
    this.owner = owner;
  }
}

/**
 * Fibonacci heap: a circular root list of heap-ordered trees with lazy consolidation. push and
 * merge are O(1), peek is O(1) through the min pointer, pop is O(log n) amortized, and decreaseKey
 * is O(1) amortized (cut plus cascading cuts) for values that are unique in the heap. Restructuring
 * is deferred until pop, where roots of equal degree are linked.
 *
 * The constant factors are larger than BinaryHeap and PairingHeap for pure push/pop workloads; the
 * structure pays off when decreaseKey dominates, as in Dijkstra with a dense graph.
 *
 * `push` returns a HeapHandle; decreaseKey(handle, newValue) is O(1) amortized and delete(handle)
 * O(log n) amortized. Handles survive a merge into another FibonacciHeap; a stale handle (its
 * element left the heap via pop, delete, clear, or build) makes both return false, and a handle of
 * another live heap throws TypeError. decreaseKey(value, newValue) is a convenience that targets
 * the most recently pushed node holding the value through a value index built in O(n) on first use
 * and maintained afterwards. Without an index on either side merge is O(1); with one it also folds
 * the indexes (O(min distinct values), plus O(size) to index an unindexed side). Iteration is a
 * pre-order forest walk starting from the last root; deserialize rebuilds a root list with the same
 * iteration order (handles are not serialized).
 */
export class FibonacciHeap<T> extends HeapBase<T> {
  private _root: FibonacciNode<T> | null = null;
  private _min: FibonacciNode<T> | null = null;
  private _owner: HeapOwner = createOwner();
  private _pushed = new PushOrder<FibonacciNode<T>>();
  private _byValue: ValueIndex<T, FibonacciNode<T>> | null = null;

  constructor(compare?: Comparator<T>) {
    super(compare);
  }

  /** O(1): true once value-based decreaseKey has built the value index. */
  get hasValueIndex(): boolean {
    this.assertLive();
    return this._byValue !== null;
  }

  /** O(1): create a singleton and splice it into the root list; returns its handle. */
  push(value: T): HeapHandle<T> {
    this.assertLive();
    this.requireValue(value);
    const node = new FibonacciNode(value, this._owner);
    this.addRoot(node);
    this._pushed.append(node);
    this._byValue?.add(node);
    this._size++;
    this.touch();
    return node;
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
    this._pushed.unlink(minimum);
    this._byValue?.remove(minimum);
    minimum.owner = null;
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
   * Lowers an element to `newValue`. `target` is a handle from push, or a value (convenience: the
   * most recently pushed node holding it, via the lazily built value index). Returns false when the
   * handle is stale, the value is absent, or `newValue` is greater; throws TypeError for a handle of
   * another heap. Cuts the node and applies cascading cuts: O(1) amortized.
   */
  decreaseKey(target: HeapHandle<T> | T, newValue: T): boolean {
    this.assertLive();
    this.requireValue(newValue, "newValue");
    const node = this.locate(target);
    if (node === null) {
      return false;
    }
    if (this.compare(newValue, node.value) > 0) {
      return false;
    }
    if (Object.is(newValue, node.value)) {
      return true;
    }
    if (this._byValue !== null) {
      this._byValue.remove(node);
      node.value = newValue;
      this._byValue.add(node);
    } else {
      node.value = newValue;
    }
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
   * O(log n) amortized: removes the handle's element (cut it to the root list, then pop it).
   * Returns false for a stale handle; throws TypeError for anything that is not a live handle of
   * this heap.
   */
  delete(handle: HeapHandle<T>): boolean {
    this.assertLive();
    if (!(handle instanceof FibonacciNode)) {
      throw new TypeError("delete expects a FibonacciHeap handle");
    }
    const node = this.resolve(handle as FibonacciNode<T>);
    if (node === null) {
      return false;
    }
    const parent = node.parent;
    if (parent !== null) {
      this.cut(node, parent);
      this.cascadingCut(parent);
    }
    this._min = node;
    this.pop();
    return true;
  }

  /**
   * Destructive merge with another FibonacciHeap: the root lists are spliced and the owners united,
   * O(1) when neither heap has a value index (with one, the indexes are folded; see the class
   * comment). A different comparator or self-merge throws TypeError; any other heap throws
   * UnsupportedError (copying m elements cannot meet the O(1) bound) and neither heap is changed.
   * `other` is consumed; its handles now refer to this heap.
   */
  merge(other: Heap<T>): FibonacciHeap<T> {
    this.assertLive();
    assertMergeCompatible(this, other);
    if (other instanceof FibonacciHeap) {
      other.assertLive();
      const otherRoot = other._root;
      const otherMin = other._min;
      const otherSize = other._size;
      const otherOwner = other._owner;
      const otherPushed = other._pushed;
      let otherMap = other._byValue;
      if (this._byValue !== null || otherMap !== null) {
        this.ensureIndex();
        if (otherMap === null) {
          otherMap = indexFromPushOrder(otherPushed);
        }
      }
      other._pushed = new PushOrder();
      other._byValue = null;
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
      this._owner = unionOwners(this._owner, otherOwner);
      this._pushed.concat(otherPushed);
      if (otherMap !== null) {
        (this._byValue as ValueIndex<T, FibonacciNode<T>>).absorb(otherMap);
      }
      this._size += otherSize;
      this.touch();
      return this;
    }
    this.takeForeignForMerge(other, false);
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

  /**
   * O(n): validates circular lists, degrees, heap order, size, owners, the push-order list, and the
   * value index if built.
   */
  protected checkInvariants(): true | string {
    if (this._owner.parent !== null || this._owner.dead) {
      return "heap owner token is not a live root";
    }
    const pushed = this._pushed.check();
    if (typeof pushed === "string") {
      return pushed;
    }
    if (pushed !== this._size) {
      return `push-order list holds ${pushed} nodes, expected ${this._size}`;
    }
    if (this._size === 0) {
      if (this._root !== null || this._min !== null) {
        return "empty heap still has a root or minimum";
      }
      return this._byValue === null ? true : this._byValue.check(new Set(), 0);
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
    for (const node of visited) {
      if (node.owner === null || findOwner(node.owner) !== this._owner) {
        return "node owner does not resolve to this heap";
      }
    }
    for (let node = this._pushed.first; node !== null; node = node.pushedAfter) {
      if (!visited.has(node)) {
        return "push-order list holds a node outside the heap";
      }
    }
    return this._byValue === null ? true : this._byValue.check(visited, this._size);
  }

  /**
   * O(n): rebuilds the heap as a root list of singletons and validates the payload; handles are not
   * serialized. The walk visits roots last-to-first, so pushing the values in reverse reproduces the
   * serialized iteration order.
   */
  static deserialize<T>(json: unknown, compare?: Comparator<T>): FibonacciHeap<T> {
    const { values } = parseHeap(json, "FibonacciHeap");
    const heap = new FibonacciHeap<T>(compare);
    heap.build((values as T[]).reverse());
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
    this._pushed = new PushOrder();
    this._byValue = null;
  }

  /** clear() and build(): retire the owner token so every earlier handle is stale. */
  protected override invalidateHandles(): void {
    this._owner.dead = true;
    this._owner = createOwner();
  }

  /** O(α) for a handle; builds the value index on first value-based use. Null when absent/stale. */
  private locate(target: HeapHandle<T> | T): FibonacciNode<T> | null {
    if (target instanceof FibonacciNode) {
      return this.resolve(target as FibonacciNode<T>);
    }
    if (isHeapHandle(target)) {
      throw new TypeError("handle belongs to a different heap class");
    }
    this.requireValue(target as T);
    return this.ensureIndex().newest(target as T) ?? null;
  }

  /** O(α(n)) amortized: the node if it is live in this heap, null if stale; TypeError if foreign. */
  private resolve(node: FibonacciNode<T>): FibonacciNode<T> | null {
    if (node.owner === null) {
      return null;
    }
    const owner = findOwner(node.owner);
    if (owner.dead) {
      return null;
    }
    if (owner !== this._owner) {
      throw new TypeError("handle belongs to a different heap");
    }
    return node;
  }

  private ensureIndex(): ValueIndex<T, FibonacciNode<T>> {
    if (this._byValue === null) {
      this._byValue = indexFromPushOrder(this._pushed);
    }
    return this._byValue;
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
