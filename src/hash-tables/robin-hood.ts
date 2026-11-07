import { HashTableBase } from "./base.ts";
import { nextPowerOfTwo } from "./hash.ts";
import { parseMap } from "./serialization.ts";
import type { HashOptions } from "./types.ts";

interface RobinEntry<K, V> {
  key: K;
  value: V;
  hash: number;
}

/**
 * Linear-probing table with Robin Hood displacement: on insert, an entry that has probed further
 * than the resident it meets takes the slot and the resident moves on. That equalizes probe
 * distances, so the maximum and variance of probe lengths stay small even near the load cap, and
 * misses terminate early (as soon as a resident is closer to home than the probe has travelled).
 * Deletion is backward-shift: following entries slide one slot toward home, so there are no
 * tombstones, no purge rehashes and no lookup degradation after heavy deleting; this is the
 * open-addressing table to pick for mixed insert/delete workloads. Costs: one entry object per key
 * (more memory than OpenAddressingBase's parallel arrays), and a fresh insert hashes the key twice
 * (once to look it up, once to place it).
 * loadFactor must be < 1 (default 0.75); doubles with an O(n + capacity) rehash that re-hashes
 * every key. Expected O(1) per operation, worst O(capacity). Iteration is a snapshot.
 */
export class RobinHood<K, V> extends HashTableBase<K, V> {
  private _slots: Array<RobinEntry<K, V> | null>;

  constructor(options: HashOptions<K> = {}) {
    super(options);
    this.assertLoadFactor(this._loadFactor, 1);
    this._slots = new Array(this._capacity).fill(null);
  }

  /**
   * Expected O(1): one lookup probe plus a placement probe that may shift a run of poorer entries
   * forward. O(n + capacity) when the insert exceeds capacity * loadFactor and the table doubles.
   */
  set(key: K, value: V): this {
    this.assertStorable(key, value);
    const existing = this.findIndex(key);
    if (existing >= 0) {
      this._slots[existing]!.value = value;
      this.touch();
      return this;
    }
    if (this._size + 1 > this._capacity * this._loadFactor) {
      this.rehash(this._capacity * 2);
    }
    this.place({ key, value, hash: this.hashKey(key) });
    this._size++;
    this.touch();
    return this;
  }

  /**
   * Expected O(1); stops early at an empty slot or at a resident closer to its home than the probe
   * has travelled. Worst O(capacity).
   */
  get(key: K): V | undefined {
    const index = this.findIndex(key);
    return index < 0 ? undefined : this._slots[index]!.value;
  }

  /** Same probe as get(), without reading the value. */
  has(key: K): boolean {
    return this.findIndex(key) >= 0;
  }

  /**
   * Expected O(1): backward-shifts the rest of the cluster by one slot (O(cluster length)); no
   * tombstone is left behind and capacity never shrinks.
   */
  delete(key: K): boolean {
    const index = this.findIndex(key);
    if (index < 0) {
      return false;
    }
    this.removeAt(index);
    this._size--;
    this.touch();
    return true;
  }

  /** O(capacity): reallocates the slot array. */
  clear(): void {
    this._slots = new Array(this._capacity).fill(null);
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

  /** O(capacity) plus a re-hash of every key; diagnostic only. */
  validate(): true | string {
    if (this._slots.length !== this._capacity) {
      return "slot array length does not match capacity";
    }
    let count = 0;
    const keysByHash = new Map<number, K[]>();
    for (let index = 0; index < this._capacity; index++) {
      const entry = this._slots[index];
      if (entry === null) {
        continue;
      }
      if (entry.key === undefined) {
        return `slot ${index} has an undefined key`;
      }
      if (entry.value === undefined) {
        return `slot ${index} has an undefined value`;
      }
      if (entry.hash !== this.hashKey(entry.key)) {
        return `slot ${index} has a stale hash`;
      }
      const distance = this.probeDistance(index, entry.hash);
      if (distance > 0) {
        const previous = (index - 1 + this._capacity) & (this._capacity - 1);
        if (this._slots[previous] === null) {
          return `slot ${index} is separated from its probe cluster`;
        }
      }
      const sameHash = keysByHash.get(entry.hash);
      if (sameHash === undefined) {
        keysByHash.set(entry.hash, [entry.key]);
      } else {
        for (const other of sameHash) {
          if (this.equalKeys(other, entry.key)) {
            return `slot ${index} duplicates a key`;
          }
        }
        sameHash.push(entry.key);
      }
      count++;
    }
    if (count !== this._size) {
      return `size ${this._size} does not match occupied slot count ${count}`;
    }
    if (this._size > this._capacity * this._loadFactor) {
      return "load factor exceeds the configured maximum";
    }
    return true;
  }

  protected collectEntries(): Array<[K, V]> {
    const entries: Array<[K, V]> = [];
    for (const entry of this._slots) {
      if (entry !== null) {
        entries.push([entry.key, entry.value]);
      }
    }
    return entries;
  }

  protected get serializationType(): string {
    return "RobinHood";
  }

  /** O(n + capacity): re-hashes and re-places every entry. */
  protected rehash(capacity: number): void {
    const entries = this.collectEntries();
    this._capacity = nextPowerOfTwo(capacity);
    this._slots = new Array(this._capacity).fill(null);
    this._size = 0;
    for (const [key, value] of entries) {
      this.place({ key, value, hash: this.hashKey(key) });
      this._size++;
    }
    this.touch();
  }

  /** O(n) expected re-insertion via set(), then an O(capacity) validate. */
  static deserialize<K, V>(
    json: unknown,
    options: HashOptions<K> = {},
  ): RobinHood<K, V> {
    const parsed = parseMap<K, V>(json, "RobinHood");
    const table = new RobinHood<K, V>({
      ...options,
      capacity: options.capacity ?? parsed.capacity,
      loadFactor: options.loadFactor ?? parsed.loadFactor,
    });
    for (const [key, value] of parsed.entries) {
      table.set(key, value);
    }
    if (table.validate() !== true) {
      throw new TypeError(`Invalid RobinHood payload: ${table.validate()}`);
    }
    return table;
  }

  private probeDistance(index: number, hash: number): number {
    const home = hash & (this._capacity - 1);
    return (index - home + this._capacity) & (this._capacity - 1);
  }

  private findIndex(key: K): number {
    const hash = this.hashKey(key);
    const mask = this._capacity - 1;
    let index = hash & mask;
    let distance = 0;
    for (let attempt = 0; attempt < this._capacity; attempt++) {
      const entry = this._slots[index];
      if (entry === null) {
        return -1;
      }
      if (distance > this.probeDistance(index, entry.hash)) {
        return -1;
      }
      if (entry.hash === hash && this.equalKeys(entry.key, key)) {
        return index;
      }
      index = (index + 1) & mask;
      distance++;
    }
    return -1;
  }

  private place(entry: RobinEntry<K, V>): void {
    const mask = this._capacity - 1;
    let current = entry;
    let index = current.hash & mask;
    let distance = 0;
    for (let attempt = 0; attempt < this._capacity; attempt++) {
      const existing = this._slots[index];
      if (existing === null) {
        this._slots[index] = current;
        return;
      }
      const existingDistance = this.probeDistance(index, existing.hash);
      if (distance > existingDistance) {
        this._slots[index] = current;
        current = existing;
        distance = existingDistance;
      }
      index = (index + 1) & mask;
      distance++;
    }
    throw new RangeError("hash table is full");
  }

  /**
   * Backward-shift deletion: moves each following displaced entry one slot closer to home until a
   * slot that is empty or already at home is reached, so the cluster stays contiguous.
   */
  private removeAt(index: number): void {
    const mask = this._capacity - 1;
    this._slots[index] = null;
    let hole = index;
    let next = (hole + 1) & mask;
    while (this._slots[next] !== null) {
      const entry = this._slots[next]!;
      if (this.probeDistance(next, entry.hash) === 0) {
        break;
      }
      this._slots[hole] = entry;
      this._slots[next] = null;
      hole = next;
      next = (hole + 1) & mask;
    }
  }
}
