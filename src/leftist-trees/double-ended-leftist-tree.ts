import { assertDefined } from "../core/index.ts";
import type { Comparator } from "../core/index.ts";
import { LeftistHeapBase } from "./base.ts";
import { LeftistHeap } from "./leftist-heap.ts";
import { parseLeftist } from "./serialization.ts";
import type {
  DoubleEndedLeftistTree as DoubleEndedLeftistTreeContract,
  LeftistHeap as LeftistHeapContract,
} from "./types.ts";

interface Entry<T> {
  value: T;
  id: number;
  active: boolean;
}

let nextEntryId = 1;

/**
 * Double-ended leftist tree. A min-leftist heap and a max-leftist heap hold the same entries, each
 * entry tagged with a process-wide unique id so duplicate values remain distinguishable. Removing
 * from one side marks the entry inactive and leaves it in the other heap, where it is discarded
 * lazily the next time it reaches the top. Every entry is discarded at most once, so each operation
 * is O(log n) amortized.
 *
 * `peekMin`/`peekMax` are O(1) and each pop removes exactly one element. With one element left both
 * pops remove it. Iteration walks the min-heap and skips inactive entries, so its order is heap
 * order rather than sorted order.
 *
 * Entry: {value, id, active}
 */
export class DoubleEndedLeftistTree<T>
  extends LeftistHeapBase<T>
  implements DoubleEndedLeftistTreeContract<T>
{
  private _min: LeftistHeap<Entry<T>>;
  private _max: LeftistHeap<Entry<T>>;

  constructor(compare?: Comparator<T>) {
    super(compare);
    this._min = this.createMinHeap();
    this._max = this.createMaxHeap();
  }

  /** O(log n): insert the entry into both the min-heap and the max-heap. */
  push(value: T): void {
    this.assertLive();
    this.requireValue(value);
    const entry = this.createEntry(value);
    this._min.push(entry);
    this._max.push(entry);
    this._size++;
    this.touch();
  }

  /** O(log n) amortized: remove the minimum, discarding stale entries on the way. */
  pop(): T | undefined {
    return this.popMin();
  }

  /** O(log n) amortized: remove the minimum, discarding stale entries on the way. */
  override popMin(): T | undefined {
    this.assertLive();
    let entry = this._min.pop();
    while (entry !== undefined && !entry.active) {
      entry = this._min.pop();
    }
    if (entry === undefined) {
      return undefined;
    }
    entry.active = false;
    this._size--;
    this.touch();
    return entry.value;
  }

  /** O(log n) amortized: remove the maximum, discarding stale entries on the way. */
  popMax(): T | undefined {
    this.assertLive();
    let entry = this._max.pop();
    while (entry !== undefined && !entry.active) {
      entry = this._max.pop();
    }
    if (entry === undefined) {
      return undefined;
    }
    entry.active = false;
    this._size--;
    this.touch();
    return entry.value;
  }

  /** O(1): the minimum element, or undefined when empty. */
  peek(): T | undefined {
    return this.peekMin();
  }

  /** O(1): the minimum element, discarding stale entries on the way. */
  override peekMin(): T | undefined {
    this.assertLive();
    while (true) {
      const entry = this._min.peek();
      if (entry === undefined) {
        return undefined;
      }
      if (entry.active) {
        return entry.value;
      }
      this._min.pop();
    }
  }

  /** O(1): the maximum element, discarding stale entries on the way. */
  peekMax(): T | undefined {
    this.assertLive();
    while (true) {
      const entry = this._max.peek();
      if (entry === undefined) {
        return undefined;
      }
      if (entry.active) {
        return entry.value;
      }
      this._max.pop();
    }
  }

  /** O(n): builds both internal heaps bottom-up from the same entries. */
  override build(values: Iterable<T>): void {
    this.assertLive();
    const items = [...values];
    for (const value of items) {
      assertDefined(value);
    }
    const entries = items.map((value) => this.createEntry(value));
    this._min.build(entries);
    this._max.build(entries);
    this._size = entries.length;
    this.touch();
  }

  /** O(1): null-path length of the min-heap root, 0 when no elements remain. */
  override get rank(): number {
    this.assertLive();
    return this._size === 0 ? 0 : this._min.rank;
  }

  /**
   * Destructive merge. Two double-ended trees meld both internal heaps in O(log n); any other
   * leftist heap is drained and inserted entry by entry. `other` is consumed either way.
   */
  merge(other: LeftistHeapContract<T>): DoubleEndedLeftistTree<T> {
    this.assertLive();
    if (other === this) {
      throw new TypeError("cannot merge a heap with itself");
    }
    if (other instanceof DoubleEndedLeftistTree) {
      other.assertLive();
      const otherMin = other._min;
      const otherMax = other._max;
      const otherSize = other._size;
      this._min.merge(otherMin);
      this._max.merge(otherMax);
      this._size += otherSize;
      other.markConsumed();
      this.touch();
      return this;
    }
    const values = this.extractForMerge(other);
    for (const value of values) {
      const entry = this.createEntry(value);
      this._min.push(entry);
      this._max.push(entry);
    }
    this._size += values.length;
    this.touch();
    return this;
  }

  /** O(n): validates both internal heaps and the active-entry bookkeeping. */
  validate(): true | string {
    this.assertLive();
    const minStatus = this._min.validate();
    if (minStatus !== true) {
      return `min heap invalid: ${minStatus}`;
    }
    const maxStatus = this._max.validate();
    if (maxStatus !== true) {
      return `max heap invalid: ${maxStatus}`;
    }
    const minEntries = this._min.toArray();
    const maxEntries = this._max.toArray();
    const minSet = new Set<Entry<T>>();
    const maxSet = new Set<Entry<T>>();
    let activeCount = 0;
    for (const entry of minEntries) {
      if (minSet.has(entry)) {
        return "duplicate entry in the min heap";
      }
      if (entry.value === undefined) {
        return "min-heap entry value is undefined";
      }
      minSet.add(entry);
      if (entry.active) {
        activeCount++;
      }
    }
    for (const entry of maxEntries) {
      if (maxSet.has(entry)) {
        return "duplicate entry in the max heap";
      }
      if (entry.value === undefined) {
        return "max-heap entry value is undefined";
      }
      maxSet.add(entry);
    }
    for (const entry of minSet) {
      if (entry.active) {
        if (!maxSet.has(entry)) {
          return "active entry missing from the max heap";
        }
      } else if (maxSet.has(entry)) {
        return "stale entry present in both heaps";
      }
    }
    for (const entry of maxSet) {
      if (entry.active && !minSet.has(entry)) {
        return "active entry missing from the min heap";
      }
    }
    if (activeCount !== this._size) {
      return `size ${this._size} does not match active entry count ${activeCount}`;
    }
    return true;
  }

  /** O(n): rebuilds through build() and validates the payload. */
  static deserialize<T>(
    json: unknown,
    compare?: Comparator<T>,
  ): DoubleEndedLeftistTree<T> {
    const { values } = parseLeftist(json, "DoubleEndedLeftistTree");
    const tree = new DoubleEndedLeftistTree<T>(compare);
    tree.build(values as T[]);
    if (tree.validate() !== true) {
      throw new TypeError(`Invalid DoubleEndedLeftistTree payload: ${tree.validate()}`);
    }
    return tree;
  }

  protected override get serializationType(): string {
    return "DoubleEndedLeftistTree";
  }

  /** O(n): the min-heap walk, skipping entries already removed from the other side. */
  protected collectItems(): T[] {
    const values: T[] = [];
    for (const entry of this._min.toArray()) {
      if (entry.active) {
        values.push(entry.value);
      }
    }
    return values;
  }

  protected releaseStorage(): void {
    this._min = this.createMinHeap();
    this._max = this.createMaxHeap();
  }

  private createEntry(value: T): Entry<T> {
    return { value, id: nextEntryId++, active: true };
  }

  private createMinHeap(): LeftistHeap<Entry<T>> {
    const compare = this.compare;
    return new LeftistHeap<Entry<T>>((a, b) => {
      const order = compare(a.value, b.value);
      return order !== 0 ? order : a.id - b.id;
    });
  }

  private createMaxHeap(): LeftistHeap<Entry<T>> {
    const compare = this.compare;
    return new LeftistHeap<Entry<T>>((a, b) => {
      const order = compare(a.value, b.value);
      return order !== 0 ? -order : b.id - a.id;
    });
  }
}
