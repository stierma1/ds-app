import {
  assertDefined,
  assertInteger,
  readInteger,
} from "../core/index.ts";
import type { Comparator } from "../core/index.ts";
import { HeapBase, implicitHeight } from "./base.ts";
import { parseHeap } from "./serialization.ts";
import type { DaryHeapOptions, Heap } from "./types.ts";

/**
 * d-ary min-heap over a flat array. Increasing `d` lowers the tree height (fewer sift-up moves) but
 * makes each sift-down scan up to d children, so push costs O(log_d n) comparisons and pop costs
 * O(d log_d n). d = 4 is a common cache- and branch-friendly choice.
 *
 * Like BinaryHeap it supports O(1) peek and Floyd's O(n) build; a merge with another DaryHeap
 * concatenates and re-heapifies in O(n + m) under this heap's arity. Duplicates are allowed and
 * iteration follows heap order.
 */
export class DaryHeap<T> extends HeapBase<T> {
  readonly arity: number;
  private _items: T[] = [];

  constructor(compare?: Comparator<T>, options: DaryHeapOptions = {}) {
    super(compare);
    const arity = options.arity ?? 4;
    assertInteger(arity, "arity");
    if (arity < 2) {
      throw new RangeError("arity must be at least 2");
    }
    this.arity = arity;
  }

  /** O(log_d n): append and sift up. */
  push(value: T): void {
    this.assertLive();
    this.requireValue(value);
    this._items.push(value);
    this._size++;
    this.siftUp(this._items.length - 1);
    this.touch();
  }

  /** O(d log_d n): move the last element to the root and sift down across up to d children. */
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

  /** O(1). */
  peek(): T | undefined {
    this.assertLive();
    return this._items[0];
  }

  /** O(n): Floyd bottom-up construction over the d-ary layout. */
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
   * Destructive merge: same-class heaps concatenate and re-heapify in O(n + m); other heaps are
   * drained and re-pushed. `other` is consumed in both cases.
   */
  merge(other: Heap<T>): DaryHeap<T> {
    this.assertLive();
    if (other === this) {
      throw new TypeError("cannot merge a heap with itself");
    }
    if (other instanceof DaryHeap) {
      other.assertLive();
      const otherItems = other._items;
      const otherSize = other._size;
      other.markConsumed();
      for (const value of otherItems) {
        this._items.push(value);
      }
      this._size += otherSize;
      if (otherSize > 0) {
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

  /** O(1): height in edges of the implicit complete d-ary tree. */
  get height(): number {
    return implicitHeight(this._size, this.arity);
  }

  /** O(n): checks size, defined values, and parent <= child for every non-root slot. */
  validate(): true | string {
    if (this._items.length !== this._size) {
      return "array length does not match size";
    }
    for (let index = 0; index < this._items.length; index++) {
      if (this._items[index] === undefined) {
        return `array slot ${index} is undefined`;
      }
      if (index > 0) {
        const parent = Math.floor((index - 1) / this.arity);
        if (this.compare(this._items[parent], this._items[index]) > 0) {
          return `heap order violated at index ${index}`;
        }
      }
    }
    return true;
  }

  /** O(n): rebuilds through build() and validates the payload. Serialized arity is preserved. */
  static deserialize<T>(
    json: unknown,
    compare?: Comparator<T>,
    options: DaryHeapOptions = {},
  ): DaryHeap<T> {
    const { record, values } = parseHeap(json, "DaryHeap");
    const arity = options.arity ?? readInteger(record, "arity");
    const heap = new DaryHeap<T>(compare, { arity });
    heap.build(values as T[]);
    if (heap.validate() !== true) {
      throw new TypeError(`Invalid DaryHeap payload: ${heap.validate()}`);
    }
    return heap;
  }

  protected override get serializationType(): string {
    return "DaryHeap";
  }

  protected override serializationPayload(): Record<string, unknown> {
    return { arity: this.arity };
  }

  protected collectItems(): T[] {
    return [...this._items];
  }

  protected releaseStorage(): void {
    this._items = [];
  }

  private heapify(): void {
    for (
      let index = Math.floor((this._items.length - 2) / this.arity);
      index >= 0;
      index--
    ) {
      this.siftDown(index);
    }
  }

  private siftUp(index: number): void {
    const items = this._items;
    const value = items[index];
    while (index > 0) {
      const parent = Math.floor((index - 1) / this.arity);
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
      const first = index * this.arity + 1;
      if (first >= size) {
        break;
      }
      const last = Math.min(size, first + this.arity);
      let child = first;
      for (let candidate = first + 1; candidate < last; candidate++) {
        if (this.compare(items[candidate], items[child]) < 0) {
          child = candidate;
        }
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
