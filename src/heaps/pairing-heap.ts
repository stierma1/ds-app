import { assertMergeCompatible } from "../core/index.ts";
import type { Comparator } from "../core/index.ts";
import { HeapBase } from "./base.ts";
import {
  createOwner,
  findOwner,
  handleBrand,
  isHeapHandle,
  PushOrder,
  unionOwners,
} from "./handles.ts";
import type { HeapHandle, HeapOwner } from "./handles.ts";
import { parseHeap } from "./serialization.ts";
import type { Heap } from "./types.ts";
import { indexFromPushOrder, ValueIndex } from "./value-index.ts";

/** A pairing-tree node; `push` hands it out as an opaque HeapHandle. */
class PairingNode<T> implements HeapHandle<T> {
  parent: PairingNode<T> | null = null;
  prev: PairingNode<T> | null = null;
  next: PairingNode<T> | null = null;
  firstChild: PairingNode<T> | null = null;
  lastChild: PairingNode<T> | null = null;
  /** Value-index chain links (only meaningful once the heap's index is built). */
  older: PairingNode<T> | null = null;
  newer: PairingNode<T> | null = null;
  pushedBefore: PairingNode<T> | null = null;
  pushedAfter: PairingNode<T> | null = null;
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
 * Pairing heap: a multiway tree with left-child/right-sibling links where every meld is a single
 * comparison. push and merge are O(1); pop pairs the root's children and melds the pairs
 * right-to-left, which is O(log n) amortized.
 *
 * `push` returns a HeapHandle. decreaseKey(handle, newValue) cuts the node and melds it at the root
 * (O(log n) amortized) and delete(handle) removes it (O(log n) amortized). A handle stays valid
 * after its heap is melded into another PairingHeap; a handle whose element has left the heap (pop,
 * delete, clear, build) is stale and makes both calls return false; a handle of another live heap
 * throws TypeError.
 *
 * decreaseKey(value, newValue) is a convenience for values unique by identity: it targets the most
 * recently pushed node holding that value. It needs a value index, built in O(n) on first use and
 * maintained from then on. Without an index on either side, merge is O(1); with one, merge also
 * folds the smaller index into the larger (O(min distinct values)), first indexing an unindexed side
 * in O(its size). Iteration is a pre-order walk that visits a node's children last-to-first;
 * deserialize rebuilds a tree with the same iteration order (handles are not serialized).
 */
export class PairingHeap<T> extends HeapBase<T> {
  private _root: PairingNode<T> | null = null;
  private _owner: HeapOwner = createOwner();
  private _pushed = new PushOrder<PairingNode<T>>();
  private _byValue: ValueIndex<T, PairingNode<T>> | null = null;

  constructor(compare?: Comparator<T>) {
    super(compare);
  }

  /** O(1): true once value-based decreaseKey has built the value index. */
  get hasValueIndex(): boolean {
    this.assertLive();
    return this._byValue !== null;
  }

  /** O(1): create a singleton and meld it with the root; returns its handle. */
  push(value: T): HeapHandle<T> {
    this.assertLive();
    this.requireValue(value);
    const node = new PairingNode(value, this._owner);
    this._root = this._root === null ? node : this.link(this._root, node);
    this._pushed.append(node);
    this._byValue?.add(node);
    this._size++;
    this.touch();
    return node;
  }

  /** O(log n) amortized: remove the root and two-pass meld its children. */
  pop(): T | undefined {
    this.assertLive();
    const root = this._root;
    if (root === null) {
      return undefined;
    }
    this._root = this.combine(this.detachChildren(root));
    this.retire(root);
    this.touch();
    return root.value;
  }

  /** O(1). */
  peek(): T | undefined {
    this.assertLive();
    return this._root?.value;
  }

  /**
   * Lowers an element to `newValue`. `target` is a handle from push, or a value (convenience:
   * the most recently pushed node holding it, via the lazily built value index). Returns false when
   * the handle is stale, the value is absent, or `newValue` is greater; throws TypeError for a
   * handle of another heap. O(log n) amortized.
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
    if (parent !== null) {
      this.cut(node, parent);
      this._root = this.link(this._root as PairingNode<T>, node);
    }
    this.touch();
    return true;
  }

  /**
   * O(log n) amortized: removes the handle's element. Returns false for a stale handle; throws
   * TypeError for anything that is not a live handle of this heap.
   */
  delete(handle: HeapHandle<T>): boolean {
    this.assertLive();
    if (!(handle instanceof PairingNode)) {
      throw new TypeError("delete expects a PairingHeap handle");
    }
    const node = this.resolve(handle);
    if (node === null) {
      return false;
    }
    if (node === this._root) {
      this.pop();
      return true;
    }
    this.cut(node, node.parent as PairingNode<T>);
    const subtree = this.combine(this.detachChildren(node));
    if (subtree !== null) {
      this._root = this.link(this._root as PairingNode<T>, subtree);
    }
    this.retire(node);
    this.touch();
    return true;
  }

  /**
   * Destructive merge with another PairingHeap: one link and an owner union, O(1) when neither heap
   * has a value index. With an index on either side, the indexes are folded (see the class comment).
   * A different comparator or self-merge throws TypeError; any other heap throws UnsupportedError
   * (copying m elements cannot meet the O(1) bound) and neither heap is changed. `other` is consumed;
   * its handles now refer to this heap.
   */
  merge(other: Heap<T>): PairingHeap<T> {
    this.assertLive();
    assertMergeCompatible(this, other);
    if (!(other instanceof PairingHeap)) {
      this.takeForeignForMerge(other, false);
      return this;
    }
    other.assertLive();
    const otherRoot = other._root;
    const otherSize = other._size;
    const otherOwner = other._owner;
    const otherPushed = other._pushed;
    let otherIndex = other._byValue;
    if (this._byValue !== null || otherIndex !== null) {
      this.ensureIndex();
      if (otherIndex === null) {
        otherIndex = indexFromPushOrder(otherPushed);
      }
    }
    other._pushed = new PushOrder();
    other._byValue = null;
    other.markConsumed();
    if (otherRoot !== null) {
      this._root = this._root === null ? otherRoot : this.link(this._root, otherRoot);
    }
    this._owner = unionOwners(this._owner, otherOwner);
    this._pushed.concat(otherPushed);
    if (otherIndex !== null) {
      (this._byValue as ValueIndex<T, PairingNode<T>>).absorb(otherIndex);
    }
    this._size += otherSize;
    this.touch();
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

  /** O(n): heap order, links, size, owners, the push-order list, and the value index if built. */
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
    const visited = new Set<PairingNode<T>>();
    if (this._size === 0) {
      if (this._root !== null) {
        return "empty heap still has a root";
      }
    } else {
      if (this._root === null) {
        return "non-empty heap has no root";
      }
      if (this._root.parent !== null) {
        return "root has a parent";
      }
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
        if (node.owner === null || findOwner(node.owner) !== this._owner) {
          return "node owner does not resolve to this heap";
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
    }
    for (let node = this._pushed.first; node !== null; node = node.pushedAfter) {
      if (!visited.has(node)) {
        return "push-order list holds a node outside the heap";
      }
    }
    return this._byValue === null ? true : this._byValue.check(visited, this._size);
  }

  /**
   * O(n): rebuilds the heap and validates the payload; handles are not serialized. A serialized
   * pairing heap lists its root (the minimum) first, so the values are rebuilt as that root with
   * every other value as a child, in the order that makes the pre-order walk, and so toArray(),
   * reproduce the payload exactly. A payload whose first value is not a minimum is rebuilt by
   * plain pushes.
   */
  static deserialize<T>(json: unknown, compare?: Comparator<T>): PairingHeap<T> {
    const { values } = parseHeap(json, "PairingHeap");
    const heap = new PairingHeap<T>(compare);
    const items = values as T[];
    let rootFirst = true;
    for (let index = 1; index < items.length && rootFirst; index++) {
      rootFirst = heap.compare(items[0], items[index]) <= 0;
    }
    // push(root) then the rest in reverse: each later push becomes the root's last child, and the
    // walk visits children last-to-first, so it yields items[1], items[2], ... in order.
    heap.build(rootFirst && items.length > 1 ? [items[0], ...items.slice(1).reverse()] : items);
    const valid = heap.validate();
    if (valid !== true) {
      throw new TypeError(`Invalid PairingHeap payload: ${valid}`);
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
    this._pushed = new PushOrder();
    this._byValue = null;
  }

  /** clear() and build(): retire the owner token so every earlier handle is stale. */
  protected override invalidateHandles(): void {
    this._owner.dead = true;
    this._owner = createOwner();
  }

  /** O(α) for a handle; builds the value index on first value-based use. Null when absent/stale. */
  private locate(target: HeapHandle<T> | T): PairingNode<T> | null {
    if (target instanceof PairingNode) {
      return this.resolve(target as PairingNode<T>);
    }
    if (isHeapHandle(target)) {
      throw new TypeError("handle belongs to a different heap class");
    }
    this.requireValue(target as T);
    return this.ensureIndex().newest(target as T) ?? null;
  }

  /** O(α(n)) amortized: the node if it is live in this heap, null if stale; TypeError if foreign. */
  private resolve(node: PairingNode<T>): PairingNode<T> | null {
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

  private ensureIndex(): ValueIndex<T, PairingNode<T>> {
    if (this._byValue === null) {
      this._byValue = indexFromPushOrder(this._pushed);
    }
    return this._byValue;
  }

  /** O(1): removes a node that has left the tree from the bookkeeping and makes its handle stale. */
  private retire(node: PairingNode<T>): void {
    this._pushed.unlink(node);
    this._byValue?.remove(node);
    node.owner = null;
    this._size--;
  }

  /** Two-pass pairing of detached siblings into one tree; null when there are none. */
  private combine(children: PairingNode<T>[]): PairingNode<T> | null {
    if (children.length === 0) {
      return null;
    }
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
    return merged;
  }

  /** Compare two roots and hang the larger under the smaller; O(1). */
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
