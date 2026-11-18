import type {
  Comparator,
  OrderedMap,
  RandomSource,
} from "../core/index.ts";

/**
 * Opaque handle to one stored entry in a `FingerSearchMap`. A finger is owned by the map that
 * created it; passing it to another map throws `TypeError`, and a finger into a consumed map
 * throws `ConsumedError`. `key` is the key of the entry the finger currently denotes.
 */
export interface Finger<K> {
  readonly key: K;
}

/**
 * Ordered dictionary that remembers a position and can search outward from it. Every operation is
 * otherwise the same as `OrderedMap`; the finger operations add locality-sensitive search.
 *
 * A finger is only a handle: `findFrom` does not move it, `insertAfter` moves it to the inserted
 * entry, and `deleteAt` invalidates it. `join` and `splitAt` are destructive and consume their
 * inputs, invalidating every finger into them.
 */
export interface FingerSearchMap<K, V = K> extends OrderedMap<K, V> {
  readonly compare: Comparator<K>;
  fingerAt(key: K): Finger<K> | undefined;
  findFrom(finger: Finger<K>, key: K): [K, V] | undefined;
  insertAfter(finger: Finger<K>, key: K, value: V): Finger<K>;
  deleteAt(finger: Finger<K>): boolean;
  successorFrom(finger: Finger<K>): [K, V] | undefined;
  predecessorFrom(finger: Finger<K>): [K, V] | undefined;
  distance(a: Finger<K>, b: Finger<K>): number;
  join(other: FingerSearchMap<K, V>): FingerSearchMap<K, V>;
  splitAt(finger: Finger<K>): [FingerSearchMap<K, V>, FingerSearchMap<K, V>];
}

/**
 * Construction options for the randomized implementation. `rng` accepts a random source, an
 * integer seed, or is omitted, in which case the core CSPRNG supplies a seed.
 */
export interface FingerTreeOptions {
  rng?: RandomSource | number;
}
