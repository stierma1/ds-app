import { HashMap } from "./separate-chaining.ts";
import { parseMap } from "./serialization.ts";
import type { HashOptions } from "./types.ts";

/** Marks a deleted slot in the insertion-order array until the next compaction. */
const HOLE: unique symbol = Symbol("hole");

/**
 * HashMap plus an insertion-order array of keys and a second HashMap from key to its slot in that
 * array (re-setting an existing key keeps its position). Fast: get/has stay expected O(1); a new
 * key costs expected O(1) with one extra position insert; delete is expected O(1) amortized: the
 * slot is turned into a hole and the array is compacted (O(n)) only once holes outnumber live
 * keys, so a long run of deletes never degrades to O(n) each. Slow: iteration is O(n) hash
 * lookups (one get per key, in insertion order) instead of a bucket walk, so keys()/entries()/
 * toArray() pay n extra hash computations, and the position map roughly doubles the per-entry
 * memory. Use plain HashMap unless insertion order is required. Iteration is a snapshot (see
 * HashTableBase).
 */
export class OrderedHashMap<K, V> extends HashMap<K, V> {
  private _order: Array<K | typeof HOLE> = [];
  private _positions: HashMap<K, number>;
  private _holes = 0;

  constructor(options: HashOptions<K> = {}) {
    super(options);
    this._positions = new HashMap<K, number>({
      hash: options.hash,
      equals: options.equals,
    });
  }

  /**
   * Expected O(1): an existence check, the underlying insert, and for a new key one append plus
   * one position insert; O(n + capacity) when either table doubles.
   */
  override set(key: K, value: V): this {
    if (super.has(key)) {
      super.set(key, value);
      this.touch();
      return this;
    }
    // The key must be in the order array before the base insert: a resize triggered by that
    // insert rebuilds the table from collectEntries(), which walks the order array.
    const position = this._order.length;
    this._order.push(key);
    try {
      super.set(key, value);
    } catch (error) {
      this._order.pop();
      throw error;
    }
    this._positions.set(key, position);
    this.touch();
    return this;
  }

  /**
   * Expected O(1) amortized: a position lookup, the hash delete, and an O(1) hole marker; the
   * O(n) compaction runs only when holes exceed live keys (and at least 16), so it is paid for
   * by the deletes that created them.
   */
  override delete(key: K): boolean {
    const position = this._positions.get(key);
    if (position === undefined || !super.delete(key)) {
      return false;
    }
    this._order[position] = HOLE;
    this._positions.delete(key);
    this._holes++;
    if (this._holes > 16 && this._holes > this._size) {
      this.compact();
    }
    this.touch();
    return true;
  }

  /** O(capacity) for both tables. */
  override clear(): void {
    super.clear();
    this._positions.clear();
    this._order = [];
    this._holes = 0;
    this.touch();
  }

  /**
   * O(n + capacity) expected: checks the base table, that every live slot is a stored key whose
   * recorded position matches, and that hole and live counts agree with the sizes.
   */
  override validate(): true | string {
    const result = super.validate();
    if (result !== true) {
      return result;
    }
    let live = 0;
    let holes = 0;
    for (let index = 0; index < this._order.length; index++) {
      const key = this._order[index];
      if (key === HOLE) {
        holes++;
        continue;
      }
      live++;
      if (!super.has(key)) {
        return "order contains a key that is not stored";
      }
      if (this._positions.get(key) !== index) {
        return "order contains a key with a stale position";
      }
    }
    if (live !== this._size) {
      return `order holds ${live} live keys but size is ${this._size}`;
    }
    if (holes !== this._holes) {
      return `order holds ${holes} holes but ${this._holes} were counted`;
    }
    if (this._positions.size !== this._size) {
      return `position map has ${this._positions.size} entries but size is ${this._size}`;
    }
    return true;
  }

  /**
   * O(n) expected hash lookups: walks the order array (skipping holes) and re-fetches each value,
   * which is the cost behind keys/values/entries/toArray/serialize.
   */
  protected override collectEntries(): Array<[K, V]> {
    const entries: Array<[K, V]> = [];
    for (const key of this._order) {
      if (key !== HOLE) {
        entries.push([key, super.get(key) as V]);
      }
    }
    return entries;
  }

  protected override get serializationType(): string {
    return "OrderedHashMap";
  }

  /** O(n) expected re-insertion in payload order, then an O(n + capacity) validate. */
  static override deserialize<K, V>(
    json: unknown,
    options: HashOptions<K> = {},
  ): OrderedHashMap<K, V> {
    const parsed = parseMap<K, V>(json, "OrderedHashMap");
    const table = new OrderedHashMap<K, V>({
      ...options,
      capacity: options.capacity ?? parsed.capacity,
      loadFactor: options.loadFactor ?? parsed.loadFactor,
    });
    for (const [key, value] of parsed.entries) {
      table.set(key, value);
    }
    if (table.validate() !== true) {
      throw new TypeError(`Invalid OrderedHashMap payload: ${table.validate()}`);
    }
    return table;
  }

  /** O(n) expected: drops the holes and rewrites every live key's position. */
  private compact(): void {
    const order: Array<K | typeof HOLE> = [];
    for (const key of this._order) {
      if (key !== HOLE) {
        this._positions.set(key, order.length);
        order.push(key);
      }
    }
    this._order = order;
    this._holes = 0;
  }
}
