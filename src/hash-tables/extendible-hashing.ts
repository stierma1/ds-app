import {
  assertDefined,
  readArray,
  readObject,
  readOptionalInteger,
  readValue,
} from "../core/index.ts";
import type { SerializedRecord } from "../core/index.ts";
import { HashTableBase } from "./base.ts";
import { assertPositiveInteger, nextPowerOfTwo } from "./hash.ts";
import { parseMap, serializeMap } from "./serialization.ts";
import type { ExtendibleHashOptions } from "./types.ts";

interface ExtendibleEntry<K, V> {
  key: K;
  value: V;
  hash: number;
}

interface Bucket<K, V> {
  localDepth: number;
  entries: Array<ExtendibleEntry<K, V>>;
}

/**
 * Extendible hashing: a directory of 2^globalDepth pointers into buckets of up to bucketSize
 * (default 4) entries, indexed by the low globalDepth bits of the hash; several directory slots may
 * share one bucket (its localDepth says how many bits it really uses). Growth is local: a full
 * bucket splits in two on the next hash bit, and the directory doubles only when the splitting
 * bucket already uses every directory bit. No full-table rehash ever happens and `loadFactor` is
 * stored but ignored, so the worst single insert is O(directory) rather than O(n); prefer it when
 * latency spikes matter more than raw throughput.
 * Costs to know: every split (doubling or not) scans the whole directory to repoint slots, so a
 * split is O(2^globalDepth); delete also scans the directory to find the bucket's prefix and try
 * merging it with its buddy, making delete O(2^globalDepth) rather than O(1). A bucket whose keys
 * all share the next hash bit cannot split and simply grows past bucketSize (lookups become
 * O(bucket)); skewed hashes can double the directory repeatedly, up to depth 30. The directory
 * never shrinks, but buddy buckets re-merge when their combined entries fit in one bucket.
 * Iteration is a snapshot (see HashTableBase).
 */
export class ExtendibleHashing<K, V> extends HashTableBase<K, V> {
  private _globalDepth: number;
  private _directory: Array<Bucket<K, V>>;
  private readonly _bucketSize: number;

  constructor(options: ExtendibleHashOptions<K> = {}) {
    super(options);
    this._bucketSize = options.bucketSize ?? 4;
    assertPositiveInteger(this._bucketSize, "bucketSize");
    this._globalDepth = Math.max(0, Math.ceil(Math.log2(this._capacity)));
    const initial = this.createBucket(0);
    this._directory = new Array(nextPowerOfTwo(Math.max(1, this._capacity))).fill(initial);
  }

  /** O(1): the directory length (2^globalDepth), not a slot or entry count. */
  override get capacity(): number {
    return this._directory.length;
  }

  /**
   * O(bucketSize) expected; O(2^globalDepth) when the bucket is full and splits (always a directory
   * scan, plus a directory copy if globalDepth must grow).
   */
  set(key: K, value: V): this {
    this.assertStorable(key, value);
    const hash = this.hashKey(key);
    let bucket = this.bucketForHash(hash);
    for (const entry of bucket.entries) {
      if (entry.hash === hash && this.equalKeys(entry.key, key)) {
        entry.value = value;
        this.touch();
        return this;
      }
    }
    if (bucket.entries.length < this._bucketSize) {
      bucket.entries.push({ key, value, hash });
      this._size++;
      this.touch();
      return this;
    }
    if (this.canSplit(bucket)) {
      this.splitBucket(bucket);
      bucket = this.bucketForHash(hash);
    }
    bucket.entries.push({ key, value, hash });
    this._size++;
    this.touch();
    return this;
  }

  /**
   * O(1) directory lookup plus a scan of one bucket: bucketSize entries unless the bucket could not
   * split.
   */
  get(key: K): V | undefined {
    const hash = this.hashKey(key);
    const bucket = this.bucketForHash(hash);
    for (const entry of bucket.entries) {
      if (entry.hash === hash && this.equalKeys(entry.key, key)) {
        return entry.value;
      }
    }
    return undefined;
  }

  /** Same cost as get(). */
  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * O(2^globalDepth): after the O(bucketSize) splice it scans the directory to locate the bucket's
   * buddy and merges them if their union fits in bucketSize.
   */
  delete(key: K): boolean {
    const hash = this.hashKey(key);
    const bucket = this.bucketForHash(hash);
    for (let index = 0; index < bucket.entries.length; index++) {
      const entry = bucket.entries[index];
      if (entry.hash === hash && this.equalKeys(entry.key, key)) {
        bucket.entries.splice(index, 1);
        this._size--;
        this.touch();
        this.tryMerge(bucket);
        return true;
      }
    }
    return false;
  }

  /** O(capacity): rebuilds the initial directory pointing at a single empty bucket. */
  clear(): void {
    this._globalDepth = Math.max(0, Math.ceil(Math.log2(this._capacity)));
    const bucket = this.createBucket(0);
    this._directory = new Array(nextPowerOfTwo(Math.max(1, this._capacity))).fill(bucket);
    this._size = 0;
    this.touch();
  }

  /**
   * O(target directory): doubles the directory until it has ceil(capacity / bucketSize) slots so
   * later splits avoid directory copies; no bucket is split and nothing shrinks.
   */
  reserve(capacity: number): void {
    this.assertCapacity(capacity);
    const neededBuckets = Math.max(1, Math.ceil(capacity / this._bucketSize));
    const targetDepth = Math.max(
      this._globalDepth,
      Math.ceil(Math.log2(neededBuckets)),
    );
    while (this._globalDepth < targetDepth) {
      this._globalDepth++;
      this._directory = [...this._directory, ...this._directory];
    }
  }

  /** O(2^globalDepth + n) and re-hashes every key; diagnostic only. */
  validate(): true | string {
    const expectedLength = 2 ** this._globalDepth;
    if (this._directory.length !== expectedLength) {
      return "directory length does not match global depth";
    }
    if (this._globalDepth < 0 || this._globalDepth > 30) {
      return "global depth is out of range";
    }
    const bucketPrefix = new Map<Bucket<K, V>, number>();
    for (let index = 0; index < this._directory.length; index++) {
      const bucket = this._directory[index];
      if (bucket === undefined || bucket === null) {
        return `directory entry ${index} is empty`;
      }
      if (bucket.localDepth < 0 || bucket.localDepth > this._globalDepth) {
        return `bucket local depth is out of range at directory entry ${index}`;
      }
      const prefix = index & this.depthMask(bucket.localDepth);
      const previous = bucketPrefix.get(bucket);
      if (previous === undefined) {
        bucketPrefix.set(bucket, prefix);
      } else if (previous !== prefix) {
        return "a bucket is referenced by inconsistent directory prefixes";
      }
    }
    let count = 0;
    const keysByHash = new Map<number, K[]>();
    for (const [bucket, prefix] of bucketPrefix) {
      for (const entry of bucket.entries) {
        assertDefined(entry.key, "key");
        assertDefined(entry.value, "value");
        if (entry.hash !== this.hashKey(entry.key)) {
          return "bucket contains an entry with a stale hash";
        }
        if ((entry.hash & this.depthMask(bucket.localDepth)) !== prefix) {
          return "bucket contains an entry that does not match its prefix";
        }
        const sameHash = keysByHash.get(entry.hash);
        if (sameHash === undefined) {
          keysByHash.set(entry.hash, [entry.key]);
        } else {
          for (const other of sameHash) {
            if (this.equalKeys(other, entry.key)) {
              return "duplicate key across buckets";
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
    return true;
  }

  protected collectEntries(): Array<[K, V]> {
    const entries: Array<[K, V]> = [];
    const seen = new Set<Bucket<K, V>>();
    for (const bucket of this._directory) {
      if (seen.has(bucket)) {
        continue;
      }
      seen.add(bucket);
      for (const entry of bucket.entries) {
        entries.push([entry.key, entry.value]);
      }
    }
    return entries;
  }

  protected get serializationType(): string {
    return "ExtendibleHashing";
  }

  /**
   * O(n) set() calls from scratch. Not reached in practice: reserve() is overridden and loadFactor
   * is ignored, so nothing in this class triggers it.
   */
  protected rehash(capacity: number): void {
    const entries = this.collectEntries();
    this._capacity = nextPowerOfTwo(capacity);
    this._globalDepth = Math.max(0, Math.ceil(Math.log2(this._capacity)));
    const bucket = this.createBucket(0);
    this._directory = new Array(nextPowerOfTwo(Math.max(1, this._capacity))).fill(bucket);
    this._size = 0;
    for (const [key, value] of entries) {
      this.set(key, value);
    }
    this.touch();
  }

  /** O(2^globalDepth + n): stores every distinct bucket plus the directory's bucket indices. */
  override serialize(): string {
    const bucketIndex = new Map<Bucket<K, V>, number>();
    const buckets: Array<{ localDepth: number; entries: Array<[K, V, number]> }> = [];
    for (const bucket of this._directory) {
      if (bucketIndex.has(bucket)) {
        continue;
      }
      bucketIndex.set(bucket, buckets.length);
      buckets.push({
        localDepth: bucket.localDepth,
        entries: bucket.entries.map((entry) => [entry.key, entry.value, entry.hash]),
      });
    }
    return serializeMap(
      "ExtendibleHashing",
      this._directory.length,
      this._loadFactor,
      this.collectEntries(),
      {
        bucketSize: this._bucketSize,
        layout: {
          globalDepth: this._globalDepth,
          buckets,
          directory: this._directory.map((bucket) => bucketIndex.get(bucket) as number),
        },
      },
    );
  }

  protected restoreLayout(record: SerializedRecord): void {
    const layout = readObject(record.layout, "layout");
    const globalDepth = layout.globalDepth;
    const rawBuckets = readArray(layout, "buckets");
    const rawDirectory = readArray(layout, "directory");
    if (
      typeof globalDepth !== "number" ||
      !Number.isInteger(globalDepth) ||
      globalDepth < 0 ||
      globalDepth > 30
    ) {
      throw new TypeError("layout globalDepth is invalid");
    }
    const expected = 2 ** globalDepth;
    if (rawDirectory.length !== expected) {
      throw new TypeError("layout directory length does not match global depth");
    }
    const buckets: Array<Bucket<K, V>> = [];
    let count = 0;
    for (let index = 0; index < rawBuckets.length; index++) {
      const raw = readObject(rawBuckets[index], `layout buckets[${index}]`);
      const localDepth = raw.localDepth;
      if (
        typeof localDepth !== "number" ||
        !Number.isInteger(localDepth) ||
        localDepth < 0 ||
        localDepth > globalDepth
      ) {
        throw new TypeError(`layout buckets[${index}].localDepth is invalid`);
      }
      const rawEntries = readArray(raw, "entries");
      const entries: Array<ExtendibleEntry<K, V>> = [];
      for (let entryIndex = 0; entryIndex < rawEntries.length; entryIndex++) {
        const pair = rawEntries[entryIndex];
        if (!Array.isArray(pair) || pair.length !== 3) {
          throw new TypeError(
            `layout buckets[${index}].entries[${entryIndex}] must be [key, value, hash]`,
          );
        }
        const key = readValue<K>(pair[0], "key");
        const value = readValue<V>(pair[1], "value");
        const hash = pair[2];
        if (typeof hash !== "number" || !Number.isInteger(hash)) {
          throw new TypeError(
            `layout buckets[${index}].entries[${entryIndex}][2] must be an integer`,
          );
        }
        entries.push({ key, value, hash });
        count++;
      }
      buckets.push({ localDepth, entries });
    }
    const directory: Array<Bucket<K, V>> = [];
    for (let index = 0; index < rawDirectory.length; index++) {
      const bucketNumber = rawDirectory[index];
      if (
        typeof bucketNumber !== "number" ||
        !Number.isInteger(bucketNumber) ||
        bucketNumber < 0 ||
        bucketNumber >= buckets.length
      ) {
        throw new TypeError(`layout directory[${index}] is invalid`);
      }
      directory.push(buckets[bucketNumber]);
    }
    this._globalDepth = globalDepth;
    this._directory = directory;
    this._size = count;
  }

  /**
   * O(2^globalDepth + n) from a layout payload; otherwise O(n) re-insertion. Followed by an
   * O(2^globalDepth + n) validate.
   */
  static deserialize<K, V>(
    json: unknown,
    options: ExtendibleHashOptions<K> = {},
  ): ExtendibleHashing<K, V> {
    const parsed = parseMap<K, V>(json, "ExtendibleHashing");
    const bucketSize = readOptionalInteger(parsed.record, "bucketSize");
    if (bucketSize !== undefined && bucketSize <= 0) {
      throw new TypeError("bucketSize must be a positive integer");
    }
    const table = new ExtendibleHashing<K, V>({
      ...options,
      capacity: options.capacity ?? parsed.capacity,
      loadFactor: options.loadFactor ?? parsed.loadFactor,
      ...(bucketSize === undefined ? {} : { bucketSize }),
    });
    if (parsed.record.layout !== undefined) {
      table.restoreLayout(parsed.record);
    } else {
      for (const [key, value] of parsed.entries) {
        table.set(key, value);
      }
    }
    if (table.validate() !== true) {
      throw new TypeError(`Invalid ExtendibleHashing payload: ${table.validate()}`);
    }
    return table;
  }

  private createBucket(localDepth: number): Bucket<K, V> {
    return { localDepth, entries: [] };
  }

  private depthMask(depth: number): number {
    return depth <= 0 ? 0 : (2 ** depth) - 1;
  }

  private bucketForHash(hash: number): Bucket<K, V> {
    return this._directory[hash & (this._directory.length - 1)];
  }

  private canSplit(bucket: Bucket<K, V>): boolean {
    if (bucket.localDepth >= 30 || bucket.entries.length < 2) {
      return false;
    }
    const bit = bucket.localDepth;
    const first = (bucket.entries[0].hash >>> bit) & 1;
    for (let index = 1; index < bucket.entries.length; index++) {
      if (((bucket.entries[index].hash >>> bit) & 1) !== first) {
        return true;
      }
    }
    return false;
  }

  /**
   * Split cost: an O(2^globalDepth) directory scan every time, plus a full directory copy when
   * localDepth == globalDepth; the entries are then partitioned on one bit (O(bucketSize)).
   */
  private splitBucket(bucket: Bucket<K, V>): void {
    const oldDepth = bucket.localDepth;
    const newDepth = oldDepth + 1;
    if (newDepth > this._globalDepth) {
      this._globalDepth = newDepth;
      this._directory = [...this._directory, ...this._directory];
    }
    bucket.localDepth = newDepth;
    const buddy = this.createBucket(newDepth);
    for (let index = 0; index < this._directory.length; index++) {
      if (this._directory[index] === bucket && ((index >>> oldDepth) & 1) === 1) {
        this._directory[index] = buddy;
      }
    }
    const keep: Array<ExtendibleEntry<K, V>> = [];
    const move: Array<ExtendibleEntry<K, V>> = [];
    for (const entry of bucket.entries) {
      if (((entry.hash >>> oldDepth) & 1) === 0) {
        keep.push(entry);
      } else {
        move.push(entry);
      }
    }
    bucket.entries = keep;
    buddy.entries = move;
  }

  /**
   * Merge check on every delete from a bucket with localDepth > 0: O(2^globalDepth) to find the
   * prefix and again to repoint the buddy's slots; merges only when both halves fit in one bucket.
   */
  private tryMerge(bucket: Bucket<K, V>): void {
    if (bucket.localDepth <= 0) {
      return;
    }
    const depth = bucket.localDepth;
    const prefix = this.directoryPrefixOf(bucket);
    if (prefix < 0) {
      return;
    }
    const buddyPrefix = prefix ^ (1 << (depth - 1));
    const buddy = this._directory[buddyPrefix];
    if (
      buddy === undefined ||
      buddy === bucket ||
      buddy.localDepth !== depth
    ) {
      return;
    }
    if (bucket.entries.length + buddy.entries.length > this._bucketSize) {
      return;
    }
    bucket.entries.push(...buddy.entries);
    bucket.localDepth = depth - 1;
    for (let index = 0; index < this._directory.length; index++) {
      if (this._directory[index] === buddy) {
        this._directory[index] = bucket;
      }
    }
  }

  private directoryPrefixOf(bucket: Bucket<K, V>): number {
    for (let index = 0; index < this._directory.length; index++) {
      if (this._directory[index] === bucket) {
        return index & this.depthMask(bucket.localDepth);
      }
    }
    return -1;
  }
}
