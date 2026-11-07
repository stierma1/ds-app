import { HashTableBase } from "./base.ts";
import { nextPowerOfTwo } from "./hash.ts";
import { parseMap } from "./serialization.ts";
import type { HashOptions } from "./types.ts";

interface RobinEntry<K, V> {
  key: K;
  value: V;
  hash: number;
}

export class RobinHood<K, V> extends HashTableBase<K, V> {
  private _slots: Array<RobinEntry<K, V> | null>;

  constructor(options: HashOptions<K> = {}) {
    super(options);
    this.assertLoadFactor(this._loadFactor, 1);
    this._slots = new Array(this._capacity).fill(null);
  }

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

  get(key: K): V | undefined {
    const index = this.findIndex(key);
    return index < 0 ? undefined : this._slots[index]!.value;
  }

  has(key: K): boolean {
    return this.findIndex(key) >= 0;
  }

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

  clear(): void {
    this._slots = new Array(this._capacity).fill(null);
    this._size = 0;
    this.touch();
  }

  reserve(capacity: number): void {
    this.assertCapacity(capacity);
    this.ensureCapacityForEntries(capacity);
  }

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
