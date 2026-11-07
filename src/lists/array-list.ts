import {
  assertComparator,
  assertDefined,
  assertInteger,
  ContainerBase,
} from "../core/index.ts";
import type { Comparator } from "../core/index.ts";
import { deserializeValues, serializeValues } from "./serialization.ts";
import type { ListLike } from "./types.ts";

function checkOptionalInteger(value: number | undefined, name: string): void {
  if (value !== undefined) {
    assertInteger(value, name);
  }
}

/**
 * Growable list backed by a plain JavaScript array.
 *
 * Fast: O(1) get/set by index and O(1) amortized push/pop at the back, which no
 * linked list in this module can match. Slow: insert/remove/unshift/shift move
 * every element after the position (O(n) worst case), so prefer ArrayDeque when
 * both ends must be fast; DoublyLinkedList only wins where it can relink without
 * walking (the ends, and split). Growth is left to the engine's array policy.
 * Iteration is over a snapshot and throws ConcurrentModificationError if the
 * list is mutated mid-iteration.
 */
export class ArrayList<T> extends ContainerBase<T> implements ListLike<T> {
  private _items: T[] = [];

  override get size(): number {
    return this._size;
  }

  /** O(1): direct array index. */
  get(index: number): T | undefined {
    assertInteger(index);
    if (index < 0 || index >= this._size) {
      return undefined;
    }
    return this._items[index];
  }

  /** O(1). */
  set(index: number, value: T): T {
    assertInteger(index);
    assertDefined(value);
    if (index < 0 || index >= this._size) {
      throw new RangeError("index is out of range");
    }
    const previous = this._items[index];
    this._items[index] = value;
    this.touch();
    return previous;
  }

  /** O(n - index): splice shifts every element after the position. */
  insert(index: number, value: T): void {
    assertInteger(index);
    assertDefined(value);
    if (index < 0 || index > this._size) {
      throw new RangeError("index is out of range");
    }
    this._items.splice(index, 0, value);
    this._size++;
    this.touch();
  }

  /** O(n - index): splice shifts every later element down. */
  remove(index: number): T | undefined {
    assertInteger(index);
    if (index < 0 || index >= this._size) {
      return undefined;
    }
    const [removed] = this._items.splice(index, 1);
    this._size--;
    this.touch();
    return removed;
  }

  /** O(1) amortized (engine-managed array growth). */
  push(value: T): void {
    assertDefined(value);
    this._items.push(value);
    this._size++;
    this.touch();
  }

  /** O(1). */
  pop(): T | undefined {
    if (this._size === 0) {
      return undefined;
    }
    const value = this._items.pop();
    this._size--;
    this.touch();
    return value;
  }

  /** O(n): every element shifts up one slot; ArrayDeque.pushFront is O(1) amortized. */
  unshift(value: T): void {
    assertDefined(value);
    this._items.unshift(value);
    this._size++;
    this.touch();
  }

  /** O(n): every element shifts down one slot; ArrayDeque.popFront is O(1) amortized. */
  shift(): T | undefined {
    if (this._size === 0) {
      return undefined;
    }
    const value = this._items.shift();
    this._size--;
    this.touch();
    return value;
  }

  /** O(1). */
  first(): T | undefined {
    return this._size === 0 ? undefined : this._items[0];
  }

  /** O(1). */
  last(): T | undefined {
    return this._size === 0 ? undefined : this._items[this._size - 1];
  }

  /** O(n) linear scan over the backing array; no copy. */
  indexOf(value: T, from?: number): number {
    checkOptionalInteger(from, "from");
    return this._items.indexOf(value, from);
  }

  /** O(n) reverse linear scan; no copy. */
  lastIndexOf(value: T, from?: number): number {
    checkOptionalInteger(from, "from");
    if (from === undefined) {
      return this._items.lastIndexOf(value);
    }
    return this._items.lastIndexOf(value, from);
  }

  /** O(k) for k returned elements; returns a fresh array. */
  slice(start?: number, end?: number): T[] {
    checkOptionalInteger(start, "start");
    checkOptionalInteger(end, "end");
    return this._items.slice(start, end);
  }

  /** O(n): in-place engine splice; omitting deleteCount removes everything from start on. */
  splice(start: number, deleteCount?: number, ...items: T[]): T[] {
    assertInteger(start, "start");
    checkOptionalInteger(deleteCount, "deleteCount");
    for (const item of items) {
      assertDefined(item);
    }
    const removed = deleteCount === undefined
      ? this._items.splice(start, this._items.length, ...items)
      : this._items.splice(start, deleteCount, ...items);
    this._size = this._items.length;
    this.touch();
    return removed;
  }

  /** O(n) in place; no allocation. */
  reverse(): this {
    this._items.reverse();
    this.touch();
    return this;
  }

  /** O(n log n): in-place engine sort (stable). */
  sort(compare?: Comparator<T>): this {
    if (compare !== undefined) {
      assertComparator(compare);
    }
    this._items.sort(compare);
    this.touch();
    return this;
  }

  /** O(m) for m incoming values; materializes `other` into an array before appending. */
  merge(other: Iterable<T>): this {
    const values = [...other];
    for (const value of values) {
      assertDefined(value);
      this._items.push(value);
    }
    this._size = this._items.length;
    if (values.length > 0) {
      this.touch();
    }
    return this;
  }

  /** O(n - index): the tail is spliced off into the new list; the left half is not copied. */
  split(index: number): ArrayList<T> {
    assertInteger(index);
    if (index < 0 || index > this._size) {
      throw new RangeError("index is out of range");
    }
    const right = new ArrayList<T>();
    right._items = this._items.splice(index);
    right._size = right._items.length;
    this._size = this._items.length;
    this.touch();
    right.touch();
    return right;
  }

  /** O(n). */
  serialize(): string {
    return serializeValues("ArrayList", this.toArray());
  }

  /** O(n). */
  static deserialize<T>(json: unknown): ArrayList<T> {
    const list = new ArrayList<T>();
    for (const value of deserializeValues(json, "ArrayList")) {
      list.push(value as T);
    }
    return list;
  }

  /** O(1): drops the backing array. */
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
    }
    return true;
  }
}
