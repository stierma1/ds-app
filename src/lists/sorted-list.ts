import {
  assertDefined,
  ContainerBase,
  resolveComparator,
} from "../core/index.ts";
import type { Comparator } from "../core/index.ts";
import { deserializeValues, serializeValues } from "./serialization.ts";
import type { SortedListLike } from "./types.ts";

/**
 * Sorted set over a plain array kept in comparator order; add rejects a value
 * that compares equal to an existing one.
 *
 * Fast: find/indexOf and the add lookup use binary search (O(log n)
 * comparisons), and at/min/max are O(1) array reads. Slow: add and remove
 * still splice the array, so each costs O(n) element moves in the worst case;
 * merge avoids that with one linear pass. Prefer this over SortedLinkedList for
 * essentially every workload: the linked version scans linearly for every
 * lookup. Iteration is over a snapshot and throws ConcurrentModificationError
 * if the list is mutated mid-iteration.
 */
export class SortedList<T> extends ContainerBase<T> implements SortedListLike<T> {
  private _items: T[] = [];
  readonly compare: Comparator<T>;

  constructor(compare?: Comparator<T>) {
    super();
    this.compare = resolveComparator(compare);
  }

  /** O(log n) search + O(n - index) splice; returns false on a comparator-equal duplicate. */
  add(value: T): boolean {
    assertDefined(value);
    const index = this.lowerBound(value);
    if (index < this._items.length && this.compare(this._items[index], value) === 0) {
      return false;
    }
    this._items.splice(index, 0, value);
    this._size++;
    this.touch();
    return true;
  }

  /** O(log n) search + O(n - index) splice. */
  remove(value: T): boolean {
    const index = this.indexOf(value);
    if (index < 0) {
      return false;
    }
    this._items.splice(index, 1);
    this._size--;
    this.touch();
    return true;
  }

  /** O(log n) binary search; returns the stored element, not the probe. */
  find(value: T): T | undefined {
    const index = this.indexOf(value);
    return index < 0 ? undefined : this._items[index];
  }

  /** O(1). */
  min(): T | undefined {
    return this._size === 0 ? undefined : this._items[0];
  }

  /** O(1). */
  max(): T | undefined {
    return this._size === 0 ? undefined : this._items[this._size - 1];
  }

  /** O(log n) binary search (SortedLinkedList.indexOf scans linearly). */
  indexOf(value: T): number {
    const index = this.lowerBound(value);
    return index < this._items.length && this.compare(this._items[index], value) === 0
      ? index
      : -1;
  }

  /** O(1) access by rank; SortedLinkedList has no equivalent. */
  at(index: number): T | undefined {
    return index < 0 || index >= this._size ? undefined : this._items[index];
  }

  /**
   * O(m log m + n + m) for m incoming values: sorts the batch, then one linear
   * merge into a fresh array, keeping the existing element on ties. Far cheaper
   * than m separate adds (O(m * n)) when m is large. Merging `this` is a no-op.
   */
  merge(other: Iterable<T>): this {
    if (other === this) {
      return this;
    }
    const incoming = [...other];
    for (const value of incoming) {
      assertDefined(value);
    }
    incoming.sort(this.compare);
    const merged: T[] = [];
    let left = 0;
    let right = 0;
    while (left < this._items.length && right < incoming.length) {
      const comparison = this.compare(this._items[left], incoming[right]);
      if (comparison < 0) {
        merged.push(this._items[left++]);
      } else if (comparison > 0) {
        merged.push(incoming[right++]);
      } else {
        merged.push(this._items[left++]);
        right++;
      }
    }
    while (left < this._items.length) {
      merged.push(this._items[left++]);
    }
    while (right < incoming.length) {
      merged.push(incoming[right++]);
    }
    this._items = merged;
    this._size = merged.length;
    this.touch();
    return this;
  }

  /** O(n). */
  serialize(): string {
    return serializeValues("SortedList", this.toArray());
  }

  /** O(n log n) via repeated add when the payload is sorted; O(n^2) if badly out of order. */
  static deserialize<T>(json: unknown, compare?: Comparator<T>): SortedList<T> {
    const list = new SortedList<T>(compare);
    for (const value of deserializeValues(json, "SortedList")) {
      list.add(value as T);
    }
    return list;
  }

  /** O(1). */
  clear(): void {
    this._items = [];
    this._size = 0;
    this.touch();
  }

  /** O(n): returns a fresh copy, never the backing array. */
  toArray(): T[] {
    return this._items.slice();
  }

  /** O(n) up front: snapshots the list, then throws ConcurrentModificationError on mutation. */
  [Symbol.iterator](): IterableIterator<T> {
    return this.snapshotIterator(this.toArray());
  }

  /** O(n). */
  validate(): true | string {
    if (this._items.length !== this._size) {
      return `size ${this._size} does not match backing length ${this._items.length}`;
    }
    for (let i = 0; i < this._items.length; i++) {
      if (this._items[i] === undefined) {
        return `element at index ${i} is undefined`;
      }
      if (i > 0 && this.compare(this._items[i - 1], this._items[i]) >= 0) {
        return `elements at indices ${i - 1} and ${i} are out of order or equal`;
      }
    }
    return true;
  }

  /** Binary search for the first index whose element is >= value: O(log n) comparisons. */
  private lowerBound(value: T): number {
    let low = 0;
    let high = this._items.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.compare(this._items[middle], value) < 0) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    return low;
  }
}

class SortedNode<T> {
  value: T;
  next: SortedNode<T> | null = null;

  constructor(value: T) {
    this.value = value;
  }
}

/**
 * Sorted set over a singly linked chain with head and tail pointers; add
 * rejects comparator-equal duplicates.
 *
 * Every lookup or mutation scans from the head until it reaches a node >= the
 * probe, so add/remove/find/indexOf cost O(p) comparisons for a value of rank p
 * (O(n) worst case; there is no binary search, and the tail pointer only serves
 * max). Inserting a new maximum still walks all n nodes. All it avoids is
 * SortedList's O(n) element shift on insert, so it is competitive only for
 * small lists or inserts that cluster near the front; prefer SortedList
 * otherwise. Iteration is over a snapshot and throws
 * ConcurrentModificationError if the list is mutated mid-iteration.
 */
export class SortedLinkedList<T> extends ContainerBase<T> implements SortedListLike<T> {
  private _head: SortedNode<T> | null = null;
  private _tail: SortedNode<T> | null = null;
  readonly compare: Comparator<T>;

  constructor(compare?: Comparator<T>) {
    super();
    this.compare = resolveComparator(compare);
  }

  /** O(p) for rank p; O(n) worst case, including appending a new maximum. No element shift. */
  add(value: T): boolean {
    assertDefined(value);
    let previous: SortedNode<T> | null = null;
    let node = this._head;
    while (node !== null && this.compare(node.value, value) < 0) {
      previous = node;
      node = node.next;
    }
    if (node !== null && this.compare(node.value, value) === 0) {
      return false;
    }
    const added = new SortedNode(value);
    added.next = node;
    if (previous === null) {
      this._head = added;
    } else {
      previous.next = added;
    }
    if (node === null) {
      this._tail = added;
    }
    this._size++;
    this.touch();
    return true;
  }

  /** O(p) linear scan for rank p; O(n) worst case. */
  remove(value: T): boolean {
    let previous: SortedNode<T> | null = null;
    let node = this._head;
    while (node !== null && this.compare(node.value, value) < 0) {
      previous = node;
      node = node.next;
    }
    if (node === null || this.compare(node.value, value) !== 0) {
      return false;
    }
    if (previous === null) {
      this._head = node.next;
    } else {
      previous.next = node.next;
    }
    if (node === this._tail) {
      this._tail = previous;
    }
    this._size--;
    this.touch();
    return true;
  }

  /** O(p) linear scan; SortedList.find is O(log n). */
  find(value: T): T | undefined {
    let node = this._head;
    while (node !== null && this.compare(node.value, value) < 0) {
      node = node.next;
    }
    return node !== null && this.compare(node.value, value) === 0 ? node.value : undefined;
  }

  /** O(1). */
  min(): T | undefined {
    return this._head?.value;
  }

  /** O(1) via the tail pointer. */
  max(): T | undefined {
    return this._tail?.value;
  }

  /** O(p) linear scan; SortedList.indexOf is O(log n). */
  indexOf(value: T): number {
    let index = 0;
    let node = this._head;
    while (node !== null && this.compare(node.value, value) < 0) {
      index++;
      node = node.next;
    }
    return node !== null && this.compare(node.value, value) === 0 ? index : -1;
  }

  /**
   * O(m log m + n + m): sorts the incoming batch, merges it with a flat copy of
   * the chain, then rebuilds every node. Ties keep the existing element.
   */
  merge(other: Iterable<T>): this {
    if (other === this) {
      return this;
    }
    const incoming = [...other];
    for (const value of incoming) {
      assertDefined(value);
    }
    incoming.sort(this.compare);
    const current = this.toArray();
    const merged: T[] = [];
    let left = 0;
    let right = 0;
    while (left < current.length && right < incoming.length) {
      const comparison = this.compare(current[left], incoming[right]);
      if (comparison < 0) {
        merged.push(current[left++]);
      } else if (comparison > 0) {
        merged.push(incoming[right++]);
      } else {
        merged.push(current[left++]);
        right++;
      }
    }
    while (left < current.length) {
      merged.push(current[left++]);
    }
    while (right < incoming.length) {
      merged.push(incoming[right++]);
    }
    this._head = null;
    this._tail = null;
    this._size = 0;
    for (const value of merged) {
      const node = new SortedNode(value);
      if (this._tail === null) {
        this._head = node;
      } else {
        this._tail.next = node;
      }
      this._tail = node;
      this._size++;
    }
    this.touch();
    return this;
  }

  /** O(n). */
  serialize(): string {
    return serializeValues("SortedLinkedList", this.toArray());
  }

  /** O(n^2): each value is added by a linear scan, even when the payload is sorted. */
  static deserialize<T>(json: unknown, compare?: Comparator<T>): SortedLinkedList<T> {
    const list = new SortedLinkedList<T>(compare);
    for (const value of deserializeValues(json, "SortedLinkedList")) {
      list.add(value as T);
    }
    return list;
  }

  /** O(1): drops the chain. */
  clear(): void {
    this._head = null;
    this._tail = null;
    this._size = 0;
    this.touch();
  }

  /** O(n) walk into a fresh array. */
  toArray(): T[] {
    const values: T[] = [];
    for (let node = this._head; node !== null; node = node.next) {
      values.push(node.value);
    }
    return values;
  }

  /** O(n) up front: snapshots the list, then throws ConcurrentModificationError on mutation. */
  [Symbol.iterator](): IterableIterator<T> {
    return this.snapshotIterator(this.toArray());
  }

  /** O(n). */
  validate(): true | string {
    let count = 0;
    let previous: SortedNode<T> | null = null;
    for (let node = this._head; node !== null; node = node.next) {
      if (node.value === undefined) {
        return `node at index ${count} is undefined`;
      }
      if (previous !== null && this.compare(previous.value, node.value) >= 0) {
        return `nodes at indices ${count - 1} and ${count} are out of order or equal`;
      }
      previous = node;
      count++;
      if (count > this._size) {
        return "cycle detected in sorted linked list";
      }
    }
    if (count !== this._size) {
      return `size ${this._size} does not match node count ${count}`;
    }
    if (this._size === 0 && (this._head !== null || this._tail !== null)) {
      return "empty list has non-null endpoints";
    }
    if (this._size > 0 && this._tail?.next !== null) {
      return "tail has a successor";
    }
    return true;
  }
}
