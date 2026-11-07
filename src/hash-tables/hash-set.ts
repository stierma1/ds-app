import {
  assertDefined,
  ContainerBase,
  parseSerialized,
  readArray,
  readValue,
  serializeRecord,
} from "../core/index.ts";
import { HashMap } from "./separate-chaining.ts";
import type { HashOptions, HashSetLike } from "./types.ts";

export class HashSet<E> extends ContainerBase<E> implements HashSetLike<E> {
  private readonly _options: HashOptions<E>;
  private _map: HashMap<E, true>;

  constructor(options: HashOptions<E> = {}) {
    super();
    this._options = { ...options };
    this._map = new HashMap<E, true>(options);
  }

  add(value: E): boolean {
    assertDefined(value, "value");
    if (this._map.has(value)) {
      return false;
    }
    this._map.set(value, true);
    this._size++;
    this.touch();
    return true;
  }

  delete(value: E): boolean {
    if (!this._map.delete(value)) {
      return false;
    }
    this._size--;
    this.touch();
    return true;
  }

  has(value: E): boolean {
    return this._map.has(value);
  }

  clear(): void {
    this._map.clear();
    this._size = 0;
    this.touch();
  }

  toArray(): E[] {
    return [...this._map.keys()];
  }

  values(): IterableIterator<E> {
    return this.snapshotIterator(this.toArray());
  }

  keys(): IterableIterator<E> {
    return this.values();
  }

  [Symbol.iterator](): IterableIterator<E> {
    return this.values();
  }

  union(other: Iterable<E>): HashSet<E> {
    const result = this.cloneEmpty();
    for (const value of this) {
      result.add(value);
    }
    for (const value of other) {
      result.add(value);
    }
    return result;
  }

  intersection(other: Iterable<E>): HashSet<E> {
    const lookup = this.buildLookup(other);
    const result = this.cloneEmpty();
    for (const value of this) {
      if (lookup.has(value)) {
        result.add(value);
      }
    }
    return result;
  }

  difference(other: Iterable<E>): HashSet<E> {
    const lookup = this.buildLookup(other);
    const result = this.cloneEmpty();
    for (const value of this) {
      if (!lookup.has(value)) {
        result.add(value);
      }
    }
    return result;
  }

  symmetricDifference(other: Iterable<E>): HashSet<E> {
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

  validate(): true | string {
    const result = this._map.validate();
    if (result !== true) {
      return result;
    }
    if (this._map.size !== this._size) {
      return "size does not match the backing map";
    }
    return true;
  }

  serialize(): string {
    return serializeRecord("HashSet", { values: this.toArray() });
  }

  static deserialize<E>(
    json: unknown,
    options: HashOptions<E> = {},
  ): HashSet<E> {
    const record = parseSerialized(json, "HashSet");
    const values = readArray(record, "values");
    const set = new HashSet<E>(options);
    for (let index = 0; index < values.length; index++) {
      set.add(readValue<E>(values[index], `values[${index}]`));
    }
    if (set.validate() !== true) {
      throw new TypeError(`Invalid HashSet payload: ${set.validate()}`);
    }
    return set;
  }

  private cloneEmpty(): HashSet<E> {
    return new HashSet<E>(this._options);
  }

  private buildLookup(other: Iterable<E>): HashSet<E> {
    const lookup = this.cloneEmpty();
    for (const value of other) {
      lookup.add(value);
    }
    return lookup;
  }
}
