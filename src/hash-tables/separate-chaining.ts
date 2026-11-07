import { HashTableBase } from "./base.ts";
import { nextPowerOfTwo } from "./hash.ts";
import { parseMap } from "./serialization.ts";
import type { HashOptions } from "./types.ts";

interface ChainEntry<K, V> {
  key: K;
  value: V;
  hash: number;
}

export class SeparateChaining<K, V> extends HashTableBase<K, V> {
  private _buckets: Array<Array<ChainEntry<K, V>>>;

  constructor(options: HashOptions<K> = {}) {
    super(options);
    this._buckets = this.createBuckets(this._capacity);
  }

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

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

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

  clear(): void {
    this._buckets = this.createBuckets(this._capacity);
    this._size = 0;
    this.touch();
  }

  reserve(capacity: number): void {
    this.assertCapacity(capacity);
    this.ensureCapacityForEntries(capacity);
  }

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

export class HashMap<K, V> extends SeparateChaining<K, V> {
  constructor(options: HashOptions<K> = {}) {
    super(options);
  }

  protected override get serializationType(): string {
    return "HashMap";
  }

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
