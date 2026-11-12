import {
  assertDefined,
  assertInteger,
  ContainerBase,
  readInteger,
} from "../core/index.ts";
import {
  parseEntries,
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

function readMaxKey(maxKey: number): number {
  assertInteger(maxKey, "maxKey");
  if (maxKey < 0) {
    throw new RangeError("maxKey must be non-negative");
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
    const bucket = this._buckets[this._cursor];
    const entry = this.takeFromBucket(bucket);
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
    const bucket = this._buckets[this._cursor];
    this.trimCancelled(bucket);
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

  /** O(1): allocates fresh empty buckets. */
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

  /** O(n + maxKey): rebuilds the buckets from explicit keys and validates the payload. */
  static deserialize<T>(
    json: unknown,
    key: (value: T) => number,
  ): BucketQueue<T> {
    const { record, entries } = parseEntries(json, "BucketQueue");
    const maxKey = readInteger(record, "maxKey");
    const lastPopped = readInteger(record, "lastPopped");
    const queue = new BucketQueue<T>(key, maxKey);
    queue.restore(entries as Array<[number, T]>, lastPopped);
    if (queue.validate() !== true) {
      throw new TypeError(`Invalid BucketQueue payload: ${queue.validate()}`);
    }
    return queue;
  }

  private reset(): void {
    this._buckets = Array.from({ length: this.maxKey + 1 }, () => []);
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
    this._buckets[key].push(entry);
    this._active.set(value, entry);
    this._size++;
    if (key < this._cursor) {
      this._cursor = key;
    }
  }

  private advanceCursor(): void {
    while (this._cursor <= this.maxKey) {
      const bucket = this._buckets[this._cursor];
      this.trimCancelled(bucket);
      if (bucket.length > 0) {
        return;
      }
      this._cursor++;
    }
  }

  private trimCancelled(bucket: Array<MonotoneEntry<T>>): void {
    while (bucket.length > 0 && bucket[bucket.length - 1].cancelled) {
      bucket.pop();
    }
  }

  private takeFromBucket(bucket: Array<MonotoneEntry<T>>): MonotoneEntry<T> | undefined {
    this.trimCancelled(bucket);
    return bucket.length === 0 ? undefined : bucket.pop();
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
    this._cursor = this.maxKey + 1;
    for (const [key, value] of entries) {
      this.validateKey(key);
      assertDefined(value);
      if (key < lastPopped) {
        throw new TypeError("serialized entry is below lastPopped");
      }
      const entry: MonotoneEntry<T> = { value, key, cancelled: false };
      this._buckets[key].push(entry);
      this._active.set(value, entry);
      this._size++;
      if (key < this._cursor) {
        this._cursor = key;
      }
    }
  }
}

/**
 * Radix heap for monotone integer keys in `[0, maxKey]`. Buckets are indexed by the highest bit in
 * `key XOR lastPopped`, so a pop redistributes only the first non-empty bucket; each element moves
 * O(log C) times over its life, giving O(log C) amortized pop and O(1) push.
 *
 * `peek` caches the next minimum without restructuring, so repeated peeks are O(1). decreaseKey
 * cancels the old entry and inserts at the smaller key in O(1). Values are indexed by identity;
 * duplicates are allowed but decreaseKey targets the most recently pushed one. Iteration is in
 * bucket order, not sorted order.
 */
export class RadixHeap<T> extends ContainerBase<T> implements MonotonePriorityQueue<T> {
  readonly key: (value: T) => number;
  readonly maxKey: number;
  private _buckets: Array<Array<MonotoneEntry<T>>>;
  private _active = new Map<T, MonotoneEntry<T>>();
  private _base = 0;
  private _lastPopped = -1;
  private _peekCache: MonotoneEntry<T> | null | undefined = undefined;

  constructor(key: (value: T) => number, maxKey: number) {
    super();
    if (typeof key !== "function") {
      throw new TypeError("key must be a function");
    }
    this.key = key;
    this.maxKey = readMaxKey(maxKey);
    this._buckets = this.createBuckets();
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

  /** O(log C) amortized: redistributes the first non-empty bucket and removes its minimum. */
  pop(): T | undefined {
    this._peekCache = undefined;
    const entry = this.extractMinimum();
    if (entry === undefined) {
      return undefined;
    }
    if (this._active.get(entry.value) === entry) {
      this._active.delete(entry.value);
    }
    this._size--;
    this._base = entry.key;
    this._lastPopped = entry.key;
    this.touch();
    return entry.value;
  }

  /** O(1) amortized: cached minimum; the first call after a mutation scans the buckets. */
  peek(): T | undefined {
    if (this._peekCache === undefined) {
      this._peekCache = this.findMinimum();
    }
    return this._peekCache === null ? undefined : this._peekCache.value;
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
    this._peekCache = undefined;
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

  /** O(n + log C): values in bucket order, skipping cancelled entries. */
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

  /** O(n + log C) up front: snapshot iterator in bucket order. */
  override [Symbol.iterator](): IterableIterator<T> {
    return this.snapshotIterator(this.toArray());
  }

  /** O(1): drops every bucket and index entry. */
  override clear(): void {
    this.reset();
    this.touch();
  }

  /** O(n + log C): validates bucket indices, keys, counts, and the monotone bounds. */
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
    const seen = new Set<MonotoneEntry<T>>();
    for (let index = 0; index < this._buckets.length; index++) {
      const bucket = this._buckets[index];
      for (const entry of bucket) {
        if (entry.cancelled) {
          continue;
        }
        if (entry.value === undefined) {
          return "bucket contains an undefined value";
        }
        this.validateKey(entry.key);
        if (entry.key < this._lastPopped) {
          return "active entry is below the last popped key";
        }
        const expected = this.bucketIndex(entry.key);
        if (expected !== index) {
          return `entry with key ${entry.key} is in bucket ${index}, expected ${expected}`;
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
    return true;
  }

  /** O(n + log C): serializes [key, value] pairs in bucket order. */
  override serialize(): string {
    const entries: Array<[number, T]> = [];
    for (const bucket of this._buckets) {
      for (const entry of bucket) {
        if (!entry.cancelled) {
          entries.push([entry.key, entry.value]);
        }
      }
    }
    return serializeEntries("RadixHeap", entries, {
      maxKey: this.maxKey,
      base: this._base,
      lastPopped: this._lastPopped,
    });
  }

  /** O(n + log C): rebuilds from explicit keys and validates the payload. */
  static deserialize<T>(
    json: unknown,
    key: (value: T) => number,
  ): RadixHeap<T> {
    const { record, entries } = parseEntries(json, "RadixHeap");
    const maxKey = readInteger(record, "maxKey");
    const base = readInteger(record, "base");
    const lastPopped = readInteger(record, "lastPopped");
    const queue = new RadixHeap<T>(key, maxKey);
    queue.restore(entries as Array<[number, T]>, base, lastPopped);
    if (queue.validate() !== true) {
      throw new TypeError(`Invalid RadixHeap payload: ${queue.validate()}`);
    }
    return queue;
  }

  private createBuckets(): Array<Array<MonotoneEntry<T>>> {
    return Array.from({ length: bitLength(this.maxKey) + 1 }, () => []);
  }

  private reset(): void {
    this._buckets = this.createBuckets();
    this._active = new Map();
    this._size = 0;
    this._base = 0;
    this._lastPopped = -1;
    this._peekCache = undefined;
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
    return key === this._base ? 0 : bitLength(key ^ this._base);
  }

  private insertEntry(value: T, key: number): void {
    const entry: MonotoneEntry<T> = { value, key, cancelled: false };
    this._buckets[this.bucketIndex(key)].push(entry);
    this._active.set(value, entry);
    this._size++;
    this._peekCache = undefined;
  }

  private findMinimum(): MonotoneEntry<T> | null {
    let minimum: MonotoneEntry<T> | null = null;
    for (const bucket of this._buckets) {
      for (const entry of bucket) {
        if (!entry.cancelled && (minimum === null || entry.key < minimum.key)) {
          minimum = entry;
        }
      }
    }
    return minimum;
  }

  private extractMinimum(): MonotoneEntry<T> | undefined {
    const first = this._buckets[0];
    let candidate = this.takeActive(first);
    if (candidate !== undefined) {
      return candidate;
    }
    for (let index = 1; index < this._buckets.length; index++) {
      const bucket = this._buckets[index];
      const entries = bucket.filter((entry) => !entry.cancelled);
      if (entries.length === 0) {
        bucket.length = 0;
        continue;
      }
      let minimumKey = entries[0].key;
      for (const entry of entries) {
        if (entry.key < minimumKey) {
          minimumKey = entry.key;
        }
      }
      bucket.length = 0;
      this._base = minimumKey;
      for (const entry of entries) {
        this._buckets[this.bucketIndex(entry.key)].push(entry);
      }
      candidate = this.takeActive(this._buckets[0]);
      if (candidate === undefined) {
        throw new Error("radix heap invariant violated: redistributed bucket has no minimum");
      }
      return candidate;
    }
    return undefined;
  }

  private takeActive(bucket: Array<MonotoneEntry<T>>): MonotoneEntry<T> | undefined {
    for (let index = bucket.length - 1; index >= 0; index--) {
      const entry = bucket[index];
      if (!entry.cancelled) {
        bucket.splice(index, 1);
        return entry;
      }
    }
    bucket.length = 0;
    return undefined;
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
      if (key < lastPopped) {
        throw new TypeError("serialized entry is below lastPopped");
      }
      const entry: MonotoneEntry<T> = { value, key, cancelled: false };
      this._buckets[this.bucketIndex(key)].push(entry);
      this._active.set(value, entry);
      this._size++;
    }
  }
}
