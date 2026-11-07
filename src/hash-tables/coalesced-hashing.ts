import { readArray, readObject, readValue } from "../core/index.ts";
import type { SerializedRecord } from "../core/index.ts";
import { HashTableBase } from "./base.ts";
import { nextPowerOfTwo } from "./hash.ts";
import { parseMap, serializeMap } from "./serialization.ts";
import type { HashOptions } from "./types.ts";

const EMPTY = 0;
const OCCUPIED = 1;
const DELETED = 2;

export class CoalescedHashing<K, V> extends HashTableBase<K, V> {
  private _states: Uint8Array;
  private _keys: Array<K | undefined>;
  private _values: Array<V | undefined>;
  private _hashes: number[];
  private _next: Int32Array;
  private _deleted = 0;
  private _freeCursor = 0;

  constructor(options: HashOptions<K> = {}) {
    super(options);
    this._states = new Uint8Array(this._capacity);
    this._keys = new Array(this._capacity);
    this._values = new Array(this._capacity);
    this._hashes = new Array(this._capacity).fill(0);
    this._next = new Int32Array(this._capacity).fill(-1);
  }

  set(key: K, value: V): this {
    this.assertStorable(key, value);
    if (this._size + this._deleted + 1 > this._capacity * this._loadFactor) {
      this.rehash(
        this._size + 1 > this._capacity * this._loadFactor
          ? this._capacity * 2
          : this._capacity,
      );
    }
    const hash = this.hashKey(key);
    const home = hash & (this._capacity - 1);
    if (this._states[home] === EMPTY) {
      this.place(home, key, value, hash);
      this._next[home] = -1;
      this._size++;
      this.touch();
      return this;
    }
    let previous = -1;
    let index = home;
    while (index !== -1) {
      if (
        this._states[index] === OCCUPIED &&
        this._hashes[index] === hash &&
        this.equalKeys(this._keys[index] as K, key)
      ) {
        this._values[index] = value;
        this.touch();
        return this;
      }
      previous = index;
      index = this._next[index];
    }
    if (this._states[home] === DELETED) {
      const next = this._next[home];
      this.place(home, key, value, hash);
      this._next[home] = next;
      this._deleted--;
      this._size++;
      this.touch();
      return this;
    }
    const slot = this.findFreeSlot();
    if (slot < 0) {
      this.rehash(this._capacity * 2);
      return this.set(key, value);
    }
    this.place(slot, key, value, hash);
    this._next[slot] = -1;
    this._next[previous] = slot;
    this._size++;
    this.touch();
    return this;
  }

  get(key: K): V | undefined {
    const hash = this.hashKey(key);
    let index = hash & (this._capacity - 1);
    while (index !== -1) {
      if (this._states[index] === EMPTY) {
        return undefined;
      }
      if (
        this._states[index] === OCCUPIED &&
        this._hashes[index] === hash &&
        this.equalKeys(this._keys[index] as K, key)
      ) {
        return this._values[index];
      }
      index = this._next[index];
    }
    return undefined;
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: K): boolean {
    const hash = this.hashKey(key);
    let index = hash & (this._capacity - 1);
    while (index !== -1) {
      if (this._states[index] === EMPTY) {
        return false;
      }
      if (
        this._states[index] === OCCUPIED &&
        this._hashes[index] === hash &&
        this.equalKeys(this._keys[index] as K, key)
      ) {
        this._states[index] = DELETED;
        this._keys[index] = undefined;
        this._values[index] = undefined;
        this._size--;
        this._deleted++;
        this.touch();
        if (this._deleted > this._size && this._deleted > 16) {
          this.rehash(this._capacity);
        }
        return true;
      }
      index = this._next[index];
    }
    return false;
  }

  clear(): void {
    this.reset(this._capacity);
    this._size = 0;
    this._deleted = 0;
    this.touch();
  }

  reserve(capacity: number): void {
    this.assertCapacity(capacity);
    this.ensureCapacityForEntries(capacity);
  }

  validate(): true | string {
    if (this._states.length !== this._capacity) {
      return "slot array length does not match capacity";
    }
    let occupied = 0;
    let deleted = 0;
    const keysByHash = new Map<number, K[]>();
    for (let index = 0; index < this._capacity; index++) {
      const state = this._states[index];
      if (state === DELETED) {
        deleted++;
        continue;
      }
      if (state === EMPTY) {
        continue;
      }
      if (state !== OCCUPIED) {
        return `slot ${index} has an invalid state`;
      }
      const key = this._keys[index];
      if (key === undefined) {
        return `slot ${index} has an undefined key`;
      }
      if (this._values[index] === undefined) {
        return `slot ${index} has an undefined value`;
      }
      if (this._hashes[index] !== this.hashKey(key)) {
        return `slot ${index} has a stale hash`;
      }
      const sameHash = keysByHash.get(this._hashes[index]);
      if (sameHash === undefined) {
        keysByHash.set(this._hashes[index], [key]);
      } else {
        for (const other of sameHash) {
          if (this.equalKeys(other, key)) {
            return `slot ${index} duplicates a key`;
          }
        }
        sameHash.push(key);
      }
      occupied++;
    }
    if (occupied !== this._size) {
      return `size ${this._size} does not match occupied slot count ${occupied}`;
    }
    if (deleted !== this._deleted) {
      return "deleted slot count is inconsistent";
    }
    for (let index = 0; index < this._capacity; index++) {
      if (this._states[index] !== OCCUPIED) {
        continue;
      }
      const home = this._hashes[index] & (this._capacity - 1);
      if (this._states[home] === EMPTY) {
        return `slot ${index} has an empty home slot`;
      }
      let current = home;
      let steps = 0;
      let found = false;
      while (current !== -1) {
        if (current < 0 || current >= this._capacity) {
          return `chain from ${home} points outside the table`;
        }
        if (this._states[current] === EMPTY) {
          return `chain from ${home} reaches an empty slot`;
        }
        if (current === index) {
          found = true;
          break;
        }
        current = this._next[current];
        steps++;
        if (steps > this._capacity) {
          return `chain from ${home} is cyclic or too long`;
        }
      }
      if (!found) {
        return `slot ${index} is not reachable from its home`;
      }
    }
    if (this._size + this._deleted > this._capacity * this._loadFactor) {
      return "load factor exceeds the configured maximum";
    }
    return true;
  }

  override serialize(): string {
    const links: Array<[number, number]> = [];
    const entries: Array<[number, K, V, number]> = [];
    for (let index = 0; index < this._capacity; index++) {
      if (this._states[index] === EMPTY) {
        continue;
      }
      links.push([index, this._next[index]]);
      if (this._states[index] === OCCUPIED) {
        entries.push([
          index,
          this._keys[index] as K,
          this._values[index] as V,
          this._hashes[index],
        ]);
      }
    }
    return serializeMap(
      "CoalescedHashing",
      this._capacity,
      this._loadFactor,
      this.collectEntries(),
      {
        layout: {
          states: Array.from(this._states),
          freeCursor: this._freeCursor,
          links,
          entries,
        },
      },
    );
  }

  protected restoreLayout(record: SerializedRecord): void {
    const layout = readObject(record.layout, "layout");
    const states = readArray(layout, "states");
    const links = readArray(layout, "links");
    const entries = readArray(layout, "entries");
    const freeCursor = layout.freeCursor;
    if (states.length !== this._capacity) {
      throw new TypeError("layout states length does not match capacity");
    }
    if (
      typeof freeCursor !== "number" ||
      !Number.isInteger(freeCursor) ||
      freeCursor < 0 ||
      freeCursor >= this._capacity
    ) {
      throw new TypeError("layout freeCursor is invalid");
    }
    this.reset(this._capacity);
    this._freeCursor = freeCursor;
    let occupied = 0;
    let deleted = 0;
    for (let index = 0; index < states.length; index++) {
      const state = states[index];
      if (state !== EMPTY && state !== OCCUPIED && state !== DELETED) {
        throw new TypeError(`layout states[${index}] is invalid`);
      }
      this._states[index] = state;
      if (state === OCCUPIED) {
        occupied++;
      } else if (state === DELETED) {
        deleted++;
      }
    }
    const linked = new Set<number>();
    for (let index = 0; index < links.length; index++) {
      const raw = links[index];
      if (!Array.isArray(raw) || raw.length !== 2) {
        throw new TypeError(`layout links[${index}] must be [index, next]`);
      }
      const slot = raw[0];
      const next = raw[1];
      if (
        typeof slot !== "number" ||
        !Number.isInteger(slot) ||
        slot < 0 ||
        slot >= this._capacity
      ) {
        throw new TypeError(`layout links[${index}][0] is out of range`);
      }
      if (this._states[slot] === EMPTY) {
        throw new TypeError(`layout links[${index}] points at an empty slot`);
      }
      if (linked.has(slot)) {
        throw new TypeError(`layout links[${index}] duplicates a slot`);
      }
      linked.add(slot);
      if (
        typeof next !== "number" ||
        !Number.isInteger(next) ||
        next < -1 ||
        next >= this._capacity
      ) {
        throw new TypeError(`layout links[${index}][1] is invalid`);
      }
      this._next[slot] = next;
    }
    let defined = 0;
    for (let index = 0; index < entries.length; index++) {
      const raw = entries[index];
      if (!Array.isArray(raw) || raw.length !== 4) {
        throw new TypeError(`layout entries[${index}] must be [index, key, value, hash]`);
      }
      const slot = raw[0];
      if (
        typeof slot !== "number" ||
        !Number.isInteger(slot) ||
        slot < 0 ||
        slot >= this._capacity
      ) {
        throw new TypeError(`layout entries[${index}][0] is out of range`);
      }
      if (this._states[slot] !== OCCUPIED) {
        throw new TypeError(`layout entries[${index}] points at a non-occupied slot`);
      }
      if (this._keys[slot] !== undefined) {
        throw new TypeError(`layout entries[${index}] duplicates a slot`);
      }
      const hash = raw[3];
      if (typeof hash !== "number" || !Number.isInteger(hash)) {
        throw new TypeError(`layout entries[${index}][3] must be an integer`);
      }
      this._keys[slot] = readValue<K>(raw[1], "key");
      this._values[slot] = readValue<V>(raw[2], "value");
      this._hashes[slot] = hash;
      defined++;
    }
    if (defined !== occupied) {
      throw new TypeError("layout does not define every occupied slot");
    }
    if (linked.size !== occupied + deleted) {
      throw new TypeError("layout does not link every non-empty slot");
    }
    this._size = occupied;
    this._deleted = deleted;
  }

  protected collectEntries(): Array<[K, V]> {
    const entries: Array<[K, V]> = [];
    for (let index = 0; index < this._capacity; index++) {
      if (this._states[index] === OCCUPIED) {
        entries.push([this._keys[index] as K, this._values[index] as V]);
      }
    }
    return entries;
  }

  protected get serializationType(): string {
    return "CoalescedHashing";
  }

  protected rehash(capacity: number): void {
    const entries = this.collectEntries();
    this._capacity = nextPowerOfTwo(capacity);
    this.reset(this._capacity);
    this._size = 0;
    this._deleted = 0;
    for (const [key, value] of entries) {
      this.insertRaw(key, value);
    }
    this.touch();
  }

  static deserialize<K, V>(
    json: unknown,
    options: HashOptions<K> = {},
  ): CoalescedHashing<K, V> {
    const parsed = parseMap<K, V>(json, "CoalescedHashing");
    const table = new CoalescedHashing<K, V>({
      ...options,
      capacity: options.capacity ?? parsed.capacity,
      loadFactor: options.loadFactor ?? parsed.loadFactor,
    });
    if (parsed.record.layout !== undefined) {
      table.restoreLayout(parsed.record);
    } else {
      for (const [key, value] of parsed.entries) {
        table.set(key, value);
      }
    }
    if (table.validate() !== true) {
      throw new TypeError(`Invalid CoalescedHashing payload: ${table.validate()}`);
    }
    return table;
  }

  private reset(capacity: number): void {
    this._states = new Uint8Array(capacity);
    this._keys = new Array(capacity);
    this._values = new Array(capacity);
    this._hashes = new Array(capacity).fill(0);
    this._next = new Int32Array(capacity).fill(-1);
    this._freeCursor = 0;
  }

  private insertRaw(key: K, value: V): void {
    const hash = this.hashKey(key);
    const home = hash & (this._capacity - 1);
    if (this._states[home] === EMPTY) {
      this.place(home, key, value, hash);
      this._next[home] = -1;
      this._size++;
      return;
    }
    let previous = home;
    while (this._next[previous] !== -1) {
      previous = this._next[previous];
    }
    const slot = this.findFreeSlot();
    if (slot < 0) {
      throw new RangeError("rehash ran out of free slots");
    }
    this.place(slot, key, value, hash);
    this._next[slot] = -1;
    this._next[previous] = slot;
    this._size++;
  }

  private findFreeSlot(): number {
    for (let count = 0; count < this._capacity; count++) {
      const index = this._freeCursor;
      this._freeCursor = (this._freeCursor + 1) % this._capacity;
      if (this._states[index] === EMPTY) {
        return index;
      }
    }
    return -1;
  }

  private place(index: number, key: K, value: V, hash: number): void {
    this._states[index] = OCCUPIED;
    this._keys[index] = key;
    this._values[index] = value;
    this._hashes[index] = hash;
  }
}
