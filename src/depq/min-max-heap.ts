import type { Comparator } from "../core/index.ts";
import { completeTreeHeight, DepqBase } from "./base.ts";
import { parseDepq } from "./serialization.ts";

/**
 * Min-max heap in a 0-based array. Even tree levels are min levels and odd
 * levels are max levels, so `peekMin` and `peekMax` are O(1).
 *
 * Insert bubbles a value up along min or max levels. Deletion replaces the
 * removed root with the last element and trickles it down through children and
 * grandchildren, which keeps both level orderings. Floyd-style bottom-up
 * construction makes `build` O(n). Duplicate values are allowed and ties are
 * broken arbitrarily. Iteration follows array order, not sorted order.
 */
export class MinMaxHeap<T> extends DepqBase<T> {
  private _items: T[] = [];

  constructor(compare?: Comparator<T>) {
    super(compare);
  }

  /** O(log n): append and bubble up. */
  push(value: T): void {
    this.requireValue(value);
    this._items.push(value);
    this._size++;
    this.bubbleUp(this._items.length - 1);
    this.touch();
  }

  /** O(1): the minimum element, or undefined when empty. */
  peekMin(): T | undefined {
    return this._items[0];
  }

  /** O(1): the maximum element, or undefined when empty. */
  peekMax(): T | undefined {
    const items = this._items;
    if (items.length === 0) {
      return undefined;
    }
    if (items.length === 1) {
      return items[0];
    }
    if (items.length === 2) {
      return items[1];
    }
    return this.compare(items[1], items[2]) >= 0 ? items[1] : items[2];
  }

  /** O(log n): remove the root and trickle the last element down. */
  popMin(): T | undefined {
    if (this._items.length === 0) {
      return undefined;
    }
    const min = this._items[0];
    const last = this._items.pop() as T;
    this._size--;
    if (this._items.length > 0) {
      this._items[0] = last;
      this.trickleDownMin(0);
    }
    this.touch();
    return min;
  }

  /** O(log n): remove the larger of the two second-level nodes. */
  popMax(): T | undefined {
    const items = this._items;
    if (items.length === 0) {
      return undefined;
    }
    if (items.length === 1) {
      return this.popMin();
    }
    const maxIndex =
      items.length === 2
        ? 1
        : this.compare(items[1], items[2]) >= 0
          ? 1
          : 2;
    const max = items[maxIndex];
    const last = items.pop() as T;
    this._size--;
    if (maxIndex < items.length) {
      items[maxIndex] = last;
      this.trickleDown(maxIndex);
    }
    this.touch();
    return max;
  }

  /** O(1): height in edges of the implicit complete binary tree. */
  get height(): number {
    return completeTreeHeight(this._items.length);
  }

  /** O(n): Floyd bottom-up construction. */
  override build(values: Iterable<T>): void {
    const items = [...values];
    for (const value of items) {
      this.requireValue(value);
    }
    this._items = items;
    this._size = items.length;
    for (let index = (items.length >> 1) - 1; index >= 0; index--) {
      this.trickleDown(index);
    }
    this.touch();
  }

  /** O(n): checks size, defined values, and both level orderings. */
  validate(): true | string {
    const items = this._items;
    if (items.length !== this._size) {
      return "array length does not match size";
    }
    for (let index = 0; index < items.length; index++) {
      if (items[index] === undefined) {
        return `array slot ${index} is undefined`;
      }
      if (index === 0) {
        continue;
      }
      const parent = (index - 1) >> 1;
      const minLevel = this.isMinLevel(index);
      if (minLevel) {
        if (this.compare(items[parent], items[index]) < 0) {
          return `min-level order violated at index ${index}`;
        }
      } else if (this.compare(items[parent], items[index]) > 0) {
        return `max-level order violated at index ${index}`;
      }
      if (index >= 3) {
        const grandparent = (index - 3) >> 2;
        if (minLevel) {
          if (this.compare(items[grandparent], items[index]) > 0) {
            return `min-level grandparent order violated at index ${index}`;
          }
        } else if (this.compare(items[grandparent], items[index]) < 0) {
          return `max-level grandparent order violated at index ${index}`;
        }
      }
    }
    return true;
  }

  /** O(n): rebuilds through build() and validates the payload. */
  static deserialize<T>(json: unknown, compare?: Comparator<T>): MinMaxHeap<T> {
    const { values } = parseDepq(json, "MinMaxHeap");
    const heap = new MinMaxHeap<T>(compare);
    heap.build(values as T[]);
    if (heap.validate() !== true) {
      throw new TypeError(`Invalid MinMaxHeap payload: ${heap.validate()}`);
    }
    return heap;
  }

  protected override get serializationType(): string {
    return "MinMaxHeap";
  }

  protected collectItems(): T[] {
    return [...this._items];
  }

  protected releaseStorage(): void {
    this._items = [];
  }

  /** 0 for a min level, 1 for a max level. */
  private isMinLevel(index: number): boolean {
    return ((31 - Math.clz32(index + 1)) & 1) === 0;
  }

  private trickleDown(index: number): void {
    if (this.isMinLevel(index)) {
      this.trickleDownMin(index);
    } else {
      this.trickleDownMax(index);
    }
  }

  private bubbleUp(index: number): void {
    if (index === 0) {
      return;
    }
    const parent = (index - 1) >> 1;
    const items = this._items;
    if (this.isMinLevel(index)) {
      if (this.compare(items[index], items[parent]) > 0) {
        this.swap(index, parent);
        this.bubbleUpMax(parent);
      } else {
        this.bubbleUpMin(index);
      }
    } else if (this.compare(items[index], items[parent]) < 0) {
      this.swap(index, parent);
      this.bubbleUpMin(parent);
    } else {
      this.bubbleUpMax(index);
    }
  }

  private bubbleUpMin(index: number): void {
    const items = this._items;
    while (index >= 3) {
      const grandparent = (index - 3) >> 2;
      if (this.compare(items[index], items[grandparent]) >= 0) {
        return;
      }
      this.swap(index, grandparent);
      index = grandparent;
    }
  }

  private bubbleUpMax(index: number): void {
    const items = this._items;
    while (index >= 3) {
      const grandparent = (index - 3) >> 2;
      if (this.compare(items[index], items[grandparent]) <= 0) {
        return;
      }
      this.swap(index, grandparent);
      index = grandparent;
    }
  }

  private trickleDownMin(start: number): void {
    const items = this._items;
    const length = items.length;
    let index = start;
    while (true) {
      const left = index * 2 + 1;
      if (left >= length) {
        return;
      }
      let target = left;
      if (left + 1 < length && this.compare(items[left + 1], items[left]) < 0) {
        target = left + 1;
      }
      let targetIsGrandchild = false;
      const firstGrandchild = index * 4 + 3;
      const end = Math.min(index * 4 + 7, length);
      for (let child = firstGrandchild; child < end; child++) {
        if (this.compare(items[child], items[target]) < 0) {
          target = child;
          targetIsGrandchild = true;
        }
      }
      if (!targetIsGrandchild) {
        if (this.compare(items[target], items[index]) < 0) {
          this.swap(index, target);
        }
        return;
      }
      if (this.compare(items[target], items[index]) >= 0) {
        return;
      }
      this.swap(index, target);
      const parent = (target - 1) >> 1;
      if (this.compare(items[target], items[parent]) > 0) {
        this.swap(target, parent);
      }
      index = target;
    }
  }

  private trickleDownMax(start: number): void {
    const items = this._items;
    const length = items.length;
    let index = start;
    while (true) {
      const left = index * 2 + 1;
      if (left >= length) {
        return;
      }
      let target = left;
      if (left + 1 < length && this.compare(items[left + 1], items[left]) > 0) {
        target = left + 1;
      }
      let targetIsGrandchild = false;
      const firstGrandchild = index * 4 + 3;
      const end = Math.min(index * 4 + 7, length);
      for (let child = firstGrandchild; child < end; child++) {
        if (this.compare(items[child], items[target]) > 0) {
          target = child;
          targetIsGrandchild = true;
        }
      }
      if (!targetIsGrandchild) {
        if (this.compare(items[target], items[index]) > 0) {
          this.swap(index, target);
        }
        return;
      }
      if (this.compare(items[target], items[index]) <= 0) {
        return;
      }
      this.swap(index, target);
      const parent = (target - 1) >> 1;
      if (this.compare(items[target], items[parent]) < 0) {
        this.swap(target, parent);
      }
      index = target;
    }
  }

  private swap(left: number, right: number): void {
    const value = this._items[left];
    this._items[left] = this._items[right];
    this._items[right] = value;
  }
}
