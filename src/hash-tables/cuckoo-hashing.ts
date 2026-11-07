import {
  assertDefined,
  readArray,
  readObject,
  readOptionalInteger,
  readValue,
} from "../core/index.ts";
import type { SerializedRecord } from "../core/index.ts";
import { HashTableBase } from "./base.ts";
import {
  assertPositiveInteger,
  mix32,
  nextPowerOfTwo,
} from "./hash.ts";
import { parseMap, serializeMap } from "./serialization.ts";
import type { CuckooHashOptions } from "./types.ts";

interface CuckooEntry<K, V> {
  key: K;
  value: V;
  hash: number;
}

/**
 * Bucketized cuckoo hashing: two bucket arrays of `capacity` buckets each, every bucket holding up
 * to bucketSize (default 4) entries, plus a stash array for entries that could not be placed.
 * A key lives in one of exactly two buckets (first = hash & mask, second = mix32 of the same hash),
 * so get/has/delete inspect at most 2 * bucketSize entries plus the stash: O(1) worst case as long
 * as the stash stays empty. Insert is expected O(1) but, when a bucket is full, evicts a victim and
 * re-places it in its other bucket, up to maxKicks (default 500) times; after that the entry is
 * pushed to the stash instead of triggering a rehash, and every stash entry adds one linear
 * comparison to every later lookup. More than 2 * bucketSize keys with identical hashes therefore
 * degrade lookups to O(stash).
 * Grows by doubling only when size exceeds capacity * 2 * bucketSize * min(loadFactor, 0.95); the
 * rehash re-inserts every entry (O(n) expected, O(n * maxKicks) worst) with fresh hashes. Both
 * bucket indices derive from one 32-bit hash, so a rehash never changes which keys collide.
 * Iteration is a snapshot (see HashTableBase).
 */
export class CuckooHashing<K, V> extends HashTableBase<K, V> {
  private _buckets1: Array<Array<CuckooEntry<K, V>>>;
  private _buckets2: Array<Array<CuckooEntry<K, V>>>;
  private _stash: Array<CuckooEntry<K, V>> = [];
  private readonly _bucketSize: number;
  private readonly _maxKicks: number;

  constructor(options: CuckooHashOptions<K> = {}) {
    super(options);
    this._bucketSize = options.bucketSize ?? 4;
    this._maxKicks = options.maxKicks ?? 500;
    assertPositiveInteger(this._bucketSize, "bucketSize");
    assertPositiveInteger(this._maxKicks, "maxKicks");
    this._buckets1 = this.createBuckets(this._capacity);
    this._buckets2 = this.createBuckets(this._capacity);
  }

  /**
   * Expected O(1): a two-bucket lookup, then placement with up to maxKicks evictions; hashes the
   * key twice on a fresh insert. O(n) expected when the insert crosses the resize threshold.
   */
  set(key: K, value: V): this {
    this.assertStorable(key, value);
    const existing = this.findEntry(key);
    if (existing !== undefined) {
      existing.value = value;
      this.touch();
      return this;
    }
    if (this._size + 1 > this.resizeThreshold(this._capacity)) {
      this.rehash(this._capacity * 2);
    }
    this.insertEntry({ key, value, hash: this.hashKey(key) });
    this._size++;
    this.touch();
    return this;
  }

  /**
   * O(1) worst case over the two candidate buckets (at most 2 * bucketSize comparisons) plus a
   * linear scan of the stash.
   */
  get(key: K): V | undefined {
    return this.findEntry(key)?.value;
  }

  /** Same cost as get(). */
  has(key: K): boolean {
    return this.findEntry(key) !== undefined;
  }

  /**
   * O(bucketSize + stash): locates the entry, then indexOf + splice within its bucket or the stash.
   * No tombstones, never shrinks.
   */
  delete(key: K): boolean {
    const hash = this.hashKey(key);
    const entry = this.findEntryByHash(key, hash);
    if (entry === undefined) {
      return false;
    }
    const first = this._buckets1[this.firstIndex(hash)];
    let index = first.indexOf(entry);
    if (index >= 0) {
      first.splice(index, 1);
      this._size--;
      this.touch();
      return true;
    }
    const second = this._buckets2[this.secondIndex(hash)];
    index = second.indexOf(entry);
    if (index >= 0) {
      second.splice(index, 1);
      this._size--;
      this.touch();
      return true;
    }
    index = this._stash.indexOf(entry);
    if (index >= 0) {
      this._stash.splice(index, 1);
      this._size--;
      this.touch();
      return true;
    }
    return false;
  }

  /** O(capacity): reallocates both bucket arrays and empties the stash. */
  clear(): void {
    this._buckets1 = this.createBuckets(this._capacity);
    this._buckets2 = this.createBuckets(this._capacity);
    this._stash = [];
    this._size = 0;
    this.touch();
  }

  /**
   * O(n + newCapacity) if growth is needed. It sizes each table to `capacity` / loadFactor BUCKETS,
   * which is about 2 * bucketSize times more slots than `capacity` entries actually need.
   */
  reserve(capacity: number): void {
    this.assertCapacity(capacity);
    this.ensureCapacityForEntries(capacity);
  }

  /** O(capacity + n) and re-hashes every key; diagnostic only. */
  validate(): true | string {
    if (this._buckets1.length !== this._capacity || this._buckets2.length !== this._capacity) {
      return "bucket array length does not match capacity";
    }
    let count = 0;
    const keysByHash = new Map<number, K[]>();
    for (let table = 0; table < 2; table++) {
      const buckets = table === 0 ? this._buckets1 : this._buckets2;
      for (let index = 0; index < buckets.length; index++) {
        const bucket = buckets[index];
        if (bucket.length > this._bucketSize) {
          return `bucket ${index} in table ${table} exceeds bucketSize`;
        }
        for (const entry of bucket) {
          const problem = this.validateEntry(entry, keysByHash);
          if (problem !== true) {
            return problem;
          }
          if (table === 0) {
            if (index !== this.firstIndex(entry.hash) && index !== this.secondIndex(entry.hash)) {
              return `entry in table 0 bucket ${index} is not at either hash position`;
            }
          } else if (index !== this.firstIndex(entry.hash) && index !== this.secondIndex(entry.hash)) {
            return `entry in table 1 bucket ${index} is not at either hash position`;
          }
          count++;
        }
      }
    }
    for (const entry of this._stash) {
      const problem = this.validateEntry(entry, keysByHash);
      if (problem !== true) {
        return problem;
      }
      count++;
    }
    if (count !== this._size) {
      return `size ${this._size} does not match entry count ${count}`;
    }
    return true;
  }

  protected collectEntries(): Array<[K, V]> {
    const entries: Array<[K, V]> = [];
    for (const bucket of this._buckets1) {
      for (const entry of bucket) {
        entries.push([entry.key, entry.value]);
      }
    }
    for (const bucket of this._buckets2) {
      for (const entry of bucket) {
        entries.push([entry.key, entry.value]);
      }
    }
    for (const entry of this._stash) {
      entries.push([entry.key, entry.value]);
    }
    return entries;
  }

  protected get serializationType(): string {
    return "CuckooHashing";
  }

  /**
   * O(n) expected, O(n * maxKicks) worst: re-inserts every entry, stash included, with freshly
   * computed hashes.
   */
  protected rehash(capacity: number): void {
    const entries = this.collectEntries();
    this._capacity = nextPowerOfTwo(capacity);
    this._buckets1 = this.createBuckets(this._capacity);
    this._buckets2 = this.createBuckets(this._capacity);
    this._stash = [];
    this._size = 0;
    for (const [key, value] of entries) {
      this.insertEntry({ key, value, hash: this.hashKey(key) });
      this._size++;
    }
    this.touch();
  }

  /**
   * O(capacity + n) from a layout payload; otherwise O(n) expected re-insertion. Followed by an
   * O(capacity + n) validate.
   */
  static deserialize<K, V>(
    json: unknown,
    options: CuckooHashOptions<K> = {},
  ): CuckooHashing<K, V> {
    const parsed = parseMap<K, V>(json, "CuckooHashing");
    const bucketSize = readOptionalInteger(parsed.record, "bucketSize");
    const maxKicks = readOptionalInteger(parsed.record, "maxKicks");
    if (bucketSize !== undefined && bucketSize <= 0) {
      throw new TypeError("bucketSize must be a positive integer");
    }
    if (maxKicks !== undefined && maxKicks <= 0) {
      throw new TypeError("maxKicks must be a positive integer");
    }
    const table = new CuckooHashing<K, V>({
      ...options,
      capacity: options.capacity ?? parsed.capacity,
      loadFactor: options.loadFactor ?? parsed.loadFactor,
      ...(bucketSize === undefined ? {} : { bucketSize }),
      ...(maxKicks === undefined ? {} : { maxKicks }),
    });
    if (parsed.record.layout !== undefined) {
      table.restoreLayout(parsed.record);
    } else {
      for (const [key, value] of parsed.entries) {
        table.set(key, value);
      }
    }
    if (table.validate() !== true) {
      throw new TypeError(`Invalid CuckooHashing payload: ${table.validate()}`);
    }
    return table;
  }

  /** O(capacity + n): the payload lists every bucket of both tables plus the stash. */
  override serialize(): string {
    return serializeMap(
      "CuckooHashing",
      this._capacity,
      this._loadFactor,
      this.collectEntries(),
      {
        bucketSize: this._bucketSize,
        maxKicks: this._maxKicks,
        layout: {
          table1: this.serializeBuckets(this._buckets1),
          table2: this.serializeBuckets(this._buckets2),
          stash: this._stash.map((entry) => [entry.key, entry.value, entry.hash]),
        },
      },
    );
  }

  protected restoreLayout(record: SerializedRecord): void {
    const layout = readObject(record.layout, "layout");
    const table1 = readArray(layout, "table1");
    const table2 = readArray(layout, "table2");
    const stash = readArray(layout, "stash");
    if (table1.length !== this._capacity || table2.length !== this._capacity) {
      throw new TypeError("layout bucket count does not match capacity");
    }
    this._buckets1 = this.restoreBuckets(table1, "table1");
    this._buckets2 = this.restoreBuckets(table2, "table2");
    this._stash = [];
    for (let index = 0; index < stash.length; index++) {
      const raw = stash[index];
      if (!Array.isArray(raw) || raw.length !== 3) {
        throw new TypeError(`layout stash[${index}] must be [key, value, hash]`);
      }
      const entry = this.restoreEntry(raw, `layout stash[${index}]`);
      this._stash.push(entry);
    }
    this._size =
      this.countBuckets(this._buckets1) +
      this.countBuckets(this._buckets2) +
      this._stash.length;
  }

  private serializeBuckets(
    buckets: Array<Array<CuckooEntry<K, V>>>,
  ): Array<Array<[K, V, number]>> {
    return buckets.map((bucket) =>
      bucket.map((entry) => [entry.key, entry.value, entry.hash] as [K, V, number]),
    );
  }

  private restoreBuckets(
    raw: unknown[],
    name: string,
  ): Array<Array<CuckooEntry<K, V>>> {
    return raw.map((bucket, bucketIndex) => {
      if (!Array.isArray(bucket)) {
        throw new TypeError(`layout ${name}[${bucketIndex}] must be an array`);
      }
      if (bucket.length > this._bucketSize) {
        throw new TypeError(`layout ${name}[${bucketIndex}] exceeds bucketSize`);
      }
      return bucket.map((entry, entryIndex) => {
        if (!Array.isArray(entry) || entry.length !== 3) {
          throw new TypeError(
            `layout ${name}[${bucketIndex}][${entryIndex}] must be [key, value, hash]`,
          );
        }
        return this.restoreEntry(
          entry,
          `layout ${name}[${bucketIndex}][${entryIndex}]`,
        );
      });
    });
  }

  private restoreEntry(raw: unknown[], name: string): CuckooEntry<K, V> {
    const key = readValue<K>(raw[0], `${name}[0]`);
    const value = readValue<V>(raw[1], `${name}[1]`);
    const hash = raw[2];
    if (typeof hash !== "number" || !Number.isInteger(hash)) {
      throw new TypeError(`${name}[2] must be an integer`);
    }
    return { key, value, hash };
  }

  private countBuckets(buckets: Array<Array<CuckooEntry<K, V>>>): number {
    let count = 0;
    for (const bucket of buckets) {
      count += bucket.length;
    }
    return count;
  }

  private createBuckets(capacity: number): Array<Array<CuckooEntry<K, V>>> {
    return Array.from({ length: capacity }, () => []);
  }

  private firstIndex(hash: number): number {
    return hash & (this._capacity - 1);
  }

  private secondIndex(hash: number): number {
    const mask = this._capacity - 1;
    const first = hash & mask;
    let second = mix32(hash ^ 0x9e3779b9) & mask;
    if (second === first && this._capacity > 1) {
      second = (first ^ 1) & mask;
    }
    return second;
  }

  private findEntry(key: K): CuckooEntry<K, V> | undefined {
    return this.findEntryByHash(key, this.hashKey(key));
  }

  private findEntryByHash(key: K, hash: number): CuckooEntry<K, V> | undefined {
    for (const bucket of [
      this._buckets1[this.firstIndex(hash)],
      this._buckets2[this.secondIndex(hash)],
    ]) {
      for (const entry of bucket) {
        if (entry.hash === hash && this.equalKeys(entry.key, key)) {
          return entry;
        }
      }
    }
    for (const entry of this._stash) {
      if (entry.hash === hash && this.equalKeys(entry.key, key)) {
        return entry;
      }
    }
    return undefined;
  }

  /**
   * Kick loop: starts in the table chosen by the hash's low bit, evicts the victim at
   * (hash >>> 8) % bucket.length when a bucket is full, and after maxKicks parks the entry in the
   * stash. It never rehashes, so a cuckoo cycle costs maxKicks swaps and one stash entry.
   */
  private insertEntry(entry: CuckooEntry<K, V>): void {
    let current = entry;
    let useSecond = (current.hash & 1) === 1;
    for (let kick = 0; kick < this._maxKicks; kick++) {
      const index = useSecond
        ? this.secondIndex(current.hash)
        : this.firstIndex(current.hash);
      const bucket = useSecond ? this._buckets2[index] : this._buckets1[index];
      if (bucket.length < this._bucketSize) {
        bucket.push(current);
        return;
      }
      const victimIndex = (current.hash >>> 8) % bucket.length;
      const victim = bucket[victimIndex];
      bucket[victimIndex] = current;
      current = victim;
      useSecond = !useSecond;
    }
    this._stash.push(current);
  }

  private validateEntry(
    entry: CuckooEntry<K, V>,
    keysByHash: Map<number, K[]>,
  ): true | string {
    assertDefined(entry.key, "key");
    assertDefined(entry.value, "value");
    if (entry.hash !== this.hashKey(entry.key)) {
      return "entry has a stale hash";
    }
    const sameHash = keysByHash.get(entry.hash);
    if (sameHash === undefined) {
      keysByHash.set(entry.hash, [entry.key]);
    } else {
      for (const other of sameHash) {
        if (this.equalKeys(other, entry.key)) {
          return "duplicate key";
        }
      }
      sameHash.push(entry.key);
    }
    return true;
  }

  /** Resize trigger: total slots (2 * capacity * bucketSize) times loadFactor capped at 0.95. */
  private resizeThreshold(capacity: number): number {
    return Math.max(
      1,
      Math.floor(
        capacity * 2 * this._bucketSize * Math.min(this._loadFactor, 0.95),
      ),
    );
  }
}
