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

export class IntervalSet
  extends ContainerBase<Interval>
  implements SetLike<Interval> {
  private _intervals: Array<[number, number]> = [];

  add(value: Interval): boolean {
    return this.addInterval(value[0], value[1]);
  }

  delete(value: Interval): boolean {
    return this.removeInterval(value[0], value[1]);
  }

  has(value: Interval): boolean {
    return this.containsInterval(value[0], value[1]);
  }

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

  containsInterval(lo: number, hi: number): boolean {
    assertInterval(lo, hi);
    const index = this.lowerBound(lo);
    let candidate = index;
    if (candidate >= this._intervals.length || this._intervals[candidate][0] > lo) {
      candidate--;
    }
    return candidate >= 0 && this._intervals[candidate][1] >= hi;
  }

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

  intervals(): IterableIterator<Interval> {
    return this.snapshotIterator(this.toArray());
  }

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

  symmetricDifference(other: Iterable<Interval>): IntervalSet {
    const lookup = this.buildLookup(other);
    const union = this.union(lookup);
    const intersection = this.intersection(lookup);
    return union.difference(intersection);
  }

  isSubsetOf(other: Iterable<Interval>): boolean {
    const lookup = this.buildLookup(other);
    for (const interval of this) {
      if (!lookup.containsInterval(interval[0], interval[1])) {
        return false;
      }
    }
    return true;
  }

  isSupersetOf(other: Iterable<Interval>): boolean {
    for (const interval of other) {
      if (!this.containsInterval(interval[0], interval[1])) {
        return false;
      }
    }
    return true;
  }

  equals(other: Iterable<Interval>): boolean {
    const lookup = this.buildLookup(other);
    return this._size === lookup.size && this.isSubsetOf(lookup) && lookup.isSubsetOf(this);
  }

  clear(): void {
    this._intervals = [];
    this._size = 0;
    this.touch();
  }

  toArray(): Interval[] {
    return this._intervals.map(([lo, hi]) => [lo, hi] as const);
  }

  [Symbol.iterator](): IterableIterator<Interval> {
    return this.snapshotIterator(this.toArray());
  }

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

  serialize(): string {
    return serializeRecord("IntervalSet", { values: this.toArray() });
  }

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
