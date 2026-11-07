import {
  assertDefined,
  ContainerBase,
  resolveComparator,
} from "../core/index.ts";
import type { Comparator, SetLike } from "../core/index.ts";
import { deserializeValues, serializeValues } from "./serialization.ts";

/**
 * Set of unique elements kept in one sorted JS array under a comparator (defaultComparator when
 * omitted).
 *
 * Fast: O(log n) has/indexOf by binary search, O(1) min/max and O(1) at(index) random access, and
 * ordered iteration with no sort step, none of which HashSet offers. Slow: add and delete splice
 * the array, so beyond the O(log n) search they shift O(n) elements; only appends in ascending
 * order avoid the shift. The binary set operations are linear two-pointer merges: O(n + m) when
 * `other` is a SortedArraySet sharing this comparator (its array is used as is), otherwise
 * O(m log m) to sort and dedupe `other` first. Prefer HashSet when order is irrelevant, BitSet
 * for dense small integers, and mergeSortedRuns for k > 2 sorted inputs.
 *
 * Iteration is over a snapshot copy (ascending) and throws ConcurrentModificationError if the set
 * is mutated mid-iteration.
 */
export class SortedArraySet<E> extends ContainerBase<E> implements SetLike<E> {
  private _items: E[] = [];
  readonly compare: Comparator<E>;

  constructor(compare?: Comparator<E>) {
    super();
    this.compare = resolveComparator(compare);
  }

  /**
   * O(log n) comparisons plus O(n) element shifting from splice; O(1) shifting when values arrive
   * in ascending order. Returns false, with no shift, for duplicates.
   */
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

  /** O(log n) search plus O(n) shift. Returns false when absent. */
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

  /** O(log n) binary search, no allocation. */
  has(value: E): boolean {
    return this.indexOf(value) >= 0;
  }

  /** O(1). */
  min(): E | undefined {
    return this._items[0];
  }

  /** O(1). */
  max(): E | undefined {
    return this._items[this._size - 1];
  }

  /**
   * O(1) direct array index; undefined when out of range. Tree-based ordered sets cannot do this in
   * O(1).
   */
  at(index: number): E | undefined {
    if (!Number.isInteger(index)) {
      throw new TypeError("index must be an integer");
    }
    return index < 0 || index >= this._size ? undefined : this._items[index];
  }

  /** O(log n): lower-bound binary search plus one equality comparison; -1 when absent. */
  indexOf(value: E): number {
    const index = this.lowerBound(value);
    return index < this._items.length && this.compare(this._items[index], value) === 0
      ? index
      : -1;
  }

  /** O(n + m) merge (plus O(m log m) if `other` must be sorted first); result is a fresh set. */
  union(other: Iterable<E>): SortedArraySet<E> {
    const right = this.sortedItems(other);
    const left = this._items;
    const merged: E[] = [];
    let i = 0;
    let j = 0;
    while (i < left.length && j < right.length) {
      const order = this.compare(left[i], right[j]);
      if (order < 0) {
        merged.push(left[i++]);
      } else if (order > 0) {
        merged.push(right[j++]);
      } else {
        merged.push(left[i++]);
        j++;
      }
    }
    while (i < left.length) {
      merged.push(left[i++]);
    }
    while (j < right.length) {
      merged.push(right[j++]);
    }
    return this.fromSorted(merged);
  }

  /** O(n + m) merge (plus O(m log m) if `other` must be sorted first). */
  intersection(other: Iterable<E>): SortedArraySet<E> {
    const right = this.sortedItems(other);
    const left = this._items;
    const merged: E[] = [];
    let i = 0;
    let j = 0;
    while (i < left.length && j < right.length) {
      const order = this.compare(left[i], right[j]);
      if (order < 0) {
        i++;
      } else if (order > 0) {
        j++;
      } else {
        merged.push(left[i++]);
        j++;
      }
    }
    return this.fromSorted(merged);
  }

  /** O(n + m) merge (plus O(m log m) if `other` must be sorted first). */
  difference(other: Iterable<E>): SortedArraySet<E> {
    const right = this.sortedItems(other);
    const left = this._items;
    const merged: E[] = [];
    let i = 0;
    let j = 0;
    while (i < left.length && j < right.length) {
      const order = this.compare(left[i], right[j]);
      if (order < 0) {
        merged.push(left[i++]);
      } else if (order > 0) {
        j++;
      } else {
        i++;
        j++;
      }
    }
    while (i < left.length) {
      merged.push(left[i++]);
    }
    return this.fromSorted(merged);
  }

  /** O(n + m) merge (plus O(m log m) if `other` must be sorted first). */
  symmetricDifference(other: Iterable<E>): SortedArraySet<E> {
    const right = this.sortedItems(other);
    const left = this._items;
    const merged: E[] = [];
    let i = 0;
    let j = 0;
    while (i < left.length && j < right.length) {
      const order = this.compare(left[i], right[j]);
      if (order < 0) {
        merged.push(left[i++]);
      } else if (order > 0) {
        merged.push(right[j++]);
      } else {
        i++;
        j++;
      }
    }
    while (i < left.length) {
      merged.push(left[i++]);
    }
    while (j < right.length) {
      merged.push(right[j++]);
    }
    return this.fromSorted(merged);
  }

  /**
   * O(n + m) merge scan, short-circuiting on the first missing element; O(1) when this set is
   * larger than `other`. Plus O(m log m) if `other` must be sorted first.
   */
  isSubsetOf(other: Iterable<E>): boolean {
    const right = this.sortedItems(other);
    const left = this._items;
    if (left.length > right.length) {
      return false;
    }
    let j = 0;
    for (let i = 0; i < left.length; i++) {
      while (j < right.length && this.compare(right[j], left[i]) < 0) {
        j++;
      }
      if (j === right.length || this.compare(right[j], left[i]) !== 0) {
        return false;
      }
      j++;
    }
    return true;
  }

  /**
   * O(m log n): one binary search per element of `other`, short-circuiting, no allocation. Cheaper
   * than isSubsetOf when `other` is small and unsorted.
   */
  isSupersetOf(other: Iterable<E>): boolean {
    for (const value of other) {
      if (!this.has(value)) {
        return false;
      }
    }
    return true;
  }

  /** O(n) pairwise comparison after a size check; plus O(m log m) if `other` must be sorted. */
  equals(other: Iterable<E>): boolean {
    const right = this.sortedItems(other);
    if (right.length !== this._items.length) {
      return false;
    }
    for (let i = 0; i < right.length; i++) {
      if (this.compare(this._items[i], right[i]) !== 0) {
        return false;
      }
    }
    return true;
  }

  /** O(1): drops the backing array. */
  clear(): void {
    this._items = [];
    this._size = 0;
    this.touch();
  }

  /** O(n) copy in ascending order; the internal array is never exposed. */
  toArray(): E[] {
    return this._items.slice();
  }

  /**
   * O(n) up front to copy the snapshot, then O(1) per step; throws ConcurrentModificationError if
   * the set is mutated during iteration.
   */
  [Symbol.iterator](): IterableIterator<E> {
    return this.snapshotIterator(this.toArray());
  }

  /** O(n): checks the length, that no element is undefined, and strict ascending order. */
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

  /** O(n). */
  serialize(): string {
    return serializeValues("SortedArraySet", this.toArray());
  }

  /**
   * O(n log n) when the payload is already sorted (every add appends); up to O(n^2) element
   * shifting for an unsorted payload.
   */
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

  /**
   * O(1) when `other` is a SortedArraySet with this comparator (its internal array is read
   * directly, never mutated); otherwise O(m log m): copies, sorts, and dedupes `other`.
   */
  private sortedItems(other: Iterable<E>): E[] {
    if (other instanceof SortedArraySet && other.compare === this.compare) {
      return other._items;
    }
    const values = [...other];
    for (const value of values) {
      assertDefined(value, "value");
    }
    values.sort(this.compare);
    const unique: E[] = [];
    for (const value of values) {
      if (unique.length === 0 || this.compare(unique[unique.length - 1], value) !== 0) {
        unique.push(value);
      }
    }
    return unique;
  }

  /** O(1): adopts an already sorted, deduplicated array as a new set. */
  private fromSorted(items: E[]): SortedArraySet<E> {
    const result = this.cloneEmpty();
    result._items = items;
    result._size = items.length;
    return result;
  }

  /**
   * O(log n): index of the first element not less than `value`; the single search primitive behind
   * add, delete, has, and indexOf.
   */
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
