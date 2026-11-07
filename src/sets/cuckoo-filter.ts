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

export class CuckooFilter {
  private _bucketCount: number;
  private readonly _bucketSize: number;
  private readonly _fingerprintBits: number;
  private readonly _maxKicks: number;
  private readonly _seed: number;
  private _buckets: Array<Array<FingerprintEntry>>;
  private _stash: FingerprintEntry[] = [];
  private _size = 0;

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

  get size(): number {
    return this._size;
  }

  get buckets(): number {
    return this._bucketCount;
  }

  get fingerprintBits(): number {
    return this._fingerprintBits;
  }

  get loadFactor(): number {
    return this._size / (this._bucketCount * this._bucketSize);
  }

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

  clear(): void {
    this._buckets = this.createBuckets(this._bucketCount);
    this._stash = [];
    this._size = 0;
  }

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
