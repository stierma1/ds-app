import {
  assertDefined,
  ContainerBase,
  parseSerialized,
  readArray,
  readOptionalInteger,
  readValue,
  serializeRecord,
} from "../core/index.ts";
import {
  createRng,
  defaultHash,
  mix32,
  normalizeHash,
  resolveEquals,
  resolveHash,
} from "./hash.ts";
import { HashMap } from "./separate-chaining.ts";
import type { PerfectHashOptions } from "./types.ts";

interface PerfectEntry<K, V> {
  key: K;
  value: V;
  hash: number;
}

interface PerfectBucket<K, V> {
  size: number;
  multiplier: number;
  slots: Array<PerfectEntry<K, V> | null>;
  overflow: Array<PerfectEntry<K, V>>;
}

/**
 * Static two-level (FKS-style) perfect hash table built once from a fixed key set. Level one maps
 * a key's hash to one of n buckets with a seeded multiplier; a bucket holding s keys gets a
 * second-level array of s * s slots and a multiplier that places its keys collision-free (up to
 * 1000 random tries, only 32 once s * s > 4096). If no multiplier is found, or s > 500, the bucket
 * falls back to a linear `overflow` list.
 * Lookup is O(1) worst case (two multiply-mod steps, one hash compare, one `equals`) for every
 * bucket that resolved perfectly; a fallback bucket costs O(s). Each lookup hashes the key twice
 * (the user hash xor defaultHash), so string keys pay O(length) twice.
 * Immutable after build() except for clear(): there is no set/delete/reserve, so use HashMap for
 * anything that changes. Build is expected O(n) time and O(n) space (sum of s * s), but a skewed
 * first-level split can allocate up to 250,000 slots for one bucket. Input is deduplicated through
 * a HashMap first. Iteration is a snapshot over all slots, O(total slots) >= O(n), and throws
 * ConcurrentModificationError if clear() runs mid-iteration.
 */
export class PerfectHashing<K, V> extends ContainerBase<[K, V]> {
  private readonly _hash: (key: K) => number;
  private readonly _equals: (a: K, b: K) => boolean;
  private readonly _seed: number;
  private _firstMultiplier = 1;
  private _firstSize = 1;
  private _buckets: Array<PerfectBucket<K, V>> = [];

  private constructor(options: PerfectHashOptions<K> = {}) {
    super();
    this._hash = resolveHash(options.hash);
    this._equals = resolveEquals(options.equals);
    this._seed = options.seed ?? 0x517cc1b7;
    if (!Number.isInteger(this._seed)) {
      throw new TypeError("seed must be an integer");
    }
  }

  /**
   * Expected O(n) time and space: dedupes via a HashMap, hashes every key, then searches a
   * collision-free multiplier per bucket (O(tries * s) each). Deterministic for a given seed.
   */
  static build<K, V>(
    entries: Iterable<readonly [K, V]>,
    options: PerfectHashOptions<K> = {},
  ): PerfectHashing<K, V> {
    const table = new PerfectHashing<K, V>(options);
    const deduped = new HashMap<K, V>(options);
    for (const [key, value] of entries) {
      deduped.set(key, value);
    }
    table.buildFromEntries(deduped.toArray());
    return table;
  }

  /**
   * O(1) worst case for a perfectly resolved bucket; O(s) for a bucket that fell back to its
   * overflow list. Hashes the key twice.
   */
  get(key: K): V | undefined {
    assertDefined(key, "key");
    const hash = this.hashKey(key);
    const bucket = this._buckets[this.firstIndex(hash)];
    if (bucket.size === 0 && bucket.overflow.length === 0) {
      return undefined;
    }
    const slot = bucket.slots.length === 0
      ? undefined
      : bucket.slots[(Math.imul(bucket.multiplier, hash) >>> 0) % bucket.slots.length];
    if (
      slot !== null &&
      slot !== undefined &&
      slot.hash === hash &&
      this._equals(slot.key, key)
    ) {
      return slot.value;
    }
    for (const entry of bucket.overflow) {
      if (entry.hash === hash && this._equals(entry.key, key)) {
        return entry.value;
      }
    }
    return undefined;
  }

  /** Same cost as get(). */
  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  /** O(1): drops every bucket; the table must be rebuilt with build() to be useful again. */
  clear(): void {
    this._firstMultiplier = 1;
    this._firstSize = 1;
    this._buckets = [this.createBucket(0)];
    this._size = 0;
    this.touch();
  }

  /** O(total slots + n) and re-hashes every key; diagnostic only. */
  validate(): true | string {
    if (this._buckets.length !== this._firstSize) {
      return "bucket count does not match first-level size";
    }
    let count = 0;
    const keys = new Map<number, K[]>();
    for (let index = 0; index < this._buckets.length; index++) {
      const bucket = this._buckets[index];
      if (bucket.slots.length !== bucket.size * bucket.size) {
        return `bucket ${index} has an invalid slot count`;
      }
      const seen = new Uint8Array(bucket.slots.length);
      for (let slotIndex = 0; slotIndex < bucket.slots.length; slotIndex++) {
        const entry = bucket.slots[slotIndex];
        if (entry === null) {
          continue;
        }
        if (entry.key === undefined) {
          return `bucket ${index} has an undefined key`;
        }
        if (entry.value === undefined) {
          return `bucket ${index} has an undefined value`;
        }
        if (entry.hash !== this.hashKey(entry.key)) {
          return `bucket ${index} has a stale hash`;
        }
        if (this.firstIndex(entry.hash) !== index) {
          return `bucket ${index} contains a key from another first-level bucket`;
        }
        const expectedSlot =
          (Math.imul(bucket.multiplier, entry.hash) >>> 0) % bucket.slots.length;
        if (expectedSlot !== slotIndex) {
          return `bucket ${index} contains a key in the wrong slot`;
        }
        if (seen[slotIndex] === 1) {
          return `bucket ${index} has a duplicated slot`;
        }
        seen[slotIndex] = 1;
        const sameHash = keys.get(entry.hash);
        if (sameHash === undefined) {
          keys.set(entry.hash, [entry.key]);
        } else {
          for (const other of sameHash) {
            if (this._equals(other, entry.key)) {
              return `bucket ${index} duplicates a key`;
            }
          }
          sameHash.push(entry.key);
        }
        count++;
      }
      for (const entry of bucket.overflow) {
        if (entry.key === undefined || entry.value === undefined) {
          return `bucket ${index} has an undefined overflow entry`;
        }
        if (entry.hash !== this.hashKey(entry.key)) {
          return `bucket ${index} has a stale overflow hash`;
        }
        if (this.firstIndex(entry.hash) !== index) {
          return `bucket ${index} has an overflow entry from another bucket`;
        }
        count++;
      }
    }
    if (count !== this._size) {
      return `size ${this._size} does not match entry count ${count}`;
    }
    if (this._size > 0 && this._firstSize < 1) {
      return "first-level size is invalid";
    }
    return true;
  }

  protected collectEntries(): Array<[K, V]> {
    const entries: Array<[K, V]> = [];
    for (const bucket of this._buckets) {
      for (const entry of bucket.slots) {
        if (entry !== null) {
          entries.push([entry.key, entry.value]);
        }
      }
      for (const entry of bucket.overflow) {
        entries.push([entry.key, entry.value]);
      }
    }
    return entries;
  }

  /** O(total second-level slots), which is >= n: scans every slot including empty ones. */
  toArray(): Array<[K, V]> {
    return this.collectEntries();
  }

  /** O(total slots) up front: snapshot iterator over toArray(). */
  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.snapshotIterator(this.toArray());
  }

  /** O(total slots) snapshot plus a second array of keys. */
  keys(): IterableIterator<K> {
    return this.snapshotIterator(this.toArray().map(([key]) => key));
  }

  /** O(total slots) snapshot plus a second array of values. */
  values(): IterableIterator<V> {
    return this.snapshotIterator(this.toArray().map(([, value]) => value));
  }

  /** O(total slots) up front: snapshot iterator over toArray(). */
  entries(): IterableIterator<[K, V]> {
    return this.snapshotIterator(this.toArray());
  }

  /** O(total slots + n): stores only the entries and seed; the layout is rebuilt on deserialize. */
  serialize(): string {
    return serializeRecord("PerfectHashing", {
      seed: this._seed,
      entries: this.collectEntries(),
    });
  }

  /** O(n) parse followed by a full build() (expected O(n)). */
  static deserialize<K, V>(
    json: unknown,
    options: PerfectHashOptions<K> = {},
  ): PerfectHashing<K, V> {
    const record = parseSerialized(json, "PerfectHashing");
    const entries = readArray(record, "entries");
    const seed = readOptionalInteger(record, "seed");
    const pairs: Array<[K, V]> = [];
    for (let index = 0; index < entries.length; index++) {
      const pair = entries[index];
      if (!Array.isArray(pair) || pair.length !== 2) {
        throw new TypeError(`entries[${index}] must be a [key, value] pair`);
      }
      pairs.push([
        readValue<K>(pair[0], `entries[${index}][0]`),
        readValue<V>(pair[1], `entries[${index}][1]`),
      ]);
    }
    return PerfectHashing.build(pairs, {
      ...options,
      ...(seed === undefined ? {} : { seed }),
    });
  }

  private buildFromEntries(entries: Array<[K, V]>): void {
    const hashes = entries.map(([key]) => [key, this.hashKey(key)] as const);
    this._firstSize = Math.max(1, entries.length);
    this._buckets = [];
    const grouped: Array<Array<{ key: K; value: V; hash: number }>> = Array.from(
      { length: this._firstSize },
      () => [],
    );
    const rng = createRng(this._seed);
    this._firstMultiplier = (rng() | 1) >>> 0 || 1;
    for (let index = 0; index < entries.length; index++) {
      const [key, value] = entries[index];
      const hash = hashes[index][1];
      grouped[this.firstIndex(hash)].push({ key, value, hash });
    }
    for (const group of grouped) {
      this._buckets.push(this.buildBucket(group, rng));
    }
    this._size = entries.length;
    this.touch();
  }

  /**
   * Second-level policy: s * s slots, up to 1000 multiplier tries (32 once s * s > 4096), and a
   * linear overflow fallback when the tries run out or s > 500 (which would need > 250,000 slots).
   */
  private buildBucket(
    entries: Array<{ key: K; value: V; hash: number }>,
    rng: () => number,
  ): PerfectBucket<K, V> {
    if (entries.length === 0) {
      return this.createBucket(0);
    }
    const size = entries.length * entries.length;
    if (size > 250000) {
      return {
        size: entries.length,
        slots: new Array(size).fill(null),
        overflow: entries.slice(),
        multiplier: 1,
      };
    }
    const attempts = size > 4096 ? 32 : 1000;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const multiplier = (rng() | 1) >>> 0 || 1;
      const slots: Array<PerfectEntry<K, V> | null> = new Array(size).fill(null);
      let failed = false;
      for (const entry of entries) {
        const index = (Math.imul(multiplier, entry.hash) >>> 0) % size;
        if (slots[index] !== null) {
          failed = true;
          break;
        }
        slots[index] = entry;
      }
      if (!failed) {
        return { size: entries.length, slots, overflow: [], multiplier };
      }
    }
    return {
      size: entries.length,
      slots: new Array(size).fill(null),
      overflow: entries.slice(),
      multiplier: 1,
    };
  }

  private createBucket(size: number): PerfectBucket<K, V> {
    return {
      size,
      slots: new Array(size * size).fill(null),
      overflow: [],
      multiplier: 1,
    };
  }

  /**
   * Mixes the user hash with defaultHash so a weak user hash still spreads across buckets; the
   * price is two hash computations per key on every build and lookup.
   */
  private hashKey(key: K): number {
    const user = normalizeHash(this._hash(key));
    try {
      return mix32(user ^ defaultHash(key));
    } catch {
      return user;
    }
  }

  private firstIndex(hash: number): number {
    return (Math.imul(this._firstMultiplier, hash) >>> 0) % this._firstSize;
  }

}
