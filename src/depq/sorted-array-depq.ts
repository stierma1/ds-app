import type { Comparator } from "../core/index.ts";
import { completeTreeHeight, DepqBase } from "./base.ts";
import { parseDepq } from "./serialization.ts";

/**
 * Sorted-array DEPQ. Values are kept in ascending order, so both ends are O(1)
 * to inspect and delete; insertion shifts elements and is O(n). A moving head
 * index makes `popMin` O(1) amortized: the array is compacted only when the
 * discarded prefix dominates it.
 *
 * `build` sorts in O(n log n). Duplicate values are allowed. Iteration is in
 * ascending order, unlike the heap-shaped implementations.
 */
export class SortedArrayDepq<T> extends DepqBase<T> {
  private _items: T[] = [];
  private _head = 0;

  constructor(compare?: Comparator<T>) {
    super(compare);
  }

  /** O(n): binary-search the insertion point and shift the tail. */
  push(value: T): void {
    this.requireValue(value);
    const items = this._items;
    let low = this._head;
    let high = items.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.compare(items[mid], value) <= 0) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    items.splice(low, 0, value);
    this._size++;
    this.touch();
  }

  /** O(1) amortized: advance the head, compacting when the prefix dominates. */
  popMin(): T | undefined {
    if (this._size === 0) {
      return undefined;
    }
    const value = this._items[this._head];
    this._head++;
    this._size--;
    if (this._size === 0) {
      this._items = [];
      this._head = 0;
    } else if (this._head > 32 && this._head * 2 >= this._items.length) {
      this._items = this._items.slice(this._head);
      this._head = 0;
    }
    this.touch();
    return value;
  }

  /** O(1): remove the final element. */
  popMax(): T | undefined {
    if (this._size === 0) {
      return undefined;
    }
    const value = this._items.pop() as T;
    this._size--;
    if (this._size === 0) {
      this._items = [];
      this._head = 0;
    }
    this.touch();
    return value;
  }

  /** O(1): the smallest element, or undefined when empty. */
  peekMin(): T | undefined {
    return this._size === 0 ? undefined : this._items[this._head];
  }

  /** O(1): the largest element, or undefined when empty. */
  peekMax(): T | undefined {
    return this._size === 0
      ? undefined
      : this._items[this._items.length - 1];
  }

  /** O(1): height of the perfectly balanced search tree over the contents. */
  get height(): number {
    return completeTreeHeight(this._size);
  }

  /** O(n log n): copy and sort. */
  override build(values: Iterable<T>): void {
    const items = [...values];
    for (const value of items) {
      this.requireValue(value);
    }
    items.sort((left, right) => this.compare(left, right));
    this._items = items;
    this._head = 0;
    this._size = items.length;
    this.touch();
  }

  /** O(n): checks the size and ascending order. */
  validate(): true | string {
    const items = this._items;
    if (this._head < 0 || this._head > items.length) {
      return "head index is out of range";
    }
    if (items.length - this._head !== this._size) {
      return "array length does not match size";
    }
    for (let index = this._head; index < items.length; index++) {
      if (items[index] === undefined) {
        return `array slot ${index} is undefined`;
      }
      if (
        index > this._head &&
        this.compare(items[index - 1], items[index]) > 0
      ) {
        return `sorted order violated at index ${index}`;
      }
    }
    return true;
  }

  /** O(n log n): rebuilds through build() and validates the payload. */
  static deserialize<T>(
    json: unknown,
    compare?: Comparator<T>,
  ): SortedArrayDepq<T> {
    const { values } = parseDepq(json, "SortedArrayDepq");
    const heap = new SortedArrayDepq<T>(compare);
    heap.build(values as T[]);
    if (heap.validate() !== true) {
      throw new TypeError(`Invalid SortedArrayDepq payload: ${heap.validate()}`);
    }
    return heap;
  }

  protected override get serializationType(): string {
    return "SortedArrayDepq";
  }

  protected collectItems(): T[] {
    return this._items.slice(this._head);
  }

  protected releaseStorage(): void {
    this._items = [];
    this._head = 0;
  }
}
