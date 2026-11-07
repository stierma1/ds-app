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
 * Doubly linked list stored in three parallel arrays (values, next, prev) that
 * are addressed by 1-based integer cursors instead of node objects, with a free
 * list of released slots.
 *
 * Same asymptotics as DoublyLinkedList (O(1) at both ends, by-index access in
 * O(min(index, n - index)) from the nearer end) but no per-node object
 * allocation: a removed slot goes on the free list and the next insert reuses
 * it, and the arena only grows until clear or a rebuild. Unlike
 * DoublyLinkedList, split and reverse flatten to an array and rebuild the
 * arena, so they are O(n) with a full allocation. Iteration is over a snapshot
 * and throws ConcurrentModificationError if the list is mutated mid-iteration.
 */
export class CursorList<T> extends ContainerBase<T> implements ListLike<T> {
  private _values: Array<T | undefined> = [];
  private _next: number[] = [];
  private _prev: number[] = [];
  private _freeHead = 0;
  private _head = 0;
  private _tail = 0;

  /** O(1): reuses the most recently freed slot, else appends to the arena (amortized O(1)). */
  private allocate(value: T): number {
    let id: number;
    if (this._freeHead !== 0) {
      id = this._freeHead;
      this._freeHead = this._next[id - 1];
      this._values[id - 1] = value;
      this._next[id - 1] = 0;
      this._prev[id - 1] = 0;
    } else {
      id = this._values.length + 1;
      this._values.push(value);
      this._next.push(0);
      this._prev.push(0);
    }
    return id;
  }

  /** O(1): pushes the slot onto the free list; the arena never shrinks on remove. */
  private release(id: number): void {
    this._values[id - 1] = undefined;
    this._next[id - 1] = this._freeHead;
    this._prev[id - 1] = 0;
    this._freeHead = id;
  }

  /** Walks from the head or the tail, whichever is nearer: O(min(index, n - index)). */
  private nodeAt(index: number): number {
    if (index < this._size / 2) {
      let id = this._head;
      for (let i = 0; i < index; i++) {
        id = this._next[id - 1];
      }
      return id;
    }
    let id = this._tail;
    for (let i = this._size - 1; i > index; i--) {
      id = this._prev[id - 1];
    }
    return id;
  }

  private linkBetween(prev: number, next: number, id: number): void {
    this._prev[id - 1] = prev;
    this._next[id - 1] = next;
    if (prev === 0) {
      this._head = id;
    } else {
      this._next[prev - 1] = id;
    }
    if (next === 0) {
      this._tail = id;
    } else {
      this._prev[next - 1] = id;
    }
  }

  private unlink(id: number): void {
    const prev = this._prev[id - 1];
    const next = this._next[id - 1];
    if (prev === 0) {
      this._head = next;
    } else {
      this._next[prev - 1] = next;
    }
    if (next === 0) {
      this._tail = prev;
    } else {
      this._prev[next - 1] = prev;
    }
    this.release(id);
  }

  /** O(min(index, n - index)): walks from the nearer end. */
  get(index: number): T | undefined {
    assertInteger(index);
    if (index < 0 || index >= this._size) {
      return undefined;
    }
    return this._values[this.nodeAt(index) - 1];
  }

  /** O(min(index, n - index)): walks from the nearer end. */
  set(index: number, value: T): T {
    assertInteger(index);
    assertDefined(value);
    if (index < 0 || index >= this._size) {
      throw new RangeError("index is out of range");
    }
    const id = this.nodeAt(index);
    const previous = this._values[id - 1] as T;
    this._values[id - 1] = value;
    this.touch();
    return previous;
  }

  /** O(1) at index 0 or n; otherwise an O(min(index, n - index)) walk, then an O(1) relink. */
  insert(index: number, value: T): void {
    assertInteger(index);
    assertDefined(value);
    if (index < 0 || index > this._size) {
      throw new RangeError("index is out of range");
    }
    let prev = 0;
    let next = 0;
    if (index === 0) {
      next = this._head;
    } else if (index === this._size) {
      prev = this._tail;
    } else {
      prev = this.nodeAt(index - 1);
      next = this._next[prev - 1];
    }
    const id = this.allocate(value);
    this.linkBetween(prev, next, id);
    this._size++;
    this.touch();
  }

  /** O(1) at either end; otherwise an O(min(index, n - index)) walk; the slot is recycled. */
  remove(index: number): T | undefined {
    assertInteger(index);
    if (index < 0 || index >= this._size) {
      return undefined;
    }
    const id = this.nodeAt(index);
    const value = this._values[id - 1] as T;
    this.unlink(id);
    this._size--;
    this.touch();
    return value;
  }

  /** O(1) amortized: tail insert, growing the arena only when the free list is empty. */
  push(value: T): void {
    this.insert(this._size, value);
  }

  /** O(1). */
  pop(): T | undefined {
    return this.remove(this._size - 1);
  }

  /** O(1) amortized. */
  unshift(value: T): void {
    this.insert(0, value);
  }

  /** O(1). */
  shift(): T | undefined {
    return this.remove(0);
  }

  /** O(1). */
  first(): T | undefined {
    return this._size === 0 ? undefined : this._values[this._head - 1];
  }

  /** O(1). */
  last(): T | undefined {
    return this._size === 0 ? undefined : this._values[this._tail - 1];
  }

  /** O(n): copies the list to an array before scanning. */
  indexOf(value: T, from?: number): number {
    checkOptionalInteger(from, "from");
    const values = this.toArray();
    return from === undefined ? values.indexOf(value) : values.indexOf(value, from);
  }

  /** O(n): copies the list to an array before scanning backward. */
  lastIndexOf(value: T, from?: number): number {
    checkOptionalInteger(from, "from");
    const values = this.toArray();
    return from === undefined ? values.lastIndexOf(value) : values.lastIndexOf(value, from);
  }

  /** O(n), not O(k): copies the whole list before slicing. */
  slice(start?: number, end?: number): T[] {
    checkOptionalInteger(start, "start");
    checkOptionalInteger(end, "end");
    return this.toArray().slice(start, end);
  }

  /** O(n): flattens to an array, splices, and rebuilds the arena. */
  splice(start: number, deleteCount?: number, ...items: T[]): T[] {
    assertInteger(start, "start");
    checkOptionalInteger(deleteCount, "deleteCount");
    for (const item of items) {
      assertDefined(item);
    }
    const values = this.toArray();
    const removed = deleteCount === undefined
      ? values.splice(start, values.length, ...items)
      : values.splice(start, deleteCount, ...items);
    this._resetFrom(values);
    return removed;
  }

  /** O(n): rebuilds the arena from a reversed flat copy (DoublyLinkedList reverses in place). */
  reverse(): this {
    const values = this.toArray().reverse();
    this._resetFrom(values);
    return this;
  }

  /** O(n log n) sort of a flat copy, then an O(n) arena rebuild. */
  sort(compare?: Comparator<T>): this {
    if (compare !== undefined) {
      assertComparator(compare);
    }
    const values = this.toArray().sort(compare);
    this._resetFrom(values);
    return this;
  }

  /** O(m) for m incoming values; each is an O(1) amortized push. */
  merge(other: Iterable<T>): this {
    const values = [...other];
    for (const value of values) {
      assertDefined(value);
    }
    for (const value of values) {
      this.push(value);
    }
    return this;
  }

  /** O(n): both halves are rebuilt from a flat copy (DoublyLinkedList.split relinks instead). */
  split(index: number): CursorList<T> {
    assertInteger(index);
    const values = this.toArray();
    if (index < 0 || index > values.length) {
      throw new RangeError("index is out of range");
    }
    const right = new CursorList<T>();
    right._resetFrom(values.slice(index));
    this._resetFrom(values.slice(0, index));
    return right;
  }

  /** O(n). */
  serialize(): string {
    return serializeValues("CursorList", this.toArray());
  }

  /** O(n). */
  static deserialize<T>(json: unknown): CursorList<T> {
    const list = new CursorList<T>();
    for (const value of deserializeValues(json, "CursorList")) {
      list.push(value as T);
    }
    return list;
  }

  /** O(1): drops the arena arrays. */
  clear(): void {
    this._values = [];
    this._next = [];
    this._prev = [];
    this._freeHead = 0;
    this._head = 0;
    this._tail = 0;
    this._size = 0;
    this.touch();
  }

  /** O(n) walk into a fresh array. */
  toArray(): T[] {
    const values: T[] = [];
    for (let id = this._head; id !== 0; id = this._next[id - 1]) {
      values.push(this._values[id - 1] as T);
    }
    return values;
  }

  /** O(n) up front: snapshots the list, then throws ConcurrentModificationError on mutation. */
  [Symbol.iterator](): IterableIterator<T> {
    return this.snapshotIterator(this.toArray());
  }

  /** O(n): walks live nodes both ways plus the free list; allocates two Sets. */
  validate(): true | string {
    const live = new Set<number>();
    let count = 0;
    let previous = 0;
    for (let id = this._head; id !== 0; id = this._next[id - 1]) {
      if (id < 1 || id > this._values.length) {
        return "forward link points outside the arena";
      }
      if (live.has(id)) {
        return "cycle detected in live links";
      }
      live.add(id);
      if (this._prev[id - 1] !== previous) {
        return `broken prev link at live index ${count}`;
      }
      if (this._values[id - 1] === undefined) {
        return `live node ${id} has undefined value`;
      }
      previous = id;
      count++;
      if (count > this._size) {
        return "live list contains more nodes than size";
      }
    }
    if (count !== this._size) {
      return `size ${this._size} does not match live node count ${count}`;
    }
    if (this._size === 0) {
      if (this._head !== 0 || this._tail !== 0) {
        return "empty list has non-zero endpoints";
      }
    } else if (this._tail !== previous) {
      return "tail pointer does not match the last live node";
    }

    let backCount = 0;
    let next = 0;
    for (let id = this._tail; id !== 0; id = this._prev[id - 1]) {
      if (this._next[id - 1] !== next) {
        return "broken next link while walking backward";
      }
      next = id;
      backCount++;
      if (backCount > this._size) {
        return "cycle detected in backward links";
      }
    }
    if (backCount !== count) {
      return "forward and backward live counts differ";
    }

    const free = new Set<number>();
    for (let id = this._freeHead; id !== 0; id = this._next[id - 1]) {
      if (id < 1 || id > this._values.length) {
        return "free link points outside the arena";
      }
      if (free.has(id)) {
        return "cycle detected in free list";
      }
      if (live.has(id)) {
        return "free list references a live node";
      }
      free.add(id);
      if (this._values[id - 1] !== undefined) {
        return "free node has a value";
      }
    }
    if (live.size + free.size !== this._values.length) {
      return "arena contains unreachable nodes";
    }
    return true;
  }

  private _resetFrom(values: T[]): void {
    this._values = [];
    this._next = [];
    this._prev = [];
    this._freeHead = 0;
    this._head = 0;
    this._tail = 0;
    this._size = 0;
    for (const value of values) {
      assertDefined(value);
      const id = this.allocate(value);
      this.linkBetween(this._tail, 0, id);
      this._size++;
    }
    this.touch();
  }
}
