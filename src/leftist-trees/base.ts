import {
  assertDefined,
  ContainerBase,
  ConsumedError,
  resolveComparator,
} from "../core/index.ts";
import type { Comparator } from "../core/index.ts";
import { serializeLeftist } from "./serialization.ts";
import type { LeftistHeap } from "./types.ts";

/**
 * Shared skeleton for the leftist-tree implementations: comparator resolution, live/consumed state,
 * snapshot iteration, serialization, and the single-ended aliases of the priority-queue surface.
 *
 * A heap is consumed by merge(): the owner marks the argument dead, releases its storage, and from
 * then on every public operation on the argument throws ConsumedError. Iteration is a snapshot and
 * throws ConcurrentModificationError if the heap is mutated mid-iteration.
 */
export abstract class LeftistHeapBase<T>
  extends ContainerBase<T>
  implements LeftistHeap<T>
{
  readonly compare: Comparator<T>;
  private _consumed = false;

  protected constructor(compare?: Comparator<T>) {
    super();
    this.compare = resolveComparator(compare);
  }

  abstract push(value: T): void;
  abstract pop(): T | undefined;
  abstract peek(): T | undefined;
  abstract build(values: Iterable<T>): void;
  abstract merge(other: LeftistHeap<T>): LeftistHeap<T>;
  abstract override validate(): true | string;
  abstract get rank(): number;

  /** Storage snapshot in iteration order; must not check live state (extractForMerge does). */
  protected abstract collectItems(): T[];

  /** Drops every reference held by the storage without touching the version counter. */
  protected abstract releaseStorage(): void;

  protected abstract get serializationType(): string;

  /** Extra serialized fields appended to the `values` payload. */
  protected serializationPayload(): Record<string, unknown> {
    return {};
  }

  /** O(1): the minimum element; identical to peek(). */
  peekMin(): T | undefined {
    return this.peek();
  }

  /** O(1): the minimum element; `popMin` is an alias for pop() on single-ended heaps. */
  popMin(): T | undefined {
    return this.pop();
  }

  /** O(1): number of stored elements. */
  override get size(): number {
    this.assertLive();
    return this._size;
  }

  /** O(1): emptiness check that rejects a consumed heap. */
  override isEmpty(): boolean {
    this.assertLive();
    return this._size === 0;
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
    return serializeLeftist(
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

  /** O(1): permanently transfers ownership and releases storage. */
  protected markConsumed(): void {
    this._consumed = true;
    this._size = 0;
    this.releaseStorage();
    this.touch();
  }

  /**
   * O(n): validates and removes every element of `other`. Same-implementation merges bypass this
   * with a cheaper meld, but every path marks a library heap consumed.
   */
  protected extractForMerge(other: LeftistHeap<T>): T[] {
    if (other === this) {
      throw new TypeError("cannot merge a heap with itself");
    }
    if (!(other instanceof LeftistHeapBase)) {
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
