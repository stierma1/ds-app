import { assertDefined } from "../core/index.ts";
import type { Comparator } from "../core/index.ts";
import { HeapBase } from "./base.ts";
import { parseHeap } from "./serialization.ts";
import type { Heap } from "./types.ts";

interface PairingNode<T> {
  value: T;
  parent: PairingNode<T> | null;
  prev: PairingNode<T> | null;
  next: PairingNode<T> | null;
  firstChild: PairingNode<T> | null;
  lastChild: PairingNode<T> | null;
}

/**
 * Pairing heap: a multiway tree with left-child/right-sibling links where every meld is a single
 * comparison. push and merge are O(1); pop pairs the root's children and melds the pairs
 * right-to-left, which is O(log n) amortized. The plain heap exposes decreaseKey(value, newValue)
 * for values that are unique in the heap; it cuts the node from its parent and melds it back at the
 * root.
 *
 * Pairing heaps are the simplest meldable heaps with good practical constants and no lazy
 * bookkeeping. Duplicates are allowed; a duplicate value makes decreaseKey target the most recently
 * pushed node with that value. Iteration is a pre-order walk of the pairing tree, not sorted order.
 *
 * Node: {value, parent, prev, next, firstChild, lastChild}
 */
export class PairingHeap<T> extends HeapBase<T> {
  private _root: PairingNode<T> | null = null;
  private _byValue = new Map<T, PairingNode<T>>();

  constructor(compare?: Comparator<T>) {
    super(compare);
  }

  /** O(1): create a singleton and meld it with the root. */
  push(value: T): void {
    this.assertLive();
    this.requireValue(value);
    const node = this.createNode(value);
    this._root = this._root === null ? node : this.link(this._root, node);
    this._byValue.set(value, node);
    this._size++;
    this.touch();
  }

  /** O(log n) amortized: remove the root and two-pass meld its children. */
  pop(): T | undefined {
    this.assertLive();
    const root = this._root;
    if (root === null) {
      return undefined;
    }
    const children = this.detachChildren(root);
    this._size--;
    if (this._byValue.get(root.value) === root) {
      this._byValue.delete(root.value);
    }
    if (children.length === 0) {
      this._root = null;
    } else {
      const paired: PairingNode<T>[] = [];
      let index = 0;
      while (index + 1 < children.length) {
        paired.push(this.link(children[index], children[index + 1]));
        index += 2;
      }
      if (index < children.length) {
        paired.push(children[index]);
      }
      let merged = paired[paired.length - 1];
      for (let cursor = paired.length - 2; cursor >= 0; cursor--) {
        merged = this.link(paired[cursor], merged);
      }
      this._root = merged;
    }
    this.touch();
    return root.value;
  }

  /** O(1). */
  peek(): T | undefined {
    this.assertLive();
    return this._root?.value;
  }

  /**
   * Decreases the value of the most recently pushed node holding `value`. Returns false when the
   * value is absent or the new value is greater. The node is cut from its parent and melded at the
   * root, so the operation is O(1) plus the amortized cost of the cut.
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
    if (parent !== null) {
      this.cut(node, parent);
      this._root = this.link(this._root as PairingNode<T>, node);
    }
    this.touch();
    return true;
  }

  /**
   * Destructive merge. Same-class melds are O(1); a foreign Heap is drained and pushed in O(m).
   * `other` is consumed either way.
   */
  merge(other: Heap<T>): PairingHeap<T> {
    this.assertLive();
    if (other === this) {
      throw new TypeError("cannot merge a heap with itself");
    }
    if (other instanceof PairingHeap) {
      other.assertLive();
      const otherRoot = other._root;
      const otherSize = other._size;
      const otherMap = other._byValue;
      other.markConsumed();
      if (otherRoot !== null) {
        this._root = this._root === null ? otherRoot : this.link(this._root, otherRoot);
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

  /** O(n): iterative walk over every node, tracking the deepest level. */
  get height(): number {
    this.assertLive();
    if (this._root === null) {
      return 0;
    }
    let maximum = 0;
    const stack: Array<[PairingNode<T>, number]> = [[this._root, 0]];
    while (stack.length > 0) {
      const [node, depth] = stack.pop() as [PairingNode<T>, number];
      if (depth > maximum) {
        maximum = depth;
      }
      for (let child = node.firstChild; child !== null; child = child.next) {
        stack.push([child, depth + 1]);
      }
    }
    return maximum;
  }

  /** O(n): checks the heap order, parent/child links, size, and the decrease-key index. */
  validate(): true | string {
    if (this._size === 0) {
      if (this._root !== null) {
        return "empty heap still has a root";
      }
      if (this._byValue.size !== 0) {
        return "empty heap still has indexed nodes";
      }
      return true;
    }
    if (this._root === null) {
      return "non-empty heap has no root";
    }
    if (this._root.parent !== null) {
      return "root has a parent";
    }
    const visited = new Set<PairingNode<T>>();
    const stack: PairingNode<T>[] = [this._root];
    while (stack.length > 0) {
      const node = stack.pop() as PairingNode<T>;
      if (visited.has(node)) {
        return "cycle or shared node detected";
      }
      visited.add(node);
      if (node.value === undefined) {
        return "node value is undefined";
      }
      let previous: PairingNode<T> | null = null;
      let child = node.firstChild;
      if (child !== null && child.prev !== null) {
        return "first child has a previous sibling";
      }
      if (child === null && node.lastChild !== null) {
        return "node has a last child but no first child";
      }
      while (child !== null) {
        if (child.parent !== node) {
          return "child does not point back to its parent";
        }
        if (child.prev !== previous) {
          return "sibling back-link is inconsistent";
        }
        if (this.compare(node.value, child.value) > 0) {
          return "heap order violated";
        }
        previous = child;
        stack.push(child);
        child = child.next;
      }
      if (node.lastChild !== previous) {
        return "last child link is inconsistent";
      }
    }
    if (visited.size !== this._size) {
      return `size ${this._size} does not match node count ${visited.size}`;
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
  static deserialize<T>(json: unknown, compare?: Comparator<T>): PairingHeap<T> {
    const { values } = parseHeap(json, "PairingHeap");
    const heap = new PairingHeap<T>(compare);
    heap.build(values as T[]);
    if (heap.validate() !== true) {
      throw new TypeError(`Invalid PairingHeap payload: ${heap.validate()}`);
    }
    return heap;
  }

  protected override get serializationType(): string {
    return "PairingHeap";
  }

  /** O(n): pre-order traversal of the pairing tree. */
  protected collectItems(): T[] {
    const values: T[] = [];
    if (this._root === null) {
      return values;
    }
    const stack: PairingNode<T>[] = [this._root];
    while (stack.length > 0) {
      const node = stack.pop() as PairingNode<T>;
      values.push(node.value);
      for (let child = node.firstChild; child !== null; child = child.next) {
        stack.push(child);
      }
    }
    return values;
  }

  protected releaseStorage(): void {
    this._root = null;
    this._byValue = new Map();
  }

  private createNode(value: T): PairingNode<T> {
    return {
      value,
      parent: null,
      prev: null,
      next: null,
      firstChild: null,
      lastChild: null,
    };
  }

  /** Compare two singleton roots and hang the larger under the smaller; O(1). */
  private link(a: PairingNode<T>, b: PairingNode<T>): PairingNode<T> {
    if (this.compare(a.value, b.value) <= 0) {
      this.appendChild(a, b);
      return a;
    }
    this.appendChild(b, a);
    return b;
  }

  private appendChild(parent: PairingNode<T>, child: PairingNode<T>): void {
    child.parent = parent;
    child.next = null;
    child.prev = parent.lastChild;
    if (parent.lastChild === null) {
      parent.firstChild = child;
    } else {
      parent.lastChild.next = child;
    }
    parent.lastChild = child;
  }

  private detachChildren(root: PairingNode<T>): PairingNode<T>[] {
    const children: PairingNode<T>[] = [];
    let child = root.firstChild;
    while (child !== null) {
      const next = child.next;
      child.parent = null;
      child.prev = null;
      child.next = null;
      children.push(child);
      child = next;
    }
    root.firstChild = null;
    root.lastChild = null;
    return children;
  }

  private cut(node: PairingNode<T>, parent: PairingNode<T>): void {
    if (node.prev === null) {
      parent.firstChild = node.next;
    } else {
      node.prev.next = node.next;
    }
    if (node.next === null) {
      parent.lastChild = node.prev;
    } else {
      node.next.prev = node.prev;
    }
    node.parent = null;
    node.prev = null;
    node.next = null;
  }
}
