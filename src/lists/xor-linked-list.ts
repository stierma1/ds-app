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

interface Location {
  prev: number;
  id: number;
  next: number;
}

export class XorLinkedList<T> extends ContainerBase<T> implements ListLike<T> {
  private _values: Array<T | undefined> = [];
  private _links: number[] = [];
  private _freeNext: number[] = [];
  private _freeHead = 0;
  private _head = 0;
  private _tail = 0;

  private allocate(value: T): number {
    if (this._freeHead !== 0) {
      const id = this._freeHead;
      this._freeHead = this._freeNext[id - 1];
      this._values[id - 1] = value;
      this._links[id - 1] = 0;
      return id;
    }
    this._values.push(value);
    this._links.push(0);
    this._freeNext.push(0);
    return this._values.length;
  }

  private release(id: number): void {
    this._values[id - 1] = undefined;
    this._links[id - 1] = 0;
    this._freeNext[id - 1] = this._freeHead;
    this._freeHead = id;
  }

  private locate(index: number): Location {
    if (index < this._size / 2) {
      let prev = 0;
      let id = this._head;
      for (let i = 0; i < index; i++) {
        const next = this._links[id - 1] ^ prev;
        prev = id;
        id = next;
      }
      return { prev, id, next: this._links[id - 1] ^ prev };
    }
    let next = 0;
    let id = this._tail;
    for (let i = this._size - 1; i > index; i--) {
      const prev = this._links[id - 1] ^ next;
      next = id;
      id = prev;
    }
    return { prev: this._links[id - 1] ^ next, id, next };
  }

  get(index: number): T | undefined {
    assertInteger(index);
    if (index < 0 || index >= this._size) {
      return undefined;
    }
    return this._values[this.locate(index).id - 1];
  }

  set(index: number, value: T): T {
    assertInteger(index);
    assertDefined(value);
    if (index < 0 || index >= this._size) {
      throw new RangeError("index is out of range");
    }
    const id = this.locate(index).id;
    const previous = this._values[id - 1] as T;
    this._values[id - 1] = value;
    this.touch();
    return previous;
  }

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
      const location = this.locate(index);
      prev = location.prev;
      next = location.id;
    }
    const id = this.allocate(value);
    this._links[id - 1] = prev ^ next;
    if (prev !== 0) {
      this._links[prev - 1] ^= next ^ id;
    } else {
      this._head = id;
    }
    if (next !== 0) {
      this._links[next - 1] ^= prev ^ id;
    } else {
      this._tail = id;
    }
    this._size++;
    this.touch();
  }

  remove(index: number): T | undefined {
    assertInteger(index);
    if (index < 0 || index >= this._size) {
      return undefined;
    }
    const { prev, id, next } = this.locate(index);
    const value = this._values[id - 1] as T;
    if (prev !== 0) {
      this._links[prev - 1] ^= id ^ next;
    } else {
      this._head = next;
    }
    if (next !== 0) {
      this._links[next - 1] ^= id ^ prev;
    } else {
      this._tail = prev;
    }
    this.release(id);
    this._size--;
    this.touch();
    return value;
  }

  push(value: T): void {
    this.insert(this._size, value);
  }

  pop(): T | undefined {
    return this.remove(this._size - 1);
  }

  unshift(value: T): void {
    this.insert(0, value);
  }

  shift(): T | undefined {
    return this.remove(0);
  }

  first(): T | undefined {
    return this._size === 0 ? undefined : this._values[this._head - 1];
  }

  last(): T | undefined {
    return this._size === 0 ? undefined : this._values[this._tail - 1];
  }

  indexOf(value: T, from?: number): number {
    checkOptionalInteger(from, "from");
    const values = this.toArray();
    return from === undefined ? values.indexOf(value) : values.indexOf(value, from);
  }

  lastIndexOf(value: T, from?: number): number {
    checkOptionalInteger(from, "from");
    const values = this.toArray();
    return from === undefined ? values.lastIndexOf(value) : values.lastIndexOf(value, from);
  }

  slice(start?: number, end?: number): T[] {
    checkOptionalInteger(start, "start");
    checkOptionalInteger(end, "end");
    return this.toArray().slice(start, end);
  }

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

  reverse(): this {
    this._resetFrom(this.toArray().reverse());
    return this;
  }

  sort(compare?: Comparator<T>): this {
    if (compare !== undefined) {
      assertComparator(compare);
    }
    this._resetFrom(this.toArray().sort(compare));
    return this;
  }

  serialize(): string {
    return serializeValues("XorLinkedList", this.toArray());
  }

  static deserialize<T>(json: unknown): XorLinkedList<T> {
    const list = new XorLinkedList<T>();
    for (const value of deserializeValues(json, "XorLinkedList")) {
      list.push(value as T);
    }
    return list;
  }

  clear(): void {
    this._values = [];
    this._links = [];
    this._freeNext = [];
    this._freeHead = 0;
    this._head = 0;
    this._tail = 0;
    this._size = 0;
    this.touch();
  }

  toArray(): T[] {
    const values: T[] = [];
    let prev = 0;
    let id = this._head;
    let guard = 0;
    while (id !== 0) {
      values.push(this._values[id - 1] as T);
      const next = this._links[id - 1] ^ prev;
      prev = id;
      id = next;
      if (++guard > this._size) {
        break;
      }
    }
    return values;
  }

  [Symbol.iterator](): IterableIterator<T> {
    return this.snapshotIterator(this.toArray());
  }

  validate(): true | string {
    const forward: number[] = [];
    let prev = 0;
    let id = this._head;
    while (id !== 0) {
      if (id < 1 || id > this._values.length) {
        return "forward link points outside the arena";
      }
      if (forward.includes(id)) {
        return "cycle detected in forward links";
      }
      if (this._values[id - 1] === undefined) {
        return `live node ${id} has undefined value`;
      }
      forward.push(id);
      const next = this._links[id - 1] ^ prev;
      prev = id;
      id = next;
      if (forward.length > this._size) {
        return "list contains more nodes than size";
      }
    }
    if (forward.length !== this._size) {
      return `size ${this._size} does not match node count ${forward.length}`;
    }
    if (this._size === 0) {
      if (this._head !== 0 || this._tail !== 0) {
        return "empty list has non-zero endpoints";
      }
    } else if (forward[forward.length - 1] !== this._tail) {
      return "tail pointer does not match the last node";
    }

    const backward: number[] = [];
    let next = 0;
    id = this._tail;
    while (id !== 0) {
      if (backward.includes(id)) {
        return "cycle detected in backward links";
      }
      backward.push(id);
      const previous = this._links[id - 1] ^ next;
      next = id;
      id = previous;
      if (backward.length > this._size) {
        return "backward walk exceeds size";
      }
    }
    if (backward.length !== forward.length) {
      return "forward and backward node counts differ";
    }
    for (let i = 0; i < forward.length; i++) {
      if (forward[i] !== backward[backward.length - 1 - i]) {
        return "forward and backward walks disagree";
      }
    }

    const live = new Set(forward);
    const free = new Set<number>();
    for (let freeId = this._freeHead; freeId !== 0; freeId = this._freeNext[freeId - 1]) {
      if (freeId < 1 || freeId > this._values.length) {
        return "free link points outside the arena";
      }
      if (free.has(freeId)) {
        return "cycle detected in free list";
      }
      if (live.has(freeId)) {
        return "free list references a live node";
      }
      free.add(freeId);
      if (this._values[freeId - 1] !== undefined) {
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
    this._links = [];
    this._freeNext = [];
    this._freeHead = 0;
    this._head = 0;
    this._tail = 0;
    this._size = 0;
    for (const value of values) {
      assertDefined(value);
      const previousTail = this._tail;
      const id = this.allocate(value);
      if (previousTail === 0) {
        this._head = id;
      } else {
        this._links[previousTail - 1] ^= id;
      }
      this._links[id - 1] = previousTail;
      this._tail = id;
      this._size++;
    }
    this.touch();
  }
}
