import type { Comparator } from "./comparator.ts";
import { ConcurrentModificationError } from "./errors.ts";
import type { Serializable } from "./serialization.ts";

export type { Comparator } from "./comparator.ts";

/**
 * Minimum surface shared by every container in the library: a size, emptiness and clear, a fresh
 * `toArray()` copy, iteration, an invariant check, and JSON serialization. Implementations document
 * per-method bounds; `size` is always O(1) and `toArray()` always allocates a new array.
 */
export interface Container<T> extends Iterable<T>, Serializable {
  readonly size: number;
  isEmpty(): boolean;
  clear(): void;
  toArray(): T[];
  [Symbol.iterator](): IterableIterator<T>;
  validate(): true | string;
}

/**
 * Single-ended priority queue. `peek`/`pop` return `undefined` only when the queue is empty;
 * iteration order is implementation-defined unless a part document promises otherwise.
 */
export interface PriorityQueue<T> extends Container<T> {
  push(value: T): void;
  pop(): T | undefined;
  peek(): T | undefined;
}

/**
 * Priority queue with a destructive meld. `merge` consumes `other`: it transfers ownership of the
 * elements to the returned queue, and later operations on `other` throw ConsumedError.
 * Implementations that cannot meld in their documented bound throw UnsupportedError.
 */
export interface MeldablePriorityQueue<T> extends PriorityQueue<T> {
  merge(other: MeldablePriorityQueue<T>): MeldablePriorityQueue<T>;
}

/**
 * Priority queue with O(1) access to both extremes. `popMin` and `popMax` both remove the last
 * element when only one remains.
 */
export interface DoubleEndedPriorityQueue<T> extends Container<T> {
  push(value: T): void;
  popMin(): T | undefined;
  popMax(): T | undefined;
  peekMin(): T | undefined;
  peekMax(): T | undefined;
}

/** O(1) argument guard; throws TypeError for non-integers. */
export function assertInteger(value: number, name = "index"): void {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TypeError(`${name} must be an integer`);
  }
}

/**
 * O(1) argument guard; throws TypeError for `undefined`, which containers reserve as the "absent"
 * sentinel.
 */
export function assertDefined<T>(
  value: T | undefined,
  name = "value",
): asserts value is T {
  if (value === undefined) {
    throw new TypeError(`${name} must not be undefined`);
  }
}

/** O(1) bounds guard; throws RangeError outside [min, maxInclusive]. */
export function assertInRange(
  value: number,
  min: number,
  maxInclusive: number,
  name = "index",
): void {
  if (value < min || value > maxInclusive) {
    throw new RangeError(`${name} is out of range`);
  }
}

/** O(1) type guard for comparator arguments. */
export function assertComparator<T>(compare: Comparator<T>): void {
  if (typeof compare !== "function") {
    throw new TypeError("Comparator must be a function");
  }
}

/**
 * Base class for the array, list, and set containers: tracks `_size` and a monotonically increasing
 * `_version` that every mutation bumps via `touch()`.
 *
 * The version drives the fail-fast snapshot-iterator protocol: an iterator records the version when
 * it is created and throws ConcurrentModificationError on its next `next()` call after any
 * mutation. Subclasses that iterate via `snapshotIterator(this.toArray())` therefore pay an O(n)
 * copy up front when iteration begins, in exchange for iteration that is immune to the backing
 * store being rebuilt or resized underneath it.
 */
export abstract class ContainerBase<T> implements Container<T> {
  protected _size = 0;
  protected _version = 0;

  /** O(1): cached count, never recomputed from the backing store. */
  get size(): number {
    return this._size;
  }

  /**
   * O(1): mutation counter that snapshot iterators compare against to detect concurrent
   * modification.
   */
  get version(): number {
    return this._version;
  }

  /** O(1). */
  isEmpty(): boolean {
    return this._size === 0;
  }

  abstract clear(): void;
  abstract toArray(): T[];
  abstract [Symbol.iterator](): IterableIterator<T>;
  abstract validate(): true | string;
  abstract serialize(): string;

  /**
   * O(1): bumps the version so every live snapshot iterator throws on its next step. Called once
   * per public mutation.
   */
  protected touch(): void {
    this._version++;
  }

  /**
   * O(1) to create (the caller has already paid O(n) to build `values`) and O(1) per step. Yields
   * from the supplied array, so later mutations are not reflected, but each `next()` first compares
   * the container version with the one captured here and throws ConcurrentModificationError if they
   * differ. The iterator is its own iterable, so it can be consumed once by a for-of loop.
   */
  protected snapshotIterator<U>(values: U[]): IterableIterator<U> {
    const container = this;
    const expected = this._version;
    let index = 0;
    const iterator: IterableIterator<U> = {
      next(): IteratorResult<U> {
        if (container._version !== expected) {
          throw new ConcurrentModificationError();
        }
        if (index >= values.length) {
          return { done: true, value: undefined };
        }
        return { done: false, value: values[index++] };
      },
      [Symbol.iterator]() {
        return iterator;
      },
    };
    return iterator;
  }
}

/**
 * Cross-module merge hook. A container that can hand its elements to a merge in another module
 * implements this method: it returns every stored element (in any order) and marks itself
 * consumed, so later operations throw ConsumedError. A merge that can only meet its documented
 * bound for its own implementation throws UnsupportedError instead of calling this.
 */
export const takeForMerge: unique symbol = Symbol.for("ds-app.takeForMerge");

/** A container that supports {@link takeForMerge}. */
export interface MergeSource<T> {
  readonly compare: Comparator<T>;
  [takeForMerge](): T[];
}

/** O(1): true when `value` implements the {@link takeForMerge} protocol. */
export function isMergeSource<T>(value: unknown): value is MergeSource<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Partial<MergeSource<T>>)[takeForMerge] === "function"
  );
}

/**
 * O(1) merge guard shared by every meldable queue: rejects self-merge and a comparator that is
 * not the same function (melding two orders silently corrupts heap order).
 */
export function assertMergeCompatible<T>(
  self: { readonly compare: Comparator<T> },
  other: { readonly compare?: Comparator<T> },
): void {
  if ((other as unknown) === self) {
    throw new TypeError("cannot merge a heap with itself");
  }
  if (other.compare !== self.compare) {
    throw new TypeError("cannot merge heaps that use different comparators");
  }
}
