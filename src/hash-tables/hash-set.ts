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

/**
 * Set wrapper over a HashMap<E, true> (separate chaining), so add/has/delete are expected O(1) with
 * HashMap's 0.75 load factor and O(n + capacity) doubling. add() performs two lookups (has, then
 * set) and hashes twice. Every algebraic operation returns a fresh HashSet built with the same
 * options and, except union and isSupersetOf, first copies `other` into a temporary HashSet even
 * when it already is one; expect O(n + m) expected time and O(m) extra memory, with m = |other|.
 * toArray() makes three passes (entry snapshot, key projection, spread) and iteration goes through
 * that snapshot, throwing ConcurrentModificationError if the set is mutated mid-iteration.
 */
export class HashSet<E> extends ContainerBase<E> implements HashSetLike<E> {
  private readonly _options: HashOptions<E>;
  private _map: HashMap<E, true>;

  constructor(options: HashOptions<E> = {}) {
    super();
    this._options = { ...options };
    this._map = new HashMap<E, true>(options);
  }

  /** Expected O(1) with two chain lookups; O(n + capacity) when the backing map doubles. */
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

  /** Expected O(1): splices the entry from its chain; no tombstones, never shrinks. */
  delete(value: E): boolean {
    if (!this._map.delete(value)) {
      return false;
    }
    this._size--;
    this.touch();
    return true;
  }

  /** Expected O(1); worst O(n) on a degenerate chain. */
  has(value: E): boolean {
    return this._map.has(value);
  }

  /** O(capacity). */
  clear(): void {
    this._map.clear();
    this._size = 0;
    this.touch();
  }

  /** O(n + capacity) with three array allocations. */
  toArray(): E[] {
    return [...this._map.keys()];
  }

  /** O(n + capacity) up front (snapshot), then O(1) per step. */
  values(): IterableIterator<E> {
    return this.snapshotIterator(this.toArray());
  }

  /** Alias for values(). */
  keys(): IterableIterator<E> {
    return this.values();
  }

  /** Alias for values(). */
  [Symbol.iterator](): IterableIterator<E> {
    return this.values();
  }

  /**
   * O(n + m) expected: snapshots this set, then adds every element of both into a new HashSet that
   * grows by doubling from the default capacity (no `other` copy is made).
   */
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

  /**
   * O(n + m) expected: copies `other` into a temporary HashSet, then filters this set's
   * snapshot.
   */
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

  /**
   * O(n + m) expected: copies `other` into a temporary HashSet, then filters this set's
   * snapshot.
   */
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

  /** O(n + m) expected: copies `other`, then scans both this set and the copy. */
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

  /**
   * O(n + m) expected: always materializes `other` first, even when the size check would reject
   * immediately afterwards.
   */
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

  /**
   * O(m) expected with no allocation: one has() per element of `other`; the cheapest comparison
   * here.
   */
  isSupersetOf(other: Iterable<E>): boolean {
    for (const value of other) {
      if (!this.has(value)) {
        return false;
      }
    }
    return true;
  }

  /**
   * O(n + 2m) expected: copies `other`, then isSubsetOf copies that copy again before
   * comparing.
   */
  equals(other: Iterable<E>): boolean {
    const lookup = this.buildLookup(other);
    return this._size === lookup.size && this.isSubsetOf(lookup);
  }

  /** O(n + capacity): delegates to the backing map's validate. */
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

  /** O(n + capacity) plus JSON.stringify. */
  serialize(): string {
    return serializeRecord("HashSet", { values: this.toArray() });
  }

  /** O(n) expected adds, then validate. */
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
