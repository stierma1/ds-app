import type { Container, SetLike } from "../core/index.ts";

/**
 * Shared constructor options for every hash table in this module.
 * `capacity` is rounded up to a power of two (default 16). `loadFactor` defaults to 0.75 and
 * must be < 1 for the open-addressing tables (LinearProbing, QuadraticProbing, DoubleHashing,
 * RobinHood); CuckooHashing clamps it to 0.95 and ExtendibleHashing ignores it. `hash` must
 * return a finite number and is coerced to uint32 (>>> 0) on every call. `equals` defaults to
 * Object.is and is only consulted after the cached 32-bit hashes match.
 */
export interface HashOptions<K> {
  capacity?: number;
  loadFactor?: number;
  hash?: (key: K) => number;
  equals?: (a: K, b: K) => boolean;
}

/**
 * Common map contract. Every implementation here hashes the key once per call (twice in a few
 * noted cases), compares cached hashes before `equals`, and iterates over an eagerly built
 * O(n + capacity) snapshot that throws ConcurrentModificationError if the table is mutated
 * before the iterator is exhausted.
 */
export interface HashMapLike<K, V> extends Container<[K, V]> {
  set(key: K, value: V): this;
  get(key: K): V | undefined;
  has(key: K): boolean;
  delete(key: K): boolean;
  keys(): IterableIterator<K>;
  values(): IterableIterator<V>;
  entries(): IterableIterator<[K, V]>;
  clear(): void;
  reserve(capacity: number): void;
}

/** Set contract backed by a HashMap; see HashSet for per-operation bounds. */
export interface HashSetLike<E> extends SetLike<E> {
  values(): IterableIterator<E>;
}

/** `seed` selects the multiply-shift hash function; identical seeds give identical layouts. */
export interface UniversalHashOptions<K> extends HashOptions<K> {
  seed?: number;
}

/**
 * `bucketSize` (default 4) entries per bucket; `maxKicks` (default 500) evictions before an
 * insert gives up and parks the entry in the linearly scanned stash.
 */
export interface CuckooHashOptions<K> extends HashOptions<K> {
  bucketSize?: number;
  maxKicks?: number;
}

/** `bucketSize` (default 4): entries a bucket holds before it splits. `loadFactor` is unused. */
export interface ExtendibleHashOptions<K> extends HashOptions<K> {
  bucketSize?: number;
}

/** `seed` drives the multiplier search; a fixed seed gives a deterministic, reproducible layout. */
export interface PerfectHashOptions<K> extends HashOptions<K> {
  seed?: number;
}
