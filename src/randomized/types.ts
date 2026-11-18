import type {
  Comparator,
  MeldablePriorityQueue,
  OrderedMap,
  RandomSource,
} from "../core/index.ts";

/**
 * Ordered dictionary whose balance comes from random choices rather than stored balance metadata.
 * In addition to the `OrderedMap` surface, it exposes the comparator and the random source so a run
 * can be reproduced, inspected, or extended.
 *
 * The same seed and operation sequence produce the same structure and iteration order. Priorities,
 * coin flips, and skip-list levels are internal and are never serialized.
 */
export interface RandomizedMap<K, V = K> extends OrderedMap<K, V> {
  readonly compare: Comparator<K>;
  readonly rng: RandomSource;
}

/** Meldable priority queue whose meld path is chosen by a fair random coin. */
export interface RandomizedMeldableHeap<T> extends MeldablePriorityQueue<T> {
  readonly compare: Comparator<T>;
  readonly rng: RandomSource;
}

/**
 * Constructor options shared by every randomized structure. `rng` accepts a `RandomSource`, an
 * integer seed, or is omitted: an omitted value is seeded from the platform CSPRNG and is recorded
 * on the resulting `SeededRandom`.
 */
export interface RandomOptions {
  rng?: RandomSource | number;
}
