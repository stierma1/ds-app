import {
  ContainerBase,
  parseSerialized,
  readArray,
  serializeRecord,
} from "../core/index.ts";
import type { SetLike } from "../core/index.ts";

export type Interval = readonly [number, number];

function assertInterval(lo: number, hi: number): void {
  if (!Number.isInteger(lo) || !Number.isInteger(hi)) {
    throw new TypeError("interval endpoints must be integers");
  }
  if (lo > hi) {
    throw new RangeError("interval start must not exceed its end");
  }
}

/**
 * Set of integers represented as a sorted JS array of disjoint, non-adjacent closed intervals [lo,
 * hi]; n below is the number of stored intervals, and `size` counts intervals, not covered
 * integers.
 *
 * Fast: O(log n) containsInterval/hasValue by binary search on interval starts, and a run of
 * consecutive integers costs one entry regardless of its length (versus one bit per value in BitSet
 * or one slot per value in SortedArraySet). Slow: addInterval binary-searches the insertion point
 * and merges the k overlapping or touching intervals in O(k), but the splice shifts O(n) entries;
 * removeInterval rebuilds the entire array in O(n) even when nothing overlaps. The binary set
 * operations are built on those primitives and are quadratic in the worst case (see each method).
 * `has`/`add`/`delete` take an interval and test coverage, not exact-interval identity: has([2, 3])
 * is true whenever one stored interval contains 2..3.
 *
 * Iteration (and intervals()) yields a fresh snapshot of [lo, hi] pairs in ascending order and
 * throws ConcurrentModificationError if the set is mutated mid-iteration.
 */
export class IntervalSet
  extends ContainerBase<Interval>
  implements SetLike<Interval> {
  private _intervals: Array<[number, number]> = [];

  /** Alias for addInterval: O(log n + k) plus an O(n) splice. */
  add(value: Interval): boolean {
    return this.addInterval(value[0], value[1]);
  }

  /** Alias for removeInterval: O(n) rebuild. */
  delete(value: Interval): boolean {
    return this.removeInterval(value[0], value[1]);
  }

  /** Alias for containsInterval: O(log n). True when a single stored interval covers [lo, hi]. */
  has(value: Interval): boolean {
    return this.containsInterval(value[0], value[1]);
  }

  /**
   * O(log n) to locate, O(k) to absorb the k overlapping or adjacent intervals, plus O(n) shifting
   * from the splice. Returns false after only O(log n), with no mutation, when the range is already
   * covered. Touching intervals ([1, 2] and [3, 4]) are coalesced.
   */
  addInterval(lo: number, hi: number): boolean {
    assertInterval(lo, hi);
    if (this.containsInterval(lo, hi)) {
      return false;
    }
    let start = this.lowerBound(lo);
    if (start > 0 && this._intervals[start - 1][1] + 1 >= lo) {
      start--;
    }
    let end = start;
    let mergedLo = lo;
    let mergedHi = hi;
    while (end < this._intervals.length && this._intervals[end][0] <= hi + 1) {
      mergedLo = Math.min(mergedLo, this._intervals[end][0]);
      mergedHi = Math.max(mergedHi, this._intervals[end][1]);
      end++;
    }
    this._intervals.splice(start, end - start, [mergedLo, mergedHi]);
    this._size = this._intervals.length;
    this.touch();
    return true;
  }

  /**
   * O(n): rebuilds the whole interval array, splitting at most two intervals, even when the range
   * touches nothing. Returns false when nothing changed.
   */
  removeInterval(lo: number, hi: number): boolean {
    assertInterval(lo, hi);
    const result: Array<[number, number]> = [];
    let changed = false;
    for (const [start, end] of this._intervals) {
      if (end < lo || start > hi) {
        result.push([start, end]);
        continue;
      }
      changed = true;
      if (start < lo) {
        result.push([start, lo - 1]);
      }
      if (end > hi) {
        result.push([hi + 1, end]);
      }
    }
    if (!changed) {
      return false;
    }
    this._intervals = result;
    this._size = result.length;
    this.touch();
    return true;
  }

  /** O(log n): binary search for the interval starting at or before `lo`, then one bound check. */
  containsInterval(lo: number, hi: number): boolean {
    assertInterval(lo, hi);
    const index = this.lowerBound(lo);
    let candidate = index;
    if (candidate >= this._intervals.length || this._intervals[candidate][0] > lo) {
      candidate--;
    }
    return candidate >= 0 && this._intervals[candidate][1] >= hi;
  }

  /** O(log n): the same search as containsInterval for a single integer. */
  hasValue(value: number): boolean {
    if (!Number.isInteger(value)) {
      throw new TypeError("value must be an integer");
    }
    const index = this.lowerBound(value);
    let candidate = index;
    if (candidate >= this._intervals.length || this._intervals[candidate][0] > value) {
      candidate--;
    }
    return candidate >= 0 && this._intervals[candidate][1] >= value;
  }

  /** O(n) snapshot copy up front; identical to iterating the set directly. */
  intervals(): IterableIterator<Interval> {
    return this.snapshotIterator(this.toArray());
  }

  /**
   * O(n log n) to re-add this set's intervals in order, plus O(n + m) per interval of `other` (each
   * may splice the growing array and merge neighbors), so O(m(n + m)) worst case.
   */
  union(other: Iterable<Interval>): IntervalSet {
    const result = this.cloneEmpty();
    for (const interval of this) {
      result.add(interval);
    }
    for (const interval of other) {
      result.add(interval);
    }
    return result;
  }

  /**
   * O(m^2) worst case to normalize `other` into a sorted lookup, then a linear two-pointer sweep
   * over both interval lists, O(n + m), with results appended in order.
   */
  intersection(other: Iterable<Interval>): IntervalSet {
    const lookup = this.buildLookup(other);
    const result = this.cloneEmpty();
    let left = 0;
    let right = 0;
    while (left < this._intervals.length && right < lookup._intervals.length) {
      const [a, b] = this._intervals[left];
      const [c, d] = lookup._intervals[right];
      const lo = Math.max(a, c);
      const hi = Math.min(b, d);
      if (lo <= hi) {
        result.addInterval(lo, hi);
      }
      if (b < d) {
        left++;
      } else {
        right++;
      }
    }
    return result;
  }

  /**
   * O(n log n) to copy this set, then one O(n) removeInterval rebuild per interval of `other`: O(n
   * log n + m n).
   */
  difference(other: Iterable<Interval>): IntervalSet {
    const result = this.cloneEmpty();
    for (const interval of this) {
      result.add(interval);
    }
    for (const interval of other) {
      result.removeInterval(interval[0], interval[1]);
    }
    return result;
  }

  /**
   * Composed as union(other).difference(intersection(other)), so it pays for all three and
   * allocates several intermediate sets: O((n + m)^2) worst case.
   */
  symmetricDifference(other: Iterable<Interval>): IntervalSet {
    const lookup = this.buildLookup(other);
    const union = this.union(lookup);
    const intersection = this.intersection(lookup);
    return union.difference(intersection);
  }

  /**
   * O(m^2) worst case to normalize `other` into a lookup, then one O(log m) coverage probe per
   * interval of this set.
   */
  isSubsetOf(other: Iterable<Interval>): boolean {
    const lookup = this.buildLookup(other);
    for (const interval of this) {
      if (!lookup.containsInterval(interval[0], interval[1])) {
        return false;
      }
    }
    return true;
  }

  /**
   * O(m log n): one coverage probe per interval of `other`, short-circuiting, no allocation. The
   * cheapest comparison method.
   */
  isSupersetOf(other: Iterable<Interval>): boolean {
    for (const interval of other) {
      if (!this.containsInterval(interval[0], interval[1])) {
        return false;
      }
    }
    return true;
  }

  /**
   * O(m^2) worst case to normalize `other`, then an interval-count check and two subset passes, O(n
   * log m + m log n).
   */
  equals(other: Iterable<Interval>): boolean {
    const lookup = this.buildLookup(other);
    return this._size === lookup.size && this.isSubsetOf(lookup) && lookup.isSubsetOf(this);
  }

  /** O(1). */
  clear(): void {
    this._intervals = [];
    this._size = 0;
    this.touch();
  }

  /** O(n): copies every pair into a fresh readonly tuple, ascending. */
  toArray(): Interval[] {
    return this._intervals.map(([lo, hi]) => [lo, hi] as const);
  }

  /**
   * O(n) snapshot up front via toArray, then O(1) per step; throws ConcurrentModificationError if
   * the set is mutated during iteration.
   */
  [Symbol.iterator](): IterableIterator<Interval> {
    return this.snapshotIterator(this.toArray());
  }

  /** O(n): checks ordering, orientation, and that no two neighbors overlap or touch. */
  validate(): true | string {
    if (this._intervals.length !== this._size) {
      return `size ${this._size} does not match interval count ${this._intervals.length}`;
    }
    for (let index = 0; index < this._intervals.length; index++) {
      const [lo, hi] = this._intervals[index];
      if (!Number.isInteger(lo) || !Number.isInteger(hi)) {
        return `interval at index ${index} has non-integer endpoints`;
      }
      if (lo > hi) {
        return `interval at index ${index} is inverted`;
      }
      if (index > 0) {
        const [previousLo, previousHi] = this._intervals[index - 1];
        if (previousLo > lo) {
          return `intervals at indices ${index - 1} and ${index} are out of order`;
        }
        if (previousHi + 1 >= lo) {
          return `intervals at indices ${index - 1} and ${index} overlap or touch`;
        }
      }
    }
    return true;
  }

  /** O(n). */
  serialize(): string {
    return serializeRecord("IntervalSet", { values: this.toArray() });
  }

  /**
   * O(n log n) for a sorted, normalized payload (each addInterval appends); O(n^2) worst case for
   * an unsorted one.
   */
  static deserialize(json: unknown): IntervalSet {
    const record = parseSerialized(json, "IntervalSet");
    const raw = readArray(record, "values");
    const set = new IntervalSet();
    for (let index = 0; index < raw.length; index++) {
      const interval = raw[index];
      if (!Array.isArray(interval) || interval.length !== 2) {
        throw new TypeError(`values[${index}] must be a [lo, hi] pair`);
      }
      const lo = interval[0];
      const hi = interval[1];
      if (typeof lo !== "number" || typeof hi !== "number") {
        throw new TypeError(`values[${index}] endpoints must be numbers`);
      }
      set.addInterval(lo, hi);
    }
    if (set.validate() !== true) {
      throw new TypeError(`Invalid IntervalSet payload: ${set.validate()}`);
    }
    return set;
  }

  private cloneEmpty(): IntervalSet {
    return new IntervalSet();
  }

  /**
   * Design note: `other` is normalized into a fresh IntervalSet by repeated addInterval, O(m) each
   * in the worst case, which is why the comparison and intersection methods are quadratic in m.
   */
  private buildLookup(other: Iterable<Interval>): IntervalSet {
    const lookup = this.cloneEmpty();
    for (const interval of other) {
      lookup.add(interval);
    }
    return lookup;
  }

  private lowerBound(lo: number): number {
    let low = 0;
    let high = this._intervals.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this._intervals[middle][0] < lo) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    return low;
  }
}
