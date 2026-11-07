import { assertDefined, ContainerBase } from "../core/index.ts";
import {
  nextPowerOfTwo,
  resolveCapacity,
  resolveEquals,
  resolveHash,
  resolveLoadFactor,
} from "./hash.ts";
import { serializeMap } from "./serialization.ts";
import type { HashOptions, HashMapLike } from "./types.ts";

/**
 * Shared skeleton for the map-style hash tables in this module. Holds a power-of-two capacity,
 * the maximum load factor and the hash/equals pair; subclasses own the slot or bucket storage.
 * Key lookup compares the cached 32-bit hash first and calls `equals` (default Object.is) only on
 * a hash match, so the cost of a user `equals` is paid once per true collision.
 * Capacity only ever grows: delete and clear never shrink the backing arrays. Every rehash re-runs
 * the hash function on every key (cached hashes are not reused), so growing a table of string keys
 * costs O(total key length), not just O(n).
 * keys/values/entries/[Symbol.iterator] materialize an O(n + capacity) snapshot array up front and
 * throw ConcurrentModificationError if the table is mutated before iteration finishes.
 */
export abstract class HashTableBase<K, V>
  extends ContainerBase<[K, V]>
  implements HashMapLike<K, V> {
  protected _capacity: number;
  protected readonly _loadFactor: number;
  protected readonly _hash: (key: K) => number;
  protected readonly _equals: (a: K, b: K) => boolean;

  protected constructor(options: HashOptions<K> = {}) {
    super();
    this._capacity = resolveCapacity(options.capacity);
    this._loadFactor = resolveLoadFactor(options.loadFactor);
    this._hash = resolveHash(options.hash);
    this._equals = resolveEquals(options.equals);
  }

  /** O(1): current slot/bucket count (always a power of two). */
  get capacity(): number {
    return this._capacity;
  }

  /** O(1): the configured maximum load factor, not the current fill ratio. */
  get loadFactor(): number {
    return this._loadFactor;
  }

  abstract set(key: K, value: V): this;
  abstract get(key: K): V | undefined;
  abstract has(key: K): boolean;
  abstract delete(key: K): boolean;
  abstract override clear(): void;
  abstract reserve(capacity: number): void;
  abstract override validate(): true | string;

  protected abstract collectEntries(): Array<[K, V]>;
  protected abstract get serializationType(): string;

  /** O(n + capacity): allocates the entry snapshot and then a second array of keys. */
  keys(): IterableIterator<K> {
    return this.snapshotIterator(this.toArray().map(([key]) => key));
  }

  /** O(n + capacity): allocates the entry snapshot and then a second array of values. */
  values(): IterableIterator<V> {
    return this.snapshotIterator(this.toArray().map(([, value]) => value));
  }

  /** O(n + capacity) up front; the iterator is a snapshot and mutation mid-iteration throws. */
  entries(): IterableIterator<[K, V]> {
    return this.snapshotIterator(this.toArray());
  }

  /** O(n + capacity): fresh array; every subclass scans all buckets/slots, including empty ones. */
  toArray(): Array<[K, V]> {
    return this.collectEntries();
  }

  /** Alias for entries(). */
  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }

  /** O(n + capacity) to collect entries plus JSON.stringify of the whole payload. */
  serialize(): string {
    return serializeMap(
      this.serializationType,
      this._capacity,
      this._loadFactor,
      this.collectEntries(),
    );
  }

  protected hashKey(key: K): number {
    assertDefined(key, "key");
    return this._hash(key);
  }

  protected equalKeys(a: K, b: K): boolean {
    return this._equals(a, b);
  }

  /**
   * Growth policy behind reserve(): rounds ceil(entries / loadFactor) up to a power of two and
   * rehashes (O(n + capacity)) only if that exceeds the current capacity. Never shrinks.
   */
  protected ensureCapacityForEntries(entries: number): void {
    const needed = nextPowerOfTwo(
      Math.max(1, Math.ceil(entries / this._loadFactor)),
    );
    if (needed > this._capacity) {
      this.rehash(needed);
    }
  }

  protected abstract rehash(capacity: number): void;

  protected assertStorable(key: K, value: V): void {
    assertDefined(key, "key");
    assertDefined(value, "value");
  }

  protected assertCapacity(capacity: number): void {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new TypeError("capacity must be a positive integer");
    }
  }

  protected assertLoadFactor(loadFactor: number, upperBound: number): void {
    if (!(loadFactor > 0) || loadFactor >= upperBound) {
      throw new RangeError(
        `loadFactor must be in (0, ${upperBound}) for this implementation`,
      );
    }
  }
}
