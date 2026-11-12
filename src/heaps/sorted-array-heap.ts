import { assertDefined, assertMergeCompatible } from "../core/index.ts";
import type { Comparator } from "../core/index.ts";
import { HeapBase } from "./base.ts";
import { parseHeap } from "./serialization.ts";
import type { Heap } from "./types.ts";

/**
 * Reference implementation: elements kept in one ascending sorted array with a head index. `peek`
 * and `pop` are O(1) (plus amortized compaction), `build` is O(n log n), and `push` is O(n) because
 * it splices the array. A merge of two SortedArrayHeaps is a linear two-pointer merge.
 *
 * There is no tree, so `height` is defined as 0 (the logical structure is flat). Iteration is
 * ascending by comparator, which also makes toArray() sorted. Prefer BinaryHeap for real workloads;
 * this implementation is the obvious-correct model the other heaps are tested against.
 */
export class SortedArrayHeap<T> extends HeapBase<T> {
  private _items: T[] = [];
  private _head = 0;

  constructor(compare?: Comparator<T>) {
    super(compare);
  }

  /** O(log n) search plus O(n) splice. */
  push(value: T): void {
    this.assertLive();
    this.requireValue(value);
    const index = this.lowerBound(value);
    this._items.splice(index, 0, value);
    this._size++;
    this.touch();
  }

  /** O(1) amortized: reads the head slot and advances it, compacting occasionally. */
  pop(): T | undefined {
    this.assertLive();
    if (this._size === 0) {
      return undefined;
    }
    const value = this._items[this._head];
    this._head++;
    this._size--;
    if (this._size === 0) {
      this._items = [];
      this._head = 0;
    } else if (this._head >= 64 && this._head * 2 >= this._items.length) {
      this._items = this._items.slice(this._head);
      this._head = 0;
    }
    this.touch();
    return value;
  }

  /** O(1). */
  peek(): T | undefined {
    this.assertLive();
    return this._items[this._head];
  }

  /** O(n log n): sort a copy, then replace the storage. */
  override build(values: Iterable<T>): void {
    this.assertLive();
    const items = [...values];
    for (const value of items) {
      assertDefined(value);
    }
    items.sort((a, b) => this.compare(a, b));
    this._items = items;
    this._head = 0;
    this._size = items.length;
    this.touch();
  }

  /**
   * Destructive merge. A different comparator or self-merge throws TypeError. Two SortedArrayHeaps
   * merge in O(n + m); any other heap is taken through takeForMerge (an argument without it throws
   * UnsupportedError), sorted, and merged in O(m log m + n + m). `other` is consumed.
   */
  merge(other: Heap<T>): SortedArrayHeap<T> {
    this.assertLive();
    assertMergeCompatible(this, other);
    if (other instanceof SortedArrayHeap) {
      other.assertLive();
      const otherItems = other.collectItems();
      other.markConsumed();
      this._items = this.mergeSorted(this.collectItems(), otherItems);
    } else {
      const values = this.takeForeignForMerge(other, true);
      values.sort((a, b) => this.compare(a, b));
      this._items = this.mergeSorted(this.collectItems(), values);
    }
    this._head = 0;
    this._size = this._items.length;
    this.touch();
    return this;
  }

  /** O(1): a flat array has no root-to-leaf path, so the height is defined as 0. */
  get height(): number {
    this.assertLive();
    return 0;
  }

  /** O(n): checks size, defined values, and non-decreasing comparator order. */
  protected checkInvariants(): true | string {
    if (this._items.length - this._head !== this._size) {
      return "active length does not match size";
    }
    for (let index = this._head; index < this._items.length; index++) {
      if (this._items[index] === undefined) {
        return `array slot ${index} is undefined`;
      }
      if (index > this._head && this.compare(this._items[index - 1], this._items[index]) > 0) {
        return `sorted order violated at index ${index}`;
      }
    }
    return true;
  }

  /** O(n log n): rebuilds through build() and validates the payload. */
  static deserialize<T>(json: unknown, compare?: Comparator<T>): SortedArrayHeap<T> {
    const { values } = parseHeap(json, "SortedArrayHeap");
    const heap = new SortedArrayHeap<T>(compare);
    heap.build(values as T[]);
    if (heap.validate() !== true) {
      throw new TypeError(`Invalid SortedArrayHeap payload: ${heap.validate()}`);
    }
    return heap;
  }

  protected override get serializationType(): string {
    return "SortedArrayHeap";
  }

  protected collectItems(): T[] {
    return this._items.slice(this._head);
  }

  protected releaseStorage(): void {
    this._items = [];
    this._head = 0;
  }

  private lowerBound(value: T): number {
    let low = this._head;
    let high = this._items.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (this.compare(this._items[middle], value) < 0) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    return low;
  }

  private mergeSorted(left: T[], right: T[]): T[] {
    const merged: T[] = new Array(left.length + right.length);
    let i = 0;
    let j = 0;
    let k = 0;
    while (i < left.length && j < right.length) {
      if (this.compare(left[i], right[j]) <= 0) {
        merged[k++] = left[i++];
      } else {
        merged[k++] = right[j++];
      }
    }
    while (i < left.length) {
      merged[k++] = left[i++];
    }
    while (j < right.length) {
      merged[k++] = right[j++];
    }
    return merged;
  }
}
