import {
  parseSerialized,
  readArray,
  readInteger,
  readObject,
  serializeRecord,
} from "../core/index.ts";
import {
  assertPositiveInteger,
  hashString,
  mix32,
  nextPowerOfTwo,
} from "../hash-tables/hash.ts";
import type { CuckooFilterOptions } from "./types.ts";

interface FingerprintEntry {
  fingerprint: number;
  hash: number;
}

/**
 * Cuckoo filter over strings: `buckets` (default 128, rounded up to a power of two) buckets of
 * `bucketSize` (default 4) slots holding `fingerprintBits`-bit fingerprints (default 8; 0 is
 * reserved, so fingerprints lie in [1, 2^f - 1]), plus an overflow stash of max(8, 2% of slots)
 * entries.
 *
 * Fast: O(1) expected add, and has/delete touch only the two candidate buckets plus the stash, so
 * lookups cost O(bucketSize + |stash|). Unlike the Bloom filters it supports delete; with the
 * defaults the false-positive rate is about 2 * 4 / 255, roughly 3%. Slow: capacity is fixed at
 * buckets * bucketSize and never grows. An add whose two candidate buckets are both full first
 * snapshots EVERY bucket (O(buckets * bucketSize)) so it can roll back, then runs the cuckoo kick
 * loop for up to `maxKicks` (default 500) displacements; if the final displaced entry would
 * overflow the stash the snapshot is restored and add returns false, leaving the filter unchanged.
 * The alternate bucket is primary XOR mix32(fingerprint), so it is recomputable from the
 * fingerprint alone during kicks (partial-key cuckoo hashing). Because the stash may hold up to 2%
 * of all slots and is scanned linearly, has/delete on a nearly full large filter grow linearly with
 * table size.
 *
 * Entries are {fingerprint, hash} objects in JS arrays, so memory per slot is far more than f bits;
 * the win is probe cost, not footprint. Deleting a string that was never added can evict another
 * member's identical fingerprint and cause a false negative. Not a ContainerBase: no iteration, no
 * version tracking.
 */
export class CuckooFilter {
  private _bucketCount: number;
  private readonly _bucketSize: number;
  private readonly _fingerprintBits: number;
  private readonly _maxKicks: number;
  private readonly _seed: number;
  private _buckets: Array<Array<FingerprintEntry>>;
  private _stash: FingerprintEntry[] = [];
  private _size = 0;

  /**
   * O(buckets): allocates one empty array per bucket; `buckets` is rounded up to a power of two.
   */
  constructor(options: CuckooFilterOptions = {}) {
    this._bucketCount = nextPowerOfTwo(options.buckets ?? 128);
    this._bucketSize = options.bucketSize ?? 4;
    this._fingerprintBits = options.fingerprintBits ?? 8;
    this._maxKicks = options.maxKicks ?? 500;
    this._seed = options.seed ?? 0x5bd1e995;
    assertPositiveInteger(this._bucketSize, "bucketSize");
    assertPositiveInteger(this._maxKicks, "maxKicks");
    if (
      !Number.isInteger(this._fingerprintBits) ||
      this._fingerprintBits <= 0 ||
      this._fingerprintBits > 32
    ) {
      throw new RangeError("fingerprintBits must be an integer in [1, 32]");
    }
    if (!Number.isInteger(this._seed)) {
      throw new TypeError("seed must be an integer");
    }
    this._buckets = this.createBuckets(this._bucketCount);
  }

  /** O(1). */
  get size(): number {
    return this._size;
  }

  /** O(1): the power-of-two bucket count actually in use. */
  get buckets(): number {
    return this._bucketCount;
  }

  get fingerprintBits(): number {
    return this._fingerprintBits;
  }

  /**
   * O(1): size / (buckets * bucketSize). With bucketSize 4 inserts typically keep succeeding up to
   * a load of about 0.95; beyond that add starts returning false.
   */
  get loadFactor(): number {
    return this._size / (this._bucketCount * this._bucketSize);
  }

  /**
   * O(1) expected when either candidate bucket has room. When both are full: O(buckets *
   * bucketSize) to snapshot the table for rollback, then up to maxKicks O(1) displacements. Returns
   * false, with the filter restored to its prior state, if the displaced entry would overflow the
   * stash (the filter is effectively full). Re-adding an existing value consumes another slot.
   */
  add(value: string): boolean {
    assertString(value);
    const hash = this.hashValue(value);
    const entry: FingerprintEntry = {
      fingerprint: this.fingerprint(hash),
      hash,
    };
    const candidatesFull =
      this._buckets[this.primaryIndex(hash)].length >= this._bucketSize &&
      this._buckets[this.altIndex(hash, entry.fingerprint)].length >= this._bucketSize;
    const buckets = candidatesFull
      ? this._buckets.map((bucket) => bucket.slice())
      : null;
    const stash = candidatesFull ? this._stash.slice() : null;
    const displaced = this.insertEntry(entry);
    if (displaced !== null) {
      this._stash.push(displaced);
    }
    if (this._stash.length > this.maxStash) {
      if (buckets !== null && stash !== null) {
        this._buckets = buckets;
        this._stash = stash;
      }
      return false;
    }
    this._size++;
    return true;
  }

  /**
   * O(bucketSize + |stash|): scans the two candidate buckets and the stash for the fingerprint. No
   * false negatives; false positives at roughly 2 * bucketSize / (2^fingerprintBits - 1).
   */
  has(value: string): boolean {
    assertString(value);
    const hash = this.hashValue(value);
    const fingerprint = this.fingerprint(hash);
    for (const bucket of [
      this._buckets[this.primaryIndex(hash)],
      this._buckets[this.altIndex(hash, fingerprint)],
    ]) {
      for (const entry of bucket) {
        if (entry.fingerprint === fingerprint) {
          return true;
        }
      }
    }
    for (const entry of this._stash) {
      if (entry.fingerprint === fingerprint) {
        return true;
      }
    }
    return false;
  }

  /**
   * O(bucketSize + |stash|): removes the first matching fingerprint from either candidate bucket or
   * the stash. Returns false when absent; deleting a never-added value can remove another member's
   * matching fingerprint.
   */
  delete(value: string): boolean {
    assertString(value);
    const hash = this.hashValue(value);
    const fingerprint = this.fingerprint(hash);
    for (const index of [
      this.primaryIndex(hash),
      this.altIndex(hash, fingerprint),
    ]) {
      const bucket = this._buckets[index];
      for (let position = 0; position < bucket.length; position++) {
        if (bucket[position].fingerprint === fingerprint) {
          bucket.splice(position, 1);
          this._size--;
          return true;
        }
      }
    }
    for (let position = 0; position < this._stash.length; position++) {
      if (this._stash[position].fingerprint === fingerprint) {
        this._stash.splice(position, 1);
        this._size--;
        return true;
      }
    }
    return false;
  }

  /** O(buckets): reallocates every bucket array. */
  clear(): void {
    this._buckets = this.createBuckets(this._bucketCount);
    this._stash = [];
    this._size = 0;
  }

  /** O(buckets * bucketSize): re-derives each entry's candidate buckets and recounts. */
  validate(): true | string {
    if (this._buckets.length !== this._bucketCount) {
      return "bucket count does not match configuration";
    }
    if ((this._bucketCount & (this._bucketCount - 1)) !== 0) {
      return "bucket count must be a power of two";
    }
    const maxFingerprint = 2 ** this._fingerprintBits - 1;
    let count = 0;
    for (let index = 0; index < this._buckets.length; index++) {
      const bucket = this._buckets[index];
      if (bucket.length > this._bucketSize) {
        return `bucket ${index} exceeds bucketSize`;
      }
      for (const entry of bucket) {
        if (!Number.isInteger(entry.hash)) {
          return `bucket ${index} contains an invalid hash`;
        }
        if (
          !Number.isInteger(entry.fingerprint) ||
          entry.fingerprint < 1 ||
          entry.fingerprint > maxFingerprint
        ) {
          return `bucket ${index} contains an invalid fingerprint`;
        }
        if (
          index !== this.primaryIndex(entry.hash) &&
          index !== this.altIndex(entry.hash, entry.fingerprint)
        ) {
          return `bucket ${index} contains an entry outside its two candidate buckets`;
        }
        count++;
      }
    }
    if (this._stash.length > this.maxStash) {
      return "stash exceeds its configured bound";
    }
    for (const entry of this._stash) {
      if (!Number.isInteger(entry.hash)) {
        return "stash contains an invalid hash";
      }
      if (
        !Number.isInteger(entry.fingerprint) ||
        entry.fingerprint < 1 ||
        entry.fingerprint > maxFingerprint
      ) {
        return "stash contains an invalid fingerprint";
      }
      count++;
    }
    if (count !== this._size) {
      return `size ${this._size} does not match entry count ${count}`;
    }
    return true;
  }

  /** O(buckets * bucketSize): emits both a flat entry list and the exact bucket/stash layout. */
  serialize(): string {
    return serializeRecord("CuckooFilter", {
      buckets: this._bucketCount,
      bucketSize: this._bucketSize,
      fingerprintBits: this._fingerprintBits,
      maxKicks: this._maxKicks,
      seed: this._seed,
      size: this._size,
      entries: this.collectEntries().map((entry) => [entry.fingerprint, entry.hash]),
      layout: {
        buckets: this._buckets.map((bucket) =>
          bucket.map((entry) => [entry.fingerprint, entry.hash]),
        ),
        stash: this._stash.map((entry) => [entry.fingerprint, entry.hash]),
      },
    });
  }

  /**
   * O(buckets * bucketSize) with a `layout` payload (restored verbatim); without one, every entry
   * is re-inserted through the kick loop, O(entries * maxKicks) worst case.
   */
  static deserialize(json: unknown): CuckooFilter {
    const record = parseSerialized(json, "CuckooFilter");
    const filter = new CuckooFilter({
      buckets: readInteger(record, "buckets"),
      bucketSize: readInteger(record, "bucketSize"),
      fingerprintBits: readInteger(record, "fingerprintBits"),
      maxKicks: readInteger(record, "maxKicks"),
      seed: readInteger(record, "seed"),
    });
    const declaredSize = readInteger(record, "size");
    if (declaredSize < 0) {
      throw new TypeError("size must be non-negative");
    }
    const entries = readArray(record, "entries");
    const restored: FingerprintEntry[] = [];
    for (let index = 0; index < entries.length; index++) {
      const pair = entries[index];
      if (!Array.isArray(pair) || pair.length !== 2) {
        throw new TypeError(`entries[${index}] must be a [fingerprint, hash] pair`);
      }
      const fingerprint = pair[0];
      const hash = pair[1];
      if (!Number.isInteger(fingerprint) || !Number.isInteger(hash)) {
        throw new TypeError(`entries[${index}] must contain integers`);
      }
      restored.push({ fingerprint, hash });
    }
    if (record.layout !== undefined) {
      filter.restoreLayout(record);
      if (filter.size !== declaredSize) {
        throw new TypeError("size does not match the serialized layout");
      }
    } else {
      if (declaredSize !== restored.length) {
        throw new TypeError("size does not match the serialized entries");
      }
      filter.restore(restored);
      filter._size = restored.length;
    }
    if (filter.validate() !== true) {
      throw new TypeError(`Invalid CuckooFilter payload: ${filter.validate()}`);
    }
    return filter;
  }

  private restoreLayout(record: Record<string, unknown>): void {
    const layout = readObject(record.layout, "layout");
    const rawBuckets = readArray(layout, "buckets");
    const rawStash = readArray(layout, "stash");
    if (rawBuckets.length !== this._bucketCount) {
      throw new TypeError("layout bucket count does not match configuration");
    }
    const buckets: Array<Array<FingerprintEntry>> = [];
    let count = 0;
    for (let index = 0; index < rawBuckets.length; index++) {
      const rawBucket = rawBuckets[index];
      if (!Array.isArray(rawBucket)) {
        throw new TypeError(`layout buckets[${index}] must be an array`);
      }
      if (rawBucket.length > this._bucketSize) {
        throw new TypeError(`layout buckets[${index}] exceeds bucketSize`);
      }
      const bucket: FingerprintEntry[] = [];
      for (let position = 0; position < rawBucket.length; position++) {
        bucket.push(this.restoreEntry(rawBucket[position], `layout buckets[${index}][${position}]`));
        count++;
      }
      buckets.push(bucket);
    }
    const stash: FingerprintEntry[] = [];
    for (let index = 0; index < rawStash.length; index++) {
      stash.push(this.restoreEntry(rawStash[index], `layout stash[${index}]`));
      count++;
    }
    this._buckets = buckets;
    this._stash = stash;
    this._size = count;
  }

  private restoreEntry(raw: unknown, name: string): FingerprintEntry {
    if (!Array.isArray(raw) || raw.length !== 2) {
      throw new TypeError(`${name} must be [fingerprint, hash]`);
    }
    const fingerprint = raw[0];
    const hash = raw[1];
    if (!Number.isInteger(fingerprint) || !Number.isInteger(hash)) {
      throw new TypeError(`${name} must contain integers`);
    }
    return { fingerprint, hash };
  }

  private createBuckets(count: number): Array<Array<FingerprintEntry>> {
    return Array.from({ length: count }, () => []);
  }

  private hashValue(value: string): number {
    return mix32(hashString(value) ^ this._seed);
  }

  private fingerprint(hash: number): number {
    const range = 2 ** this._fingerprintBits - 1;
    return ((hash >>> 0) % range) + 1;
  }

  private primaryIndex(hash: number): number {
    return hash & (this._bucketCount - 1);
  }

  private altIndex(hash: number, fingerprint: number): number {
    const primary = this.primaryIndex(hash);
    const mask = this._bucketCount - 1;
    let alternate = (primary ^ (mix32(fingerprint) & mask)) & mask;
    if (alternate === primary && this._bucketCount > 1) {
      alternate = (primary ^ 1) & mask;
    }
    return alternate;
  }

  /**
   * Design note: the kick loop alternates between an entry's primary and alternate bucket for at
   * most maxKicks steps, picking the victim slot from the hash rather than at random so results are
   * deterministic for a given seed. Returns the final homeless entry (sent to the stash) or null.
   */
  private insertEntry(entry: FingerprintEntry): FingerprintEntry | null {
    let current = entry;
    let useSecond = (current.hash & 1) === 1;
    for (let kick = 0; kick < this._maxKicks; kick++) {
      const index = useSecond
        ? this.altIndex(current.hash, current.fingerprint)
        : this.primaryIndex(current.hash);
      const bucket = this._buckets[index];
      if (bucket.length < this._bucketSize) {
        bucket.push(current);
        return null;
      }
      const victimIndex = (current.hash >>> 8) % bucket.length;
      const victim = bucket[victimIndex];
      bucket[victimIndex] = current;
      current = victim;
      useSecond = !useSecond;
    }
    return current;
  }

  private collectEntries(): FingerprintEntry[] {
    const entries: FingerprintEntry[] = [];
    for (const bucket of this._buckets) {
      for (const entry of bucket) {
        entries.push(entry);
      }
    }
    entries.push(...this._stash);
    return entries;
  }

  /**
   * Design note: the stash absorbs kick-loop failures up to max(8, 2% of slots). It is scanned
   * linearly by has/delete, so this bound is what keeps lookups near O(bucketSize) until the filter
   * is nearly full.
   */
  private get maxStash(): number {
    return Math.max(8, Math.floor(this._bucketCount * this._bucketSize * 0.02));
  }

  private restore(entries: FingerprintEntry[]): void {
    for (const entry of entries) {
      const displaced = this.insertEntry(entry);
      if (displaced !== null) {
        this._stash.push(displaced);
      }
    }
  }
}

function assertString(value: string): void {
  if (typeof value !== "string") {
    throw new TypeError("value must be a string");
  }
}
