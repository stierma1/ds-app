import { assertDefined } from "../core/index.ts";
import type { Comparator } from "../core/index.ts";
import { HeapBase, implicitHeight } from "./base.ts";
import { parseHeap } from "./serialization.ts";
import type { Heap } from "./types.ts";

/**
 * Binary min-heap in a 0-based array, the reference implementation of the module.
 *
 * Fast: O(1) peek, O(log n) push/pop (2 comparisons per level, cache-friendly contiguous storage),
 * Floyd's O(n) build, and an O(n) destructive merge with another BinaryHeap. Slow: arbitrary melds
 * with other heap implementations degrade to O(m log n) re-insertion. Indexed operations such as
 * decreaseKey live on IndexedBinaryHeap. Duplicate values are allowed, and ties are broken
 * arbitrarily. Iteration follows heap order, not sorted order.
 */
export class BinaryHeap<T> extends HeapBase<T> {
  private _items: T[] = [];

  constructor(compare?: Comparator<T>) {
    super(compare);
  }

  /** O(log n): append and sift up. */
  push(value: T): void {
    this.assertLive();
    this.requireValue(value);
    this._items.push(value);
    this._size++;
    this.siftUp(this._items.length - 1);
    this.touch();
  }

  /** O(log n): move the last element to the root and sift it down; undefined when empty. */
  pop(): T | undefined {
    this.assertLive();
    if (this._size === 0) {
      return undefined;
    }
    const root = this._items[0];
    const last = this._items.pop() as T;
    this._size--;
    if (this._size > 0) {
      this._items[0] = last;
      this.siftDown(0);
    }
    this.touch();
    return root;
  }

  /** O(1): the minimum element, or undefined when empty. */
  peek(): T | undefined {
    this.assertLive();
    return this._items[0];
  }

  /** O(n): Floyd bottom-up heap construction, not n independent pushes. */
  override build(values: Iterable<T>): void {
    this.assertLive();
    const items = [...values];
    for (const value of items) {
      assertDefined(value);
    }
    this._items = items;
    this._size = items.length;
    this.heapify();
    this.touch();
  }

  /**
   * Destructive merge. Two BinaryHeaps concatenate and re-heapify in O(n + m); any other Heap is
   * drained and re-pushed, which is O(m log(n + m)). `other` is consumed either way.
   */
  merge(other: Heap<T>): BinaryHeap<T> {
    this.assertLive();
    if (other === this) {
      throw new TypeError("cannot merge a heap with itself");
    }
    if (other instanceof BinaryHeap) {
      other.assertLive();
      const otherItems = other._items;
      const otherSize = other._size;
      other.markConsumed();
      if (otherSize > 0) {
        for (const value of otherItems) {
          this._items.push(value);
        }
        this._size += otherSize;
        this.heapify();
      }
      this.touch();
      return this;
    }
    const values = this.extractForMerge(other);
    for (const value of values) {
      this._items.push(value);
    }
    this._size += values.length;
    if (values.length > 0) {
      this.heapify();
    }
    this.touch();
    return this;
  }

  /** O(1): height in edges of the implicit complete binary tree. */
  get height(): number {
    return implicitHeight(this._size, 2);
  }

  /** O(n): checks size, defined values, and the parent <= child invariant. */
  validate(): true | string {
    if (this._items.length !== this._size) {
      return "array length does not match size";
    }
    for (let index = 0; index < this._items.length; index++) {
      if (this._items[index] === undefined) {
        return `array slot ${index} is undefined`;
      }
      if (index > 0) {
        const parent = (index - 1) >> 1;
        if (this.compare(this._items[parent], this._items[index]) > 0) {
          return `heap order violated at index ${index}`;
        }
      }
    }
    return true;
  }

  /** O(n): rebuilds through build() and validates the payload. */
  static deserialize<T>(json: unknown, compare?: Comparator<T>): BinaryHeap<T> {
    const { values } = parseHeap(json, "BinaryHeap");
    const heap = new BinaryHeap<T>(compare);
    heap.build(values as T[]);
    if (heap.validate() !== true) {
      throw new TypeError(`Invalid BinaryHeap payload: ${heap.validate()}`);
    }
    return heap;
  }

  protected override get serializationType(): string {
    return "BinaryHeap";
  }

  protected collectItems(): T[] {
    return [...this._items];
  }

  protected releaseStorage(): void {
    this._items = [];
  }

  private heapify(): void {
    for (let index = (this._items.length >> 1) - 1; index >= 0; index--) {
      this.siftDown(index);
    }
  }

  private siftUp(index: number): void {
    const items = this._items;
    const value = items[index];
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.compare(value, items[parent]) >= 0) {
        break;
      }
      items[index] = items[parent];
      index = parent;
    }
    items[index] = value;
  }

  private siftDown(index: number): void {
    const items = this._items;
    const size = items.length;
    const value = items[index];
    while (true) {
      const left = index * 2 + 1;
      if (left >= size) {
        break;
      }
      const right = left + 1;
      let child = left;
      if (right < size && this.compare(items[right], items[left]) < 0) {
        child = right;
      }
      if (this.compare(items[child], value) >= 0) {
        break;
      }
      items[index] = items[child];
      index = child;
    }
    items[index] = value;
  }
}
