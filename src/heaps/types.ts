import type {
  Comparator,
  Container,
  MeldablePriorityQueue,
  PriorityQueue,
} from "../core/index.ts";

/**
 * Single-ended heap with bulk construction and an explicit structural height. `merge` is
 * destructive and consumes `other` (see MeldablePriorityQueue); the returned heap owns both sets of
 * elements. `build` replaces the contents rather than adding to them.
 */
export interface Heap<T> extends MeldablePriorityQueue<T> {
  readonly compare: Comparator<T>;
  build(values: Iterable<T>): void;
  readonly height: number;
  merge(other: Heap<T>): Heap<T>;
}

/**
 * Priorities indexed by key. `insert` rejects a comparator-equal duplicate and returns false.
 * `decreaseKey`/`increaseKey` return false when the new key moves in the wrong direction (or would
 * collide with an existing key) and never change the queue in that case.
 */
export interface IndexedPriorityQueue<K, V> extends Container<[K, V]> {
  readonly compare: Comparator<K>;
  insert(key: K, value: V): boolean;
  get(key: K): V | undefined;
  has(key: K): boolean;
  delete(key: K): boolean;
  update(key: K, value: V): boolean;
  decreaseKey(key: K, newKey: K): boolean;
  increaseKey(key: K, newKey: K): boolean;
  peek(): [K, V] | undefined;
  pop(): [K, V] | undefined;
  peekKey(): K | undefined;
}

/**
 * Priority queue for integer keys in `[0, maxKey]` that are popped in non-decreasing order. A push
 * below the last popped key throws RangeError, which is the invariant Dijkstra-style workloads
 * rely on. `key(value)` reads the integer key of a value.
 */
export interface MonotonePriorityQueue<T> extends PriorityQueue<T> {
  readonly key: (value: T) => number;
  readonly maxKey: number;
  decreaseKey(value: T, newKey: number): boolean;
}

/**
 * Event queue ordered by time. `schedule` returns a cancellation id; scheduling before `now`
 * throws RangeError. `advance(t)` sets `now = t` and returns every event with time `<= t` in
 * non-decreasing time order, breaking ties by scheduling order. `peekTime` reports the earliest
 * scheduled time without consuming anything.
 */
export interface TimerQueue<T> extends Container<T> {
  readonly now: number;
  schedule(time: number, value: T): number;
  cancel(id: number): boolean;
  advance(time: number): T[];
  peekTime(): number | undefined;
}

/** Number of children per node; defaults to 4 and must be an integer of at least 2. */
export interface DaryHeapOptions {
  arity?: number;
}

/** Initial calendar geometry. Both values are rounded/validated on construction. */
export interface CalendarQueueOptions {
  bucketCount?: number;
  bucketWidth?: number;
  now?: number;
}

/** Initial wheel geometry. The wheel grows additional levels for far-future events. */
export interface TimingWheelOptions {
  tickSize?: number;
  slots?: number;
  levels?: number;
  now?: number;
}
