import {
  assertDefined,
  ContainerBase,
  ConsumedError,
  isMergeSource,
  resolveComparator,
  takeForMerge,
  UnsupportedError,
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
  abstract get height(): number;

  /** O(n): implementation invariants; called by validate() once the heap is known to be live. */
  protected abstract checkInvariants(): true | string;

  /** Storage snapshot in iteration order; must not check live state (callers do). */
  protected abstract collectItems(): T[];

  /** Drops every reference held by the storage without touching the version counter. */
  protected abstract releaseStorage(): void;

  protected abstract get serializationType(): string;

  /** Called by clear() and build() before storage is dropped; heaps with handles retire them. */
  protected invalidateHandles(): void {}

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
    this.invalidateHandles();
    this.releaseStorage();
    this._size = 0;
    for (const value of items) {
      this.push(value);
    }
    this.touch();
  }

  /** O(1): number of stored elements; throws ConsumedError after a merge consumed this heap. */
  override get size(): number {
    this.assertLive();
    return this._size;
  }

  /** O(1): `size === 0`; throws ConsumedError after a merge consumed this heap. */
  override isEmpty(): boolean {
    this.assertLive();
    return this._size === 0;
  }

  /** O(n): heap order, links, size, and indexes; throws ConsumedError on a consumed heap. */
  override validate(): true | string {
    this.assertLive();
    return this.checkInvariants();
  }

  /**
   * O(n): cross-module merge hook (see takeForMerge in core). Hands over every element in
   * iteration order and marks this heap consumed.
   */
  [takeForMerge](): T[] {
    this.assertLive();
    const values = this.collectItems();
    this.markConsumed();
    return values;
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
    this.invalidateHandles();
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
   * Cross-class half of the shared merge rule; the caller has already run assertMergeCompatible
   * and handled the same-class meld. When copying `other`'s m elements still meets this heap's
   * documented merge bound (`copyMeetsBound`), the elements are taken through takeForMerge, which
   * consumes `other` whatever module it comes from. Otherwise, or when `other` does not implement
   * takeForMerge, this throws UnsupportedError before anything is mutated.
   */
  protected takeForeignForMerge(other: Heap<T>, copyMeetsBound: boolean): T[] {
    const name = this.constructor.name;
    if (!copyMeetsBound) {
      throw new UnsupportedError(
        `${name} can only merge another ${name} within its documented merge bound`,
      );
    }
    if (!isMergeSource<T>(other)) {
      throw new UnsupportedError(`${name}.merge requires a heap that implements takeForMerge`);
    }
    const values = other[takeForMerge]();
    for (const value of values) {
      assertDefined(value);
    }
    return values;
  }

  protected requireValue(value: T, name = "value"): void {
    assertDefined(value, name);
  }
}
