import {
  assertDefined,
  ContainerBase,
  ConsumedError,
  resolveComparator,
} from "../core/index.ts";
import type { Comparator } from "../core/index.ts";
import { serializeHeap } from "./serialization.ts";
import type { Heap } from "./types.ts";

/** Height in edges of a complete d-ary tree with `size` nodes; O(log_d size) with no allocation. */
export function implicitHeight(size: number, arity: number): number {
  let height = 0;
  let capacity = 1;
  while (capacity < size) {
    capacity = capacity * arity + 1;
    height++;
  }
  return height;
}

/**
 * Shared skeleton for the heaps in this module: comparator resolution, live/consumed state,
 * snapshot iteration, bulk-build-by-push, and serialization. Subclasses own the storage and the
 * per-operation sifting/melding logic.
 *
 * A heap is consumed by merge(): the owning heap marks the argument dead, releases its storage, and
 * from then on every public operation on the argument throws ConsumedError. Iteration is a snapshot
 * and throws ConcurrentModificationError if the heap is mutated mid-iteration.
 */
export abstract class HeapBase<T> extends ContainerBase<T> implements Heap<T> {
  readonly compare: Comparator<T>;
  private _consumed = false;

  protected constructor(compare?: Comparator<T>) {
    super();
    this.compare = resolveComparator(compare);
  }

  abstract push(value: T): void;
  abstract pop(): T | undefined;
  abstract peek(): T | undefined;
  abstract merge(other: Heap<T>): Heap<T>;
  abstract override validate(): true | string;
  abstract get height(): number;

  /** Storage snapshot in iteration order; must not check live state (extractForMerge does). */
  protected abstract collectItems(): T[];

  /** Drops every reference held by the storage without touching the version counter. */
  protected abstract releaseStorage(): void;

  protected abstract get serializationType(): string;

  /** Extra serialized fields (arity, configuration) appended to the `values` payload. */
  protected serializationPayload(): Record<string, unknown> {
    return {};
  }

  /**
   * O(n): copies the elements one by one in iteration order, then clears and re-pushes them. Meldable
   * implementations push in O(1) each, so their effective cost is O(n); array heaps override this
   * with Floyd's bottom-up construction.
   */
  build(values: Iterable<T>): void {
    this.assertLive();
    const items = [...values];
    for (const value of items) {
      assertDefined(value);
    }
    this.releaseStorage();
    this._size = 0;
    for (const value of items) {
      this.push(value);
    }
    this.touch();
  }

  /** O(1): number of stored elements. */
  override get size(): number {
    return this._size;
  }

  /** O(n): fresh array in iteration order. */
  override toArray(): T[] {
    this.assertLive();
    return this.collectItems();
  }

  /** O(n) up front: snapshot of the heap in iteration order; mutation mid-iteration throws. */
  override [Symbol.iterator](): IterableIterator<T> {
    this.assertLive();
    return this.snapshotIterator(this.collectItems());
  }

  /** O(1): drops every element and bumps the version. */
  override clear(): void {
    this.assertLive();
    this.releaseStorage();
    this._size = 0;
    this.touch();
  }

  /** O(n): values in iteration order plus any implementation configuration. */
  override serialize(): string {
    this.assertLive();
    return serializeHeap(
      this.serializationType,
      this.collectItems(),
      this.serializationPayload(),
    );
  }

  /** O(1) per call: throws ConsumedError after this heap has been merged into another one. */
  protected assertLive(): void {
    if (this._consumed) {
      throw new ConsumedError();
    }
  }

  /** O(1): permanently transfers ownership and releases storage. Idempotent only via assertLive. */
  protected markConsumed(): void {
    this._consumed = true;
    this._size = 0;
    this.releaseStorage();
    this.touch();
  }

  /**
   * O(n): validates and removes every element of `other`. Same-implementation merges can bypass this
   * with a cheaper meld, but every path marks `other` consumed.
   */
  protected extractForMerge(other: Heap<T>): T[] {
    if (other === this) {
      throw new TypeError("cannot merge a heap with itself");
    }
    if (!(other instanceof HeapBase)) {
      const values = other.toArray();
      for (const value of values) {
        assertDefined(value);
      }
      return values;
    }
    other.assertLive();
    const values = other.collectItems();
    other.markConsumed();
    return values;
  }

  protected requireValue(value: T, name = "value"): void {
    assertDefined(value, name);
  }
}
