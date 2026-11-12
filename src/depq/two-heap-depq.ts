import type { Comparator } from "../core/index.ts";
import { BinaryHeap } from "../heaps/index.ts";
import { DepqBase, completeTreeHeight } from "./base.ts";
import { parseDepq } from "./serialization.ts";

interface Entry<T> {
  value: T;
  id: number;
  active: boolean;
}

let nextEntryId = 1;

/**
 * Lazy dual-heap DEPQ. A min heap and a max heap hold the same tagged entries;
 * removing from one side marks the entry inactive and leaves it in the other
 * heap, where it is discarded the next time it reaches the top. Every entry is
 * discarded at most once, so `popMin`/`popMax` are O(log n) amortized while
 * `peekMin`/`peekMax` are O(1).
 *
 * This is the simplest correct implementation and doubles as the reference
 * model for the other structures. Duplicate values are distinguished by a
 * monotonic id. Iteration walks the min heap and skips inactive entries, so its
 * order is heap order rather than sorted order.
 */
export class TwoHeapDepq<T> extends DepqBase<T> {
  private _minHeap: BinaryHeap<Entry<T>>;
  private _maxHeap: BinaryHeap<Entry<T>>;

  constructor(compare?: Comparator<T>) {
    super(compare);
    this._minHeap = this.createMinHeap();
    this._maxHeap = this.createMaxHeap();
  }

  /** O(log n): insert the tagged entry into both heaps. */
  push(value: T): void {
    this.requireValue(value);
    const entry = this.createEntry(value);
    this._minHeap.push(entry);
    this._maxHeap.push(entry);
    this._size++;
    this.touch();
  }

  /** O(log n) amortized: remove the minimum, discarding stale entries. */
  popMin(): T | undefined {
    let entry = this._minHeap.pop();
    while (entry !== undefined && !entry.active) {
      entry = this._minHeap.pop();
    }
    if (entry === undefined) {
      return undefined;
    }
    entry.active = false;
    this._size--;
    this.touch();
    return entry.value;
  }

  /** O(log n) amortized: remove the maximum, discarding stale entries. */
  popMax(): T | undefined {
    let entry = this._maxHeap.pop();
    while (entry !== undefined && !entry.active) {
      entry = this._maxHeap.pop();
    }
    if (entry === undefined) {
      return undefined;
    }
    entry.active = false;
    this._size--;
    this.touch();
    return entry.value;
  }

  /** O(1) amortized: the minimum, discarding stale entries on the way. */
  peekMin(): T | undefined {
    while (true) {
      const entry = this._minHeap.peek();
      if (entry === undefined) {
        return undefined;
      }
      if (entry.active) {
        return entry.value;
      }
      this._minHeap.pop();
    }
  }

  /** O(1) amortized: the maximum, discarding stale entries on the way. */
  peekMax(): T | undefined {
    while (true) {
      const entry = this._maxHeap.peek();
      if (entry === undefined) {
        return undefined;
      }
      if (entry.active) {
        return entry.value;
      }
      this._maxHeap.pop();
    }
  }

  /** O(1): height in edges of a complete tree holding the live elements. */
  get height(): number {
    return completeTreeHeight(this._size);
  }

  /** O(n): builds both heaps bottom-up from the same tagged entries. */
  override build(values: Iterable<T>): void {
    const items = [...values];
    for (const value of items) {
      this.requireValue(value);
    }
    const entries = items.map((value) => this.createEntry(value));
    this._minHeap.build(entries);
    this._maxHeap.build(entries);
    this._size = entries.length;
    this.touch();
  }

  /** O(n): validates both heaps and the active-entry bookkeeping. */
  validate(): true | string {
    const minStatus = this._minHeap.validate();
    if (minStatus !== true) {
      return `min heap invalid: ${minStatus}`;
    }
    const maxStatus = this._maxHeap.validate();
    if (maxStatus !== true) {
      return `max heap invalid: ${maxStatus}`;
    }
    const minEntries = this._minHeap.toArray();
    const maxEntries = this._maxHeap.toArray();
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
  static deserialize<T>(json: unknown, compare?: Comparator<T>): TwoHeapDepq<T> {
    const { values } = parseDepq(json, "TwoHeapDepq");
    const heap = new TwoHeapDepq<T>(compare);
    heap.build(values as T[]);
    if (heap.validate() !== true) {
      throw new TypeError(`Invalid TwoHeapDepq payload: ${heap.validate()}`);
    }
    return heap;
  }

  protected override get serializationType(): string {
    return "TwoHeapDepq";
  }

  protected collectItems(): T[] {
    const values: T[] = [];
    for (const entry of this._minHeap.toArray()) {
      if (entry.active) {
        values.push(entry.value);
      }
    }
    return values;
  }

  protected releaseStorage(): void {
    this._minHeap = this.createMinHeap();
    this._maxHeap = this.createMaxHeap();
  }

  private createEntry(value: T): Entry<T> {
    return { value, id: nextEntryId++, active: true };
  }

  private createMinHeap(): BinaryHeap<Entry<T>> {
    const compare = this.compare;
    return new BinaryHeap<Entry<T>>((left, right) => {
      const order = compare(left.value, right.value);
      return order !== 0 ? order : left.id - right.id;
    });
  }

  private createMaxHeap(): BinaryHeap<Entry<T>> {
    const compare = this.compare;
    return new BinaryHeap<Entry<T>>((left, right) => {
      const order = compare(left.value, right.value);
      return order !== 0 ? -order : right.id - left.id;
    });
  }
}
