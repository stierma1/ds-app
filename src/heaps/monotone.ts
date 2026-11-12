import {
  assertDefined,
  assertInteger,
  ContainerBase,
  readInteger,
} from "../core/index.ts";
import {
  parseEntries,
  restoreFromPayload,
  serializeEntries,
} from "./serialization.ts";
import type { MonotonePriorityQueue } from "./types.ts";

interface MonotoneEntry<T> {
  value: T;
  key: number;
  cancelled: boolean;
}

function bitLength(value: number): number {
  let remaining = Math.floor(value);
  let bits = 0;
  while (remaining > 0) {
    bits++;
    remaining = Math.floor(remaining / 2);
  }
  return bits;
}

/**
 * O(1): number of bits in `a XOR b` for non-negative safe integers, i.e. one plus the index of the
 * highest bit where they differ (0 when equal). Splits into 32-bit halves so keys up to
 * Number.MAX_SAFE_INTEGER work; the plain `^` operator truncates to 32 bits.
 */
function differingBitLength(a: number, b: number): number {
  if (a === b) {
    return 0;
  }
  const high = Math.floor(a / 0x100000000) ^ Math.floor(b / 0x100000000);
  if (high !== 0) {
    return 64 - Math.clz32(high);
  }
  return 32 - Math.clz32((a >>> 0) ^ (b >>> 0));
}

function readMaxKey(maxKey: number): number {
  assertInteger(maxKey, "maxKey");
  if (maxKey < 0 || maxKey > Number.MAX_SAFE_INTEGER) {
    throw new RangeError("maxKey must be in [0, Number.MAX_SAFE_INTEGER]");
  }
  return maxKey;
}

/**
 * Dial's bucket queue for monotone integer keys. One bucket per key in `[0, maxKey]` and a cursor
 * that only moves forward give O(1) push, pop, and decreaseKey over a Dijkstra-style sequence; the
 * cost is O(maxKey) space and an O(C) worst-case scan when the next non-empty bucket is far away.
 *
 * Values are indexed by identity for decreaseKey, which cancels the old entry and inserts a new one
 * in O(1). Duplicate values are allowed, but decreaseKey targets the most recently pushed one.
 * Iteration is in ascending bucket order, not necessarily sorted within a bucket.
 */
export class BucketQueue<T> extends ContainerBase<T> implements MonotonePriorityQueue<T> {
  readonly key: (value: T) => number;
  readonly maxKey: number;
  private _buckets: Array<Array<MonotoneEntry<T>>>;
  /** Indices of buckets whose array is non-empty (live or cancelled entries), so clear is O(n). */
  private _nonEmpty = new Set<number>();
  private _active = new Map<T, MonotoneEntry<T>>();
  private _lastPopped = -1;
  private _cursor: number;

  constructor(key: (value: T) => number, maxKey: number) {
    super();
    if (typeof key !== "function") {
      throw new TypeError("key must be a function");
    }
    this.key = key;
    this.maxKey = readMaxKey(maxKey);
    this._buckets = Array.from({ length: this.maxKey + 1 }, () => []);
    this._cursor = this.maxKey + 1;
  }

  /** O(1): appends to the bucket for key(value). Throws RangeError below the last popped key. */
  push(value: T): void {
    assertDefined(value);
    const key = this.readKey(value);
    if (key < this._lastPopped) {
      throw new RangeError("key is below the last popped key");
    }
    this.insertEntry(value, key);
    this.touch();
  }

  /** O(1) amortized, O(maxKey) worst: advances the cursor to the next non-empty bucket. */
  pop(): T | undefined {
    this.advanceCursor();
    if (this._cursor > this.maxKey) {
      return undefined;
    }
    const entry = this.takeFromBucket(this._cursor);
    if (entry === undefined) {
      return undefined;
    }
    if (this._active.get(entry.value) === entry) {
      this._active.delete(entry.value);
    }
    this._size--;
    this._lastPopped = entry.key;
    this._cursor = entry.key;
    this.advanceCursor();
    this.touch();
    return entry.value;
  }

  /** O(1) amortized: the value at the cursor bucket. */
  peek(): T | undefined {
    this.advanceCursor();
    if (this._cursor > this.maxKey) {
      return undefined;
    }
    this.trimCancelled(this._cursor);
    const bucket = this._buckets[this._cursor];
    return bucket.length === 0 ? undefined : bucket[bucket.length - 1].value;
  }

  /**
   * O(1): cancels the current entry and inserts a replacement at the smaller key. Returns false
   * when the value is absent, the key would increase, or the key is below the last popped key.
   */
  decreaseKey(value: T, newKey: number): boolean {
    assertDefined(value);
    this.validateKey(newKey);
    if (newKey < this._lastPopped) {
      throw new RangeError("key is below the last popped key");
    }
    const entry = this._active.get(value);
    if (entry === undefined || newKey > entry.key) {
      return false;
    }
    if (newKey === entry.key) {
      return true;
    }
    entry.cancelled = true;
    this._size--;
    this.insertEntry(value, newKey);
    this.touch();
    return true;
  }

  /** O(n): replaces the contents; each value's key comes from key(value). */
  build(values: Iterable<T>): void {
    this.reset();
    for (const value of values) {
      this.push(value);
    }
    this.touch();
  }

  /** O(n + maxKey): values in ascending bucket order, skipping cancelled entries. */
  override toArray(): T[] {
    const values: T[] = [];
    for (const bucket of this._buckets) {
      for (const entry of bucket) {
        if (!entry.cancelled) {
          values.push(entry.value);
        }
      }
    }
    return values;
  }

  /** O(n + maxKey) up front: snapshot iterator in bucket order. */
  override [Symbol.iterator](): IterableIterator<T> {
    return this.snapshotIterator(this.toArray());
  }

  /** O(n): empties only the buckets that hold entries; the bucket array itself is kept. */
  override clear(): void {
    this.reset();
    this.touch();
  }

  /** O(n + maxKey): validates bucket placement, counts, and monotone bounds. */
  override validate(): true | string {
    if (this._buckets.length !== this.maxKey + 1) {
      return "bucket count does not match maxKey";
    }
    let count = 0;
    const seen = new Set<MonotoneEntry<T>>();
    for (let key = 0; key <= this.maxKey; key++) {
      const bucket = this._buckets[key];
      if (!Array.isArray(bucket)) {
        return `bucket ${key} is not an array`;
      }
      if ((bucket.length > 0) !== this._nonEmpty.has(key)) {
        return `bucket ${key} is not tracked as non-empty`;
      }
      for (const entry of bucket) {
        if (entry.cancelled) {
          continue;
        }
        if (entry.value === undefined) {
          return `bucket ${key} contains an undefined value`;
        }
        if (entry.key !== key) {
          return `entry in bucket ${key} has key ${entry.key}`;
        }
        if (key < this._lastPopped) {
          return "active entry is below the last popped key";
        }
        count++;
        seen.add(entry);
      }
    }
    if (count !== this._size) {
      return `size ${this._size} does not match active entry count ${count}`;
    }
    for (const [, entry] of this._active) {
      if (entry.cancelled || !seen.has(entry)) {
        return "index points to a cancelled or missing entry";
      }
    }
    if (this._cursor < 0 || this._cursor > this.maxKey + 1) {
      return "cursor is out of range";
    }
    let next = 0;
    while (next <= this.maxKey && !this.hasActive(this._buckets[next])) {
      next++;
    }
    if (this._cursor !== next) {
      return `cursor ${this._cursor} does not match next active bucket ${next}`;
    }
    return true;
  }

  /** O(n + maxKey): serializes [key, value] pairs in bucket order. */
  override serialize(): string {
    const entries: Array<[number, T]> = [];
    for (const bucket of this._buckets) {
      for (const entry of bucket) {
        if (!entry.cancelled) {
          entries.push([entry.key, entry.value]);
        }
      }
    }
    return serializeEntries("BucketQueue", entries, {
      maxKey: this.maxKey,
      lastPopped: this._lastPopped,
    });
  }

  /**
   * O(n + maxKey): rebuilds the buckets from explicit keys and validates the payload. Malformed
   * payloads, including out-of-range keys, maxKey, or lastPopped, throw TypeError.
   */
  static deserialize<T>(
    json: unknown,
    key: (value: T) => number,
  ): BucketQueue<T> {
    const { record, entries } = parseEntries(json, "BucketQueue");
    const maxKey = readInteger(record, "maxKey");
    const lastPopped = readInteger(record, "lastPopped");
    return restoreFromPayload("BucketQueue", () => {
      const queue = new BucketQueue<T>(key, maxKey);
      queue.restore(entries as Array<[number, T]>, lastPopped);
      const valid = queue.validate();
      if (valid !== true) {
        throw new TypeError(`Invalid BucketQueue payload: ${valid}`);
      }
      return queue;
    });
  }

  /** O(non-empty buckets): empties the used buckets in place and resets the cursor. */
  private reset(): void {
    for (const index of this._nonEmpty) {
      this._buckets[index] = [];
    }
    this._nonEmpty.clear();
    this._active = new Map();
    this._size = 0;
    this._lastPopped = -1;
    this._cursor = this.maxKey + 1;
  }

  private readKey(value: T): number {
    const key = this.key(value);
    this.validateKey(key);
    return key;
  }

  private validateKey(key: number): void {
    assertInteger(key, "key");
    if (key < 0 || key > this.maxKey) {
      throw new RangeError(`key must be in [0, ${this.maxKey}]`);
    }
  }

  private insertEntry(value: T, key: number): void {
    const entry: MonotoneEntry<T> = { value, key, cancelled: false };
    const bucket = this._buckets[key];
    if (bucket.length === 0) {
      this._nonEmpty.add(key);
    }
    bucket.push(entry);
    this._active.set(value, entry);
    this._size++;
    if (key < this._cursor) {
      this._cursor = key;
    }
  }

  private advanceCursor(): void {
    while (this._cursor <= this.maxKey) {
      this.trimCancelled(this._cursor);
      if (this._buckets[this._cursor].length > 0) {
        return;
      }
      this._cursor++;
    }
  }

  /** Amortized O(1): drops cancelled entries from the top of bucket `index`. */
  private trimCancelled(index: number): void {
    const bucket = this._buckets[index];
    while (bucket.length > 0 && bucket[bucket.length - 1].cancelled) {
      bucket.pop();
    }
    if (bucket.length === 0) {
      this._nonEmpty.delete(index);
    }
  }

  private takeFromBucket(index: number): MonotoneEntry<T> | undefined {
    this.trimCancelled(index);
    const bucket = this._buckets[index];
    const entry = bucket.pop();
    if (bucket.length === 0) {
      this._nonEmpty.delete(index);
    }
    return entry;
  }

  private hasActive(bucket: Array<MonotoneEntry<T>>): boolean {
    for (const entry of bucket) {
      if (!entry.cancelled) {
        return true;
      }
    }
    return false;
  }

  private restore(entries: Array<[number, T]>, lastPopped: number): void {
    assertInteger(lastPopped, "lastPopped");
    if (lastPopped < -1 || lastPopped > this.maxKey) {
      throw new RangeError("lastPopped is out of range");
    }
    this.reset();
    this._lastPopped = lastPopped;
    for (const [key, value] of entries) {
      this.validateKey(key);
      assertDefined(value);
      if (key < lastPopped) {
        throw new TypeError("serialized entry is below lastPopped");
      }
      this.insertEntry(value, key);
    }
  }
}

interface RadixEntry<T> {
  value: T;
  key: number;
  /** Bucket that currently holds the entry and its position there (swap-removal is O(1)). */
  bucket: number;
  index: number;
}

/**
 * Radix heap for monotone integer keys in `[0, maxKey]` (maxKey up to Number.MAX_SAFE_INTEGER).
 * Buckets are indexed by the bit length of `key XOR base`, where `base` is the last popped key, so
 * bucket ranges double and every key in a lower bucket is smaller than every key in a higher one. A
 * pop redistributes only the first non-empty bucket around its minimum; each element moves down
 * O(log C) times over its life, giving O(log C) amortized pop and O(1) push.
 *
 * `peek` is O(1): the heap keeps a pointer to a minimum entry, updated on push and decreaseKey in
 * O(1) and recomputed by pop from the first non-empty bucket, whose minimum is tracked per bucket.
 * decreaseKey removes the old entry (O(1) swap-removal) and inserts at the smaller key. Values are
 * indexed by identity; duplicates are allowed but decreaseKey targets the most recently pushed one.
 * Iteration is in bucket order, not sorted order.
 */
export class RadixHeap<T> extends ContainerBase<T> implements MonotonePriorityQueue<T> {
  readonly key: (value: T) => number;
  readonly maxKey: number;
  private _buckets: Array<Array<RadixEntry<T>>> = [];
  /** Minimum entry of each bucket, or null when empty; meaningless while `_stale[i]`. */
  private _bucketMin: Array<RadixEntry<T> | null> = [];
  /** True when bucket i's tracked minimum was removed and has not been recomputed yet. */
  private _stale: boolean[] = [];
  private _active = new Map<T, RadixEntry<T>>();
  private _min: RadixEntry<T> | null = null;
  private _base = 0;
  private _lastPopped = -1;

  constructor(key: (value: T) => number, maxKey: number) {
    super();
    if (typeof key !== "function") {
      throw new TypeError("key must be a function");
    }
    this.key = key;
    this.maxKey = readMaxKey(maxKey);
    this.reset();
  }

  /** O(1): inserts into the bucket selected by its highest differing bit. */
  push(value: T): void {
    assertDefined(value);
    const key = this.readKey(value);
    if (key < this._lastPopped) {
      throw new RangeError("key is below the last popped key");
    }
    this.insertEntry(value, key);
    this.touch();
  }

  /**
   * O(log C) amortized: removes the tracked minimum, redistributing its bucket around it first when
   * it is not already in bucket 0, then finds the next minimum among the O(log C) bucket minima.
   */
  pop(): T | undefined {
    const entry = this._min;
    if (entry === null) {
      return undefined;
    }
    if (entry.bucket !== 0) {
      this.redistribute(entry.bucket, entry.key);
    }
    this.removeEntry(entry);
    if (this._active.get(entry.value) === entry) {
      this._active.delete(entry.value);
    }
    this._lastPopped = entry.key;
    this._min = this.findMinimum();
    this.touch();
    return entry.value;
  }

  /** O(1): the tracked minimum. */
  peek(): T | undefined {
    return this._min === null ? undefined : this._min.value;
  }

  /**
   * O(1): removes the current entry and inserts a replacement at the smaller key. Returns false
   * when the value is absent or the key would increase; throws RangeError below the last popped key.
   */
  decreaseKey(value: T, newKey: number): boolean {
    assertDefined(value);
    this.validateKey(newKey);
    if (newKey < this._lastPopped) {
      throw new RangeError("key is below the last popped key");
    }
    const entry = this._active.get(value);
    if (entry === undefined || newKey > entry.key) {
      return false;
    }
    if (newKey === entry.key) {
      return true;
    }
    this.removeEntry(entry);
    // The replacement key is smaller than the removed one, so if the removed entry was the minimum
    // the replacement becomes the new minimum inside insertEntry.
    this.insertEntry(value, newKey);
    this.touch();
    return true;
  }

  /** O(n + log C): replaces the contents; each value's key comes from key(value). */
  build(values: Iterable<T>): void {
    this.reset();
    for (const value of values) {
      this.push(value);
    }
    this.touch();
  }

  /** O(n + log C): values in bucket order. */
  override toArray(): T[] {
    const values: T[] = [];
    for (const bucket of this._buckets) {
      for (const entry of bucket) {
        values.push(entry.value);
      }
    }
    return values;
  }

  /** O(n + log C) up front: snapshot iterator in bucket order. */
  override [Symbol.iterator](): IterableIterator<T> {
    return this.snapshotIterator(this.toArray());
  }

  /** O(log C): drops every bucket and index entry. */
  override clear(): void {
    this.reset();
    this.touch();
  }

  /** O(n + log C): validates bucket indices, keys, counts, minima, and the monotone bounds. */
  override validate(): true | string {
    if (this._buckets.length !== bitLength(this.maxKey) + 1) {
      return "bucket count does not match maxKey";
    }
    if (this._base < 0 || this._base > this.maxKey) {
      return "base is out of range";
    }
    if (this._lastPopped < -1 || this._lastPopped > this._base) {
      return "lastPopped is out of range";
    }
    let count = 0;
    let minimum: RadixEntry<T> | null = null;
    const seen = new Set<RadixEntry<T>>();
    for (let index = 0; index < this._buckets.length; index++) {
      const bucket = this._buckets[index];
      let bucketMinimum: RadixEntry<T> | null = null;
      for (let position = 0; position < bucket.length; position++) {
        const entry = bucket[position];
        if (entry.value === undefined) {
          return "bucket contains an undefined value";
        }
        if (entry.bucket !== index || entry.index !== position) {
          return "entry position bookkeeping is inconsistent";
        }
        if (!Number.isSafeInteger(entry.key) || entry.key < 0 || entry.key > this.maxKey) {
          return `entry key ${entry.key} is out of range`;
        }
        if (entry.key < this._lastPopped || entry.key < this._base) {
          return "active entry is below the last popped key";
        }
        const expected = this.bucketIndex(entry.key);
        if (expected !== index) {
          return `entry with key ${entry.key} is in bucket ${index}, expected ${expected}`;
        }
        if (bucketMinimum === null || entry.key < bucketMinimum.key) {
          bucketMinimum = entry;
        }
        count++;
        seen.add(entry);
      }
      const tracked = this._bucketMin[index];
      if (bucketMinimum === null) {
        if (tracked !== null || this._stale[index]) {
          return `empty bucket ${index} still tracks a minimum`;
        }
      } else if (!this._stale[index] && (tracked === null || tracked.bucket !== index || tracked.key !== bucketMinimum.key)) {
        return `bucket ${index} tracks the wrong minimum`;
      }
      if (minimum === null && bucketMinimum !== null) {
        minimum = bucketMinimum;
      }
    }
    if (count !== this._size) {
      return `size ${this._size} does not match entry count ${count}`;
    }
    for (const entry of this._active.values()) {
      if (!seen.has(entry)) {
        return "index points to a missing entry";
      }
    }
    if (minimum === null) {
      if (this._min !== null) {
        return "empty heap still has a minimum";
      }
    } else if (this._min === null || !seen.has(this._min) || this._min.key !== minimum.key) {
      return "minimum pointer is not a minimum entry";
    }
    return true;
  }

  /** O(n + log C): serializes [key, value] pairs in bucket order. */
  override serialize(): string {
    const entries: Array<[number, T]> = [];
    for (const bucket of this._buckets) {
      for (const entry of bucket) {
        entries.push([entry.key, entry.value]);
      }
    }
    return serializeEntries("RadixHeap", entries, {
      maxKey: this.maxKey,
      base: this._base,
      lastPopped: this._lastPopped,
    });
  }

  /**
   * O(n + log C): rebuilds from explicit keys and validates the payload. Malformed payloads,
   * including an out-of-range maxKey, base, lastPopped, or key, throw TypeError.
   */
  static deserialize<T>(
    json: unknown,
    key: (value: T) => number,
  ): RadixHeap<T> {
    const { record, entries } = parseEntries(json, "RadixHeap");
    const maxKey = readInteger(record, "maxKey");
    const base = readInteger(record, "base");
    const lastPopped = readInteger(record, "lastPopped");
    return restoreFromPayload("RadixHeap", () => {
      const queue = new RadixHeap<T>(key, maxKey);
      queue.restore(entries as Array<[number, T]>, base, lastPopped);
      const valid = queue.validate();
      if (valid !== true) {
        throw new TypeError(`Invalid RadixHeap payload: ${valid}`);
      }
      return queue;
    });
  }

  private reset(): void {
    const count = bitLength(this.maxKey) + 1;
    this._buckets = Array.from({ length: count }, () => []);
    this._bucketMin = new Array(count).fill(null);
    this._stale = new Array(count).fill(false);
    this._active = new Map();
    this._min = null;
    this._size = 0;
    this._base = 0;
    this._lastPopped = -1;
  }

  private readKey(value: T): number {
    const key = this.key(value);
    this.validateKey(key);
    return key;
  }

  private validateKey(key: number): void {
    assertInteger(key, "key");
    if (key < 0 || key > this.maxKey) {
      throw new RangeError(`key must be in [0, ${this.maxKey}]`);
    }
  }

  private bucketIndex(key: number): number {
    return differingBitLength(key, this._base);
  }

  /** O(1): appends to its bucket and updates the bucket and global minima. */
  private insertEntry(value: T, key: number): void {
    const bucketIndex = this.bucketIndex(key);
    const bucket = this._buckets[bucketIndex];
    const entry: RadixEntry<T> = { value, key, bucket: bucketIndex, index: bucket.length };
    bucket.push(entry);
    this.noteBucketMinimum(entry);
    this._active.set(value, entry);
    this._size++;
    if (this._min === null || key < this._min.key) {
      this._min = entry;
    }
  }

  /** O(1): a smaller (or, on a stale bucket, equal-to-the-lower-bound) key becomes the minimum. */
  private noteBucketMinimum(entry: RadixEntry<T>): void {
    const index = entry.bucket;
    const current = this._bucketMin[index];
    if (
      current === null ||
      entry.key < current.key ||
      (this._stale[index] && (entry.key === current.key || this._buckets[index].length === 1))
    ) {
      // A stale minimum is still a lower bound on the bucket, so an entry at that key is exact.
      this._bucketMin[index] = entry;
      this._stale[index] = false;
    }
  }

  /** O(1): swap-removes `entry` from its bucket; the caller owns the global minimum pointer. */
  private removeEntry(entry: RadixEntry<T>): void {
    const index = entry.bucket;
    const bucket = this._buckets[index];
    const last = bucket.pop() as RadixEntry<T>;
    if (last !== entry) {
      bucket[entry.index] = last;
      last.index = entry.index;
    }
    this._size--;
    if (bucket.length === 0) {
      this._bucketMin[index] = null;
      this._stale[index] = false;
    } else if (this._bucketMin[index] === entry) {
      this._stale[index] = true;
    }
  }

  /**
   * O(size of the bucket), charged to the elements, which all move to lower buckets: makes `base`
   * the bucket's minimum key and re-buckets every entry relative to it. Only called on the first
   * non-empty bucket, so the lower buckets are empty and receive fresh minima.
   */
  private redistribute(index: number, minimumKey: number): void {
    const entries = this._buckets[index];
    this._buckets[index] = [];
    this._bucketMin[index] = null;
    this._stale[index] = false;
    this._base = minimumKey;
    for (const entry of entries) {
      const target = this.bucketIndex(entry.key);
      const bucket = this._buckets[target];
      entry.bucket = target;
      entry.index = bucket.length;
      bucket.push(entry);
      this.noteBucketMinimum(entry);
    }
  }

  /**
   * O(log C) to find the first non-empty bucket, plus a scan of that bucket only when its tracked
   * minimum was removed by decreaseKey since it was last computed.
   */
  private findMinimum(): RadixEntry<T> | null {
    for (let index = 0; index < this._buckets.length; index++) {
      const bucket = this._buckets[index];
      if (bucket.length === 0) {
        continue;
      }
      if (index === 0) {
        return bucket[bucket.length - 1];
      }
      if (this._stale[index]) {
        let minimum = bucket[0];
        for (const entry of bucket) {
          if (entry.key < minimum.key) {
            minimum = entry;
          }
        }
        this._bucketMin[index] = minimum;
        this._stale[index] = false;
      }
      return this._bucketMin[index];
    }
    return null;
  }

  private restore(
    entries: Array<[number, T]>,
    base: number,
    lastPopped: number,
  ): void {
    assertInteger(base, "base");
    assertInteger(lastPopped, "lastPopped");
    if (base < 0 || base > this.maxKey) {
      throw new RangeError("base is out of range");
    }
    if (lastPopped < -1 || lastPopped > base) {
      throw new RangeError("lastPopped is out of range");
    }
    this.reset();
    this._base = base;
    this._lastPopped = lastPopped;
    for (const [key, value] of entries) {
      this.validateKey(key);
      assertDefined(value);
      if (key < base || key < lastPopped) {
        throw new TypeError("serialized entry is below base or lastPopped");
      }
      this.insertEntry(value, key);
    }
  }
}
