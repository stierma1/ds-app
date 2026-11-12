import {
  assertDefined,
  ContainerBase,
  defaultComparator,
  resolveComparator,
} from "../core/index.ts";
import type { Comparator } from "../core/index.ts";
import { serializeDepq } from "./serialization.ts";
import type { Depq } from "./types.ts";

/** Height in edges of a complete binary tree with `size` nodes; 0 when empty. */
export function completeTreeHeight(size: number): number {
  return size > 0 ? 31 - Math.clz32(size) : 0;
}

/**
 * Shared skeleton for the double-ended priority queues in this module:
 * comparator resolution, snapshot iteration, serialization, and the min/max
 * aliases. Subclasses own the storage and the sifting/deletion logic.
 *
 * Iteration is a snapshot in implementation-defined order and throws
 * ConcurrentModificationError if the queue is mutated mid-iteration. Unlike the
 * meldable heaps, a DEPQ has no destructive merge, so there is no consumed
 * state.
 */
export abstract class DepqBase<T> extends ContainerBase<T> implements Depq<T> {
  readonly compare: Comparator<T>;

  protected constructor(compare?: Comparator<T>) {
    super();
    this.compare = resolveComparator(compare);
  }

  abstract push(value: T): void;
  abstract popMin(): T | undefined;
  abstract popMax(): T | undefined;
  abstract peekMin(): T | undefined;
  abstract peekMax(): T | undefined;
  abstract override validate(): true | string;
  abstract get height(): number;

  /** Storage snapshot in iteration order. */
  protected abstract collectItems(): T[];

  /** Drops every reference held by the storage without touching the version. */
  protected abstract releaseStorage(): void;

  protected abstract get serializationType(): string;

  /** Extra serialized fields appended to the `values` payload. */
  protected serializationPayload(): Record<string, unknown> {
    return {};
  }

  /** O(1): alias for `peekMin`. */
  getMin(): T | undefined {
    return this.peekMin();
  }

  /** O(1): alias for `peekMax`. */
  getMax(): T | undefined {
    return this.peekMax();
  }

  /** O(1): number of stored elements. */
  override get size(): number {
    return this._size;
  }

  /** O(n): fresh array in iteration order. */
  override toArray(): T[] {
    return this.collectItems();
  }

  /** O(n) up front: snapshot of the queue in iteration order. */
  override [Symbol.iterator](): IterableIterator<T> {
    return this.snapshotIterator(this.collectItems());
  }

  /** O(1): drops every element and bumps the version. */
  override clear(): void {
    this.releaseStorage();
    this._size = 0;
    this.touch();
  }

  /** O(n): values in iteration order plus any implementation configuration. */
  override serialize(): string {
    return serializeDepq(
      this.serializationType,
      this.collectItems(),
      this.serializationPayload(),
    );
  }

  /**
   * O(1): rejects `undefined`, and, when the queue uses the default comparator, any value that
   * comparator cannot order (null, plain objects, ...). The check self-compares through
   * defaultComparator so it throws the same TypeError the first real comparison would, even when
   * the value is the queue's only element and would otherwise never be compared.
   */
  protected requireValue(value: T, name = "value"): void {
    assertDefined(value, name);
    if (this.compare === defaultComparator) {
      defaultComparator(value, value);
    }
  }

  /**
   * O(n log n) default: validates every value first so a failed build leaves the
   * queue unchanged, then rebuilds by repeated push. Subclasses override with a
   * cheaper construction when one is available.
   */
  build(values: Iterable<T>): void {
    const items = [...values];
    for (const value of items) {
      this.requireValue(value);
    }
    this.releaseStorage();
    this._size = 0;
    for (const value of items) {
      this.push(value);
    }
    this.touch();
  }
}
