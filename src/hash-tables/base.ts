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

  get capacity(): number {
    return this._capacity;
  }

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

  keys(): IterableIterator<K> {
    return this.snapshotIterator(this.toArray().map(([key]) => key));
  }

  values(): IterableIterator<V> {
    return this.snapshotIterator(this.toArray().map(([, value]) => value));
  }

  entries(): IterableIterator<[K, V]> {
    return this.snapshotIterator(this.toArray());
  }

  toArray(): Array<[K, V]> {
    return this.collectEntries();
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }

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
