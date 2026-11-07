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

export class ArrayList<T> extends ContainerBase<T> implements ListLike<T> {
  private _items: T[] = [];

  override get size(): number {
    return this._size;
  }

  get(index: number): T | undefined {
    assertInteger(index);
    if (index < 0 || index >= this._size) {
      return undefined;
    }
    return this._items[index];
  }

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

  push(value: T): void {
    assertDefined(value);
    this._items.push(value);
    this._size++;
    this.touch();
  }

  pop(): T | undefined {
    if (this._size === 0) {
      return undefined;
    }
    const value = this._items.pop();
    this._size--;
    this.touch();
    return value;
  }

  unshift(value: T): void {
    assertDefined(value);
    this._items.unshift(value);
    this._size++;
    this.touch();
  }

  shift(): T | undefined {
    if (this._size === 0) {
      return undefined;
    }
    const value = this._items.shift();
    this._size--;
    this.touch();
    return value;
  }

  first(): T | undefined {
    return this._size === 0 ? undefined : this._items[0];
  }

  last(): T | undefined {
    return this._size === 0 ? undefined : this._items[this._size - 1];
  }

  indexOf(value: T, from?: number): number {
    checkOptionalInteger(from, "from");
    return this._items.indexOf(value, from);
  }

  lastIndexOf(value: T, from?: number): number {
    checkOptionalInteger(from, "from");
    if (from === undefined) {
      return this._items.lastIndexOf(value);
    }
    return this._items.lastIndexOf(value, from);
  }

  slice(start?: number, end?: number): T[] {
    checkOptionalInteger(start, "start");
    checkOptionalInteger(end, "end");
    return this._items.slice(start, end);
  }

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

  reverse(): this {
    this._items.reverse();
    this.touch();
    return this;
  }

  sort(compare?: Comparator<T>): this {
    if (compare !== undefined) {
      assertComparator(compare);
    }
    this._items.sort(compare);
    this.touch();
    return this;
  }

  serialize(): string {
    return serializeValues("ArrayList", this.toArray());
  }

  static deserialize<T>(json: unknown): ArrayList<T> {
    const list = new ArrayList<T>();
    for (const value of deserializeValues(json, "ArrayList")) {
      list.push(value as T);
    }
    return list;
  }

  clear(): void {
    this._items = [];
    this._size = 0;
    this.touch();
  }

  toArray(): T[] {
    return this._items.slice();
  }

  [Symbol.iterator](): IterableIterator<T> {
    return this.snapshotIterator(this.toArray());
  }

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
