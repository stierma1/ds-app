import {
  assertDefined,
  ContainerBase,
  resolveComparator,
} from "../core/index.ts";
import type { Comparator, SetLike } from "../core/index.ts";
import { deserializeValues, serializeValues } from "./serialization.ts";

export class SortedArraySet<E> extends ContainerBase<E> implements SetLike<E> {
  private _items: E[] = [];
  readonly compare: Comparator<E>;

  constructor(compare?: Comparator<E>) {
    super();
    this.compare = resolveComparator(compare);
  }

  add(value: E): boolean {
    assertDefined(value, "value");
    const index = this.lowerBound(value);
    if (index < this._items.length && this.compare(this._items[index], value) === 0) {
      return false;
    }
    this._items.splice(index, 0, value);
    this._size++;
    this.touch();
    return true;
  }

  delete(value: E): boolean {
    const index = this.indexOf(value);
    if (index < 0) {
      return false;
    }
    this._items.splice(index, 1);
    this._size--;
    this.touch();
    return true;
  }

  has(value: E): boolean {
    return this.indexOf(value) >= 0;
  }

  min(): E | undefined {
    return this._items[0];
  }

  max(): E | undefined {
    return this._items[this._size - 1];
  }

  at(index: number): E | undefined {
    if (!Number.isInteger(index)) {
      throw new TypeError("index must be an integer");
    }
    return index < 0 || index >= this._size ? undefined : this._items[index];
  }

  indexOf(value: E): number {
    const index = this.lowerBound(value);
    return index < this._items.length && this.compare(this._items[index], value) === 0
      ? index
      : -1;
  }

  union(other: Iterable<E>): SortedArraySet<E> {
    const result = this.cloneEmpty();
    for (const value of this) {
      result.add(value);
    }
    for (const value of other) {
      result.add(value);
    }
    return result;
  }

  intersection(other: Iterable<E>): SortedArraySet<E> {
    const lookup = this.buildLookup(other);
    const result = this.cloneEmpty();
    for (const value of this) {
      if (lookup.has(value)) {
        result.add(value);
      }
    }
    return result;
  }

  difference(other: Iterable<E>): SortedArraySet<E> {
    const lookup = this.buildLookup(other);
    const result = this.cloneEmpty();
    for (const value of this) {
      if (!lookup.has(value)) {
        result.add(value);
      }
    }
    return result;
  }

  symmetricDifference(other: Iterable<E>): SortedArraySet<E> {
    const lookup = this.buildLookup(other);
    const result = this.cloneEmpty();
    for (const value of this) {
      if (!lookup.has(value)) {
        result.add(value);
      }
    }
    for (const value of lookup) {
      if (!this.has(value)) {
        result.add(value);
      }
    }
    return result;
  }

  isSubsetOf(other: Iterable<E>): boolean {
    const lookup = this.buildLookup(other);
    if (this._size > lookup.size) {
      return false;
    }
    for (const value of this) {
      if (!lookup.has(value)) {
        return false;
      }
    }
    return true;
  }

  isSupersetOf(other: Iterable<E>): boolean {
    for (const value of other) {
      if (!this.has(value)) {
        return false;
      }
    }
    return true;
  }

  equals(other: Iterable<E>): boolean {
    const lookup = this.buildLookup(other);
    return this._size === lookup.size && this.isSubsetOf(lookup);
  }

  clear(): void {
    this._items = [];
    this._size = 0;
    this.touch();
  }

  toArray(): E[] {
    return this._items.slice();
  }

  [Symbol.iterator](): IterableIterator<E> {
    return this.snapshotIterator(this.toArray());
  }

  validate(): true | string {
    if (this._items.length !== this._size) {
      return `size ${this._size} does not match backing length ${this._items.length}`;
    }
    for (let index = 0; index < this._items.length; index++) {
      if (this._items[index] === undefined) {
        return `element at index ${index} is undefined`;
      }
      if (index > 0 && this.compare(this._items[index - 1], this._items[index]) >= 0) {
        return `elements at indices ${index - 1} and ${index} are out of order or equal`;
      }
    }
    return true;
  }

  serialize(): string {
    return serializeValues("SortedArraySet", this.toArray());
  }

  static deserialize<E>(
    json: unknown,
    compare?: Comparator<E>,
  ): SortedArraySet<E> {
    const set = new SortedArraySet<E>(compare);
    for (const value of deserializeValues(json, "SortedArraySet")) {
      set.add(value as E);
    }
    if (set.validate() !== true) {
      throw new TypeError(`Invalid SortedArraySet payload: ${set.validate()}`);
    }
    return set;
  }

  private cloneEmpty(): SortedArraySet<E> {
    return new SortedArraySet<E>(this.compare);
  }

  private buildLookup(other: Iterable<E>): SortedArraySet<E> {
    const lookup = this.cloneEmpty();
    for (const value of other) {
      lookup.add(value);
    }
    return lookup;
  }

  private lowerBound(value: E): number {
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
