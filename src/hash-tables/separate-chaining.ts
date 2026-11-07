import { HashTableBase } from "./base.ts";
import { nextPowerOfTwo } from "./hash.ts";
import { parseMap } from "./serialization.ts";
import type { HashOptions } from "./types.ts";

interface ChainEntry<K, V> {
  key: K;
  value: V;
  hash: number;
}

/**
 * Chained hash table: an array of `capacity` buckets, each a plain JS array of {key, value, hash}
 * entries; bucket = hash & (capacity - 1).
 * Fast: expected O(1) set/get/delete with no tombstones and no probe clustering, and it tolerates
 * any load factor (the default 0.75 is not capped below 1). Slow: one array per bucket plus one
 * entry object per key, so it uses more memory and has worse locality than the open-addressing
 * tables; prefer LinearProbing or RobinHood for small primitive keys at moderate load.
 * Worst case for every operation is O(n) when many keys share one bucket (poor or adversarial
 * hash). Grows by doubling when size exceeds capacity * loadFactor (checked after the insert), an
 * O(n + capacity) rehash that re-hashes every key. Iteration is a snapshot (see HashTableBase).
 */
export class SeparateChaining<K, V> extends HashTableBase<K, V> {
  private _buckets: Array<Array<ChainEntry<K, V>>>;

  constructor(options: HashOptions<K> = {}) {
    super(options);
    this._buckets = this.createBuckets(this._capacity);
  }

  /**
   * Expected O(1): scans one chain for an existing key, else appends. O(n + capacity) when the
   * insert pushes size past capacity * loadFactor and the table doubles.
   */
  set(key: K, value: V): this {
    this.assertStorable(key, value);
    const hash = this.hashKey(key);
    const bucket = this._buckets[hash & (this._capacity - 1)];
    for (const entry of bucket) {
      if (entry.hash === hash && this.equalKeys(entry.key, key)) {
        entry.value = value;
        this.touch();
        return this;
      }
    }
    bucket.push({ key, value, hash });
    this._size++;
    this.touch();
    if (this._size > this._capacity * this._loadFactor) {
      this.rehash(this._capacity * 2);
    }
    return this;
  }

  /** Expected O(1); worst O(n) when the bucket's chain holds many colliding keys. */
  get(key: K): V | undefined {
    const hash = this.hashKey(key);
    const bucket = this._buckets[hash & (this._capacity - 1)];
    for (const entry of bucket) {
      if (entry.hash === hash && this.equalKeys(entry.key, key)) {
        return entry.value;
      }
    }
    return undefined;
  }

  /** Same cost as get() (values can never be undefined, so the check is exact). */
  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  /** Expected O(1): splices the entry out of its chain; no tombstones, capacity never shrinks. */
  delete(key: K): boolean {
    const hash = this.hashKey(key);
    const bucket = this._buckets[hash & (this._capacity - 1)];
    for (let index = 0; index < bucket.length; index++) {
      const entry = bucket[index];
      if (entry.hash === hash && this.equalKeys(entry.key, key)) {
        bucket.splice(index, 1);
        this._size--;
        this.touch();
        return true;
      }
    }
    return false;
  }

  /** O(capacity): allocates a fresh empty array for every bucket; capacity is retained. */
  clear(): void {
    this._buckets = this.createBuckets(this._capacity);
    this._size = 0;
    this.touch();
  }

  /**
   * `capacity` is an entry count: one O(n + newCapacity) rehash if that many entries would exceed
   * the load factor, otherwise a no-op. Never shrinks.
   */
  reserve(capacity: number): void {
    this.assertCapacity(capacity);
    this.ensureCapacityForEntries(capacity);
  }

  /** O(n + capacity) and re-hashes every key; diagnostic only. */
  validate(): true | string {
    if (this._buckets.length !== this._capacity) {
      return "bucket array length does not match capacity";
    }
    let count = 0;
    const keysByHash = new Map<number, K[]>();
    for (let index = 0; index < this._buckets.length; index++) {
      const bucket = this._buckets[index];
      if (!Array.isArray(bucket)) {
        return `bucket ${index} is not an array`;
      }
      for (const entry of bucket) {
        if (entry.key === undefined) {
          return `bucket ${index} contains an undefined key`;
        }
        if (entry.value === undefined) {
          return `bucket ${index} contains an undefined value`;
        }
        if (
          entry.hash !== this.hashKey(entry.key)
        ) {
          return `bucket ${index} contains an entry with a stale hash`;
        }
        const sameHash = keysByHash.get(entry.hash);
        if (sameHash === undefined) {
          keysByHash.set(entry.hash, [entry.key]);
        } else {
          for (const other of sameHash) {
            if (this.equalKeys(other, entry.key)) {
              return `bucket ${index} contains a duplicate key`;
            }
          }
          sameHash.push(entry.key);
        }
        count++;
      }
    }
    if (count !== this._size) {
      return `size ${this._size} does not match entry count ${count}`;
    }
    if (this._size > this._capacity * this._loadFactor) {
      return "load factor exceeds the configured maximum";
    }
    return true;
  }

  protected collectEntries(): Array<[K, V]> {
    const entries: Array<[K, V]> = [];
    for (const bucket of this._buckets) {
      for (const entry of bucket) {
        entries.push([entry.key, entry.value]);
      }
    }
    return entries;
  }

  protected get serializationType(): string {
    return "SeparateChaining";
  }

  /** O(n + capacity): rebuilds every bucket and recomputes every key's hash. */
  protected rehash(capacity: number): void {
    const entries = this.collectEntries();
    this._capacity = nextPowerOfTwo(capacity);
    const buckets = this.createBuckets(this._capacity);
    for (const [key, value] of entries) {
      const hash = this.hashKey(key);
      buckets[hash & (this._capacity - 1)].push({ key, value, hash });
    }
    this._buckets = buckets;
    this.touch();
  }

  /** O(n) expected: re-inserts every entry with set(), then runs an O(n + capacity) validate. */
  static deserialize<K, V>(
    json: unknown,
    options: HashOptions<K> = {},
  ): SeparateChaining<K, V> {
    const parsed = parseMap<K, V>(json, "SeparateChaining");
    const table = new SeparateChaining<K, V>({
      ...options,
      capacity: options.capacity ?? parsed.capacity,
      loadFactor: options.loadFactor ?? parsed.loadFactor,
    });
    for (const [key, value] of parsed.entries) {
      table.set(key, value);
    }
    if (table.validate() !== true) {
      throw new TypeError(`Invalid SeparateChaining payload: ${table.validate()}`);
    }
    return table;
  }

  private createBuckets(capacity: number): Array<Array<ChainEntry<K, V>>> {
    return Array.from({ length: capacity }, () => []);
  }
}

/**
 * The module's default map: SeparateChaining under a different serialization tag, with identical
 * performance characteristics (expected O(1) operations, doubling at load factor 0.75).
 */
export class HashMap<K, V> extends SeparateChaining<K, V> {
  constructor(options: HashOptions<K> = {}) {
    super(options);
  }

  protected override get serializationType(): string {
    return "HashMap";
  }

  /** O(n) expected re-insertion followed by an O(n + capacity) validate. */
  static override deserialize<K, V>(
    json: unknown,
    options: HashOptions<K> = {},
  ): HashMap<K, V> {
    const parsed = parseMap<K, V>(json, "HashMap");
    const table = new HashMap<K, V>({
      ...options,
      capacity: options.capacity ?? parsed.capacity,
      loadFactor: options.loadFactor ?? parsed.loadFactor,
    });
    for (const [key, value] of parsed.entries) {
      table.set(key, value);
    }
    if (table.validate() !== true) {
      throw new TypeError(`Invalid HashMap payload: ${table.validate()}`);
    }
    return table;
  }
}
