import { readArray, readObject, readValue } from "../core/index.ts";
import type { SerializedRecord } from "../core/index.ts";
import { HashTableBase } from "./base.ts";
import { nextPowerOfTwo } from "./hash.ts";
import { parseMap, serializeMap } from "./serialization.ts";
import type { HashOptions } from "./types.ts";

const EMPTY = 0;
const OCCUPIED = 1;
const TOMBSTONE = 2;

/**
 * Open-addressing base shared by LinearProbing, QuadraticProbing and DoubleHashing. Storage is
 * four parallel arrays (Uint8Array states, keys, values, hashes) with no per-entry objects, so it
 * is the most compact, cache-friendly map family here; subclasses only supply the probe rule.
 * loadFactor must be < 1 (default 0.75). Deletion writes a tombstone; tombstones stay in the probe
 * path (get/set/delete skip over them until an EMPTY slot), so a delete-heavy workload lengthens
 * probes until they are purged. Purging is a rehash at the SAME capacity, triggered when (a) set()
 * finds size + tombstones + 1 > capacity * loadFactor while live entries still fit, or (b) delete()
 * leaves more than max(16, size) tombstones; growth doubles the capacity. Either rehash is
 * O(n + capacity) and recomputes every key's hash.
 * Expected O(1) per operation at the default load; worst case is a probe over all `capacity` slots
 * (every probe rule here is a full permutation of the power-of-two table, so a free slot is always
 * found below load factor 1). Iteration is a snapshot (see HashTableBase).
 */
export abstract class OpenAddressingBase<K, V> extends HashTableBase<K, V> {
  protected _states: Uint8Array;
  protected _keys: Array<K | undefined>;
  protected _values: Array<V | undefined>;
  protected _hashes: number[];
  protected _tombstones = 0;

  protected constructor(options: HashOptions<K> = {}) {
    super(options);
    this.assertLoadFactor(this._loadFactor, 1);
    this._states = new Uint8Array(this._capacity);
    this._keys = new Array(this._capacity);
    this._values = new Array(this._capacity);
    this._hashes = new Array(this._capacity).fill(0);
  }

  protected abstract probeIndex(
    hash: number,
    attempt: number,
    capacity: number,
    mask: number,
  ): number;

  protected abstract override get serializationType(): string;

  /**
   * Expected O(1): probes past tombstones to rule out an existing key, then reuses the first
   * tombstone seen. O(n + capacity) when the pre-check triggers a purge or doubling rehash.
   */
  set(key: K, value: V): this {
    this.assertStorable(key, value);
    if (this._size + this._tombstones + 1 > this._capacity * this._loadFactor) {
      this.rehash(
        this._size + 1 > this._capacity * this._loadFactor
          ? this._capacity * 2
          : this._capacity,
      );
    }
    const hash = this.hashKey(key);
    const mask = this._capacity - 1;
    let firstDeleted = -1;
    for (let attempt = 0; attempt < this._capacity; attempt++) {
      const index = this.probeIndex(hash, attempt, this._capacity, mask);
      const state = this._states[index];
      if (state === OCCUPIED) {
        if (this._hashes[index] === hash && this.equalKeys(this._keys[index] as K, key)) {
          this._values[index] = value;
          this.touch();
          return this;
        }
        continue;
      }
      if (state === TOMBSTONE) {
        if (firstDeleted < 0) {
          firstDeleted = index;
        }
        continue;
      }
      const target = firstDeleted >= 0 ? firstDeleted : index;
      if (firstDeleted >= 0) {
        this._tombstones--;
      }
      this._states[target] = OCCUPIED;
      this._keys[target] = key;
      this._values[target] = value;
      this._hashes[target] = hash;
      this._size++;
      this.touch();
      return this;
    }
    if (firstDeleted >= 0) {
      this._states[firstDeleted] = OCCUPIED;
      this._keys[firstDeleted] = key;
      this._values[firstDeleted] = value;
      this._hashes[firstDeleted] = hash;
      this._tombstones--;
      this._size++;
      this.touch();
      return this;
    }
    throw new RangeError("hash table probe sequence failed to find a free slot");
  }

  /**
   * Expected O(1); probes until an EMPTY slot, so tombstones extend unsuccessful lookups. Worst
   * O(capacity).
   */
  get(key: K): V | undefined {
    const hash = this.hashKey(key);
    const mask = this._capacity - 1;
    for (let attempt = 0; attempt < this._capacity; attempt++) {
      const index = this.probeIndex(hash, attempt, this._capacity, mask);
      const state = this._states[index];
      if (state === EMPTY) {
        return undefined;
      }
      if (
        state === OCCUPIED &&
        this._hashes[index] === hash &&
        this.equalKeys(this._keys[index] as K, key)
      ) {
        return this._values[index];
      }
    }
    return undefined;
  }

  /** Same cost as get(). */
  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * Expected O(1): marks a tombstone without shifting anything. Triggers an O(n + capacity)
   * same-capacity rehash once tombstones exceed max(16, size).
   */
  delete(key: K): boolean {
    const hash = this.hashKey(key);
    const mask = this._capacity - 1;
    for (let attempt = 0; attempt < this._capacity; attempt++) {
      const index = this.probeIndex(hash, attempt, this._capacity, mask);
      const state = this._states[index];
      if (state === EMPTY) {
        return false;
      }
      if (
        state === OCCUPIED &&
        this._hashes[index] === hash &&
        this.equalKeys(this._keys[index] as K, key)
      ) {
        this._states[index] = TOMBSTONE;
        this._keys[index] = undefined;
        this._values[index] = undefined;
        this._hashes[index] = 0;
        this._size--;
        this._tombstones++;
        this.touch();
        if (this._tombstones > this._size && this._tombstones > 16) {
          this.rehash(this._capacity);
        }
        return true;
      }
    }
    return false;
  }

  /** O(capacity): reallocates all four slot arrays at the current capacity. */
  clear(): void {
    this.allocate(this._capacity);
    this._size = 0;
    this._tombstones = 0;
    this.touch();
  }

  /**
   * `capacity` is an entry count: one O(n + newCapacity) rehash (which also purges tombstones) if
   * that many entries would exceed the load factor, otherwise a no-op. Never shrinks.
   */
  reserve(capacity: number): void {
    this.assertCapacity(capacity);
    this.ensureCapacityForEntries(capacity);
  }

  /** O(capacity + n * probe length) and re-hashes every key; diagnostic only. */
  validate(): true | string {
    if (this._states.length !== this._capacity) {
      return "slot array length does not match capacity";
    }
    let occupied = 0;
    let tombstones = 0;
    const keysByHash = new Map<number, K[]>();
    for (let index = 0; index < this._capacity; index++) {
      const state = this._states[index];
      if (state === TOMBSTONE) {
        tombstones++;
        if (this._keys[index] !== undefined || this._values[index] !== undefined) {
          return `tombstone at ${index} retains an entry`;
        }
        continue;
      }
      if (state === EMPTY) {
        if (this._keys[index] !== undefined || this._values[index] !== undefined) {
          return `empty slot ${index} retains an entry`;
        }
        continue;
      }
      if (state !== OCCUPIED) {
        return `slot ${index} has an invalid state`;
      }
      const key = this._keys[index];
      const value = this._values[index];
      if (key === undefined) {
        return `slot ${index} has an undefined key`;
      }
      if (value === undefined) {
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
      let found = false;
      for (let attempt = 0; attempt < this._capacity; attempt++) {
        const probe = this.probeIndex(
          this._hashes[index],
          attempt,
          this._capacity,
          this._capacity - 1,
        );
        if (this._states[probe] === EMPTY) {
          break;
        }
        if (
          this._states[probe] === OCCUPIED &&
          this._hashes[probe] === this._hashes[index] &&
          this.equalKeys(this._keys[probe] as K, key)
        ) {
          found = true;
          break;
        }
      }
      if (!found) {
        return `slot ${index} is not reachable by its probe sequence`;
      }
      occupied++;
    }
    if (occupied !== this._size) {
      return `size ${this._size} does not match occupied slot count ${occupied}`;
    }
    if (tombstones !== this._tombstones) {
      return "tombstone count is inconsistent";
    }
    if (occupied + tombstones > this._capacity * this._loadFactor) {
      return "load factor exceeds the configured maximum";
    }
    return true;
  }

  /**
   * O(capacity + n): the payload includes the full state array, so its size tracks capacity rather
   * than n.
   */
  override serialize(): string {
    const slots: Array<[number, K, V, number]> = [];
    for (let index = 0; index < this._capacity; index++) {
      if (this._states[index] === OCCUPIED) {
        slots.push([
          index,
          this._keys[index] as K,
          this._values[index] as V,
          this._hashes[index],
        ]);
      }
    }
    return serializeMap(
      this.serializationType,
      this._capacity,
      this._loadFactor,
      this.collectEntries(),
      {
        layout: {
          states: Array.from(this._states),
          slots,
        },
      },
    );
  }

  protected restoreLayout(record: SerializedRecord): void {
    const layout = readObject(record.layout, "layout");
    const states = readArray(layout, "states");
    const slots = readArray(layout, "slots");
    if (states.length !== this._capacity) {
      throw new TypeError("layout states length does not match capacity");
    }
    this._states = new Uint8Array(this._capacity);
    this._keys = new Array(this._capacity);
    this._values = new Array(this._capacity);
    this._hashes = new Array(this._capacity).fill(0);
    let occupied = 0;
    let tombstones = 0;
    for (let index = 0; index < states.length; index++) {
      const state = states[index];
      if (state !== EMPTY && state !== OCCUPIED && state !== TOMBSTONE) {
        throw new TypeError(`layout states[${index}] is invalid`);
      }
      this._states[index] = state;
      if (state === OCCUPIED) {
        occupied++;
      } else if (state === TOMBSTONE) {
        tombstones++;
      }
    }
    let defined = 0;
    for (let index = 0; index < slots.length; index++) {
      const raw = slots[index];
      if (!Array.isArray(raw) || raw.length !== 4) {
        throw new TypeError(`layout slots[${index}] must be [index, key, value, hash]`);
      }
      const slotIndex = raw[0];
      if (typeof slotIndex !== "number" || !Number.isInteger(slotIndex)) {
        throw new TypeError(`layout slots[${index}][0] must be an integer`);
      }
      if (slotIndex < 0 || slotIndex >= this._capacity) {
        throw new TypeError(`layout slots[${index}][0] is out of range`);
      }
      if (this._states[slotIndex] !== OCCUPIED) {
        throw new TypeError(`layout slots[${index}] points at a non-occupied slot`);
      }
      if (this._keys[slotIndex] !== undefined) {
        throw new TypeError(`layout slots[${index}] duplicates a slot`);
      }
      const key = readValue<K>(raw[1], `layout slots[${index}][1]`);
      const value = readValue<V>(raw[2], `layout slots[${index}][2]`);
      const hash = raw[3];
      if (typeof hash !== "number" || !Number.isInteger(hash)) {
        throw new TypeError(`layout slots[${index}][3] must be an integer`);
      }
      this._keys[slotIndex] = key;
      this._values[slotIndex] = value;
      this._hashes[slotIndex] = hash;
      defined++;
    }
    if (defined !== occupied) {
      throw new TypeError("layout does not define every occupied slot");
    }
    this._size = occupied;
    this._tombstones = tombstones;
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

  /**
   * O(n + capacity): reallocates, drops every tombstone, and re-probes each entry with a freshly
   * computed hash.
   */
  protected rehash(capacity: number): void {
    const entries = this.collectEntries();
    this._capacity = nextPowerOfTwo(capacity);
    this.allocate(this._capacity);
    this._size = 0;
    this._tombstones = 0;
    for (const [key, value] of entries) {
      this.insertRaw(key, value);
    }
    this.touch();
  }

  private allocate(capacity: number): void {
    this._states = new Uint8Array(capacity);
    this._keys = new Array(capacity);
    this._values = new Array(capacity);
    this._hashes = new Array(capacity).fill(0);
  }

  private insertRaw(key: K, value: V): void {
    const hash = this.hashKey(key);
    const mask = this._capacity - 1;
    for (let attempt = 0; attempt < this._capacity; attempt++) {
      const index = this.probeIndex(hash, attempt, this._capacity, mask);
      if (this._states[index] === EMPTY || this._states[index] === TOMBSTONE) {
        this._states[index] = OCCUPIED;
        this._keys[index] = key;
        this._values[index] = value;
        this._hashes[index] = hash;
        this._size++;
        return;
      }
    }
    throw new RangeError("rehash probe sequence failed to find a free slot");
  }
}

/**
 * Probe rule: (hash + attempt) & mask, i.e. the next adjacent slot. Best cache locality of the
 * three but suffers primary clustering: runs of occupied slots merge and probe lengths grow
 * quickly above roughly 0.7 load. Choose it for small tables or low load factors; see RobinHood
 * for a linear probe that bounds the variance and avoids tombstones.
 */
export class LinearProbing<K, V> extends OpenAddressingBase<K, V> {
  constructor(options: HashOptions<K> = {}) {
    super(options);
  }

  protected override probeIndex(
    hash: number,
    attempt: number,
    _capacity: number,
    mask: number,
  ): number {
    return (hash + attempt) & mask;
  }

  protected override get serializationType(): string {
    return "LinearProbing";
  }

  /**
   * O(capacity + n) when the payload carries a layout (slots restored verbatim, no probing);
   * otherwise O(n) expected re-insertion. Always followed by an O(capacity + n * probe) validate.
   */
  static deserialize<K, V>(
    json: unknown,
    options: HashOptions<K> = {},
  ): LinearProbing<K, V> {
    const parsed = parseMap<K, V>(json, "LinearProbing");
    const table = new LinearProbing<K, V>({
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
      throw new TypeError(`Invalid LinearProbing payload: ${table.validate()}`);
    }
    return table;
  }
}

/**
 * Probe rule: (hash + attempt * (attempt + 1) / 2) & mask (triangular numbers). On a power-of-two
 * table this visits every slot exactly once, so inserts cannot fail below load factor 1. Avoids
 * linear probing's primary clustering at the cost of locality; keys with the same home slot still
 * share one sequence (secondary clustering).
 */
export class QuadraticProbing<K, V> extends OpenAddressingBase<K, V> {
  constructor(options: HashOptions<K> = {}) {
    super(options);
  }

  protected override probeIndex(
    hash: number,
    attempt: number,
    _capacity: number,
    mask: number,
  ): number {
    return (hash + ((Math.imul(attempt, attempt + 1) >>> 1))) & mask;
  }

  protected override get serializationType(): string {
    return "QuadraticProbing";
  }

  /**
   * O(capacity + n) from a layout payload; otherwise O(n) expected re-insertion. Always followed by
   * an O(capacity + n * probe) validate.
   */
  static deserialize<K, V>(
    json: unknown,
    options: HashOptions<K> = {},
  ): QuadraticProbing<K, V> {
    const parsed = parseMap<K, V>(json, "QuadraticProbing");
    const table = new QuadraticProbing<K, V>({
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
      throw new TypeError(`Invalid QuadraticProbing payload: ${table.validate()}`);
    }
    return table;
  }
}

/**
 * Probe rule: (hash + attempt * step) & mask with step = ((hash >>> 16) ^ hash) | 1. The odd step
 * is coprime with the power-of-two capacity, so the sequence is a full permutation. Spreads
 * same-home keys onto different sequences (least clustering of the three) but every probe is a
 * cache miss, and because the step is derived from the same 32-bit hash, keys with identical
 * hashes still collide on every probe.
 */
export class DoubleHashing<K, V> extends OpenAddressingBase<K, V> {
  constructor(options: HashOptions<K> = {}) {
    super(options);
  }

  protected override probeIndex(
    hash: number,
    attempt: number,
    _capacity: number,
    mask: number,
  ): number {
    const step = (((hash >>> 16) ^ hash) | 1) >>> 0;
    return (hash + Math.imul(attempt, step)) & mask;
  }

  protected override get serializationType(): string {
    return "DoubleHashing";
  }

  /**
   * O(capacity + n) from a layout payload; otherwise O(n) expected re-insertion. Always followed by
   * an O(capacity + n * probe) validate.
   */
  static deserialize<K, V>(
    json: unknown,
    options: HashOptions<K> = {},
  ): DoubleHashing<K, V> {
    const parsed = parseMap<K, V>(json, "DoubleHashing");
    const table = new DoubleHashing<K, V>({
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
      throw new TypeError(`Invalid DoubleHashing payload: ${table.validate()}`);
    }
    return table;
  }
}
