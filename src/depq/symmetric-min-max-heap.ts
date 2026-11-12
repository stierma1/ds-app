import type { Comparator } from "../core/index.ts";
import { completeTreeHeight, DepqBase } from "./base.ts";
import { parseDepq } from "./serialization.ts";

/**
 * Symmetric min-max heap (Arvind & Pandu Rangan): a complete binary tree whose
 * root is empty, stored 1-based in an array with slots 0 and 1 unused, so node
 * `i` has children `2i`, `2i + 1`, sibling `i ^ 1`, and grandparent `i >> 2`.
 * Every node `x` satisfies
 *
 * - P1: a left child is ≤ its right sibling;
 * - P2: the left child of `x`'s grandparent is ≤ `x`;
 * - P3: the right child of `x`'s grandparent is ≥ `x`.
 *
 * So node 2 holds the minimum and node 3 the maximum (node 2 when one element
 * remains), and `peekMin`/`peekMax` are O(1). `push` moves a hole up along the
 * grandparent chain, and each deletion moves a hole down one side, swapping with
 * the sibling when P1 would break; both are O(log n). `build` reinserts every
 * value, which is O(n log n). Duplicates are allowed and ties are broken
 * arbitrarily. Iteration follows array order (level order), not sorted order.
 */
export class SymmetricMinMaxHeap<T> extends DepqBase<T> {
  private _items: T[] = new Array<T>(2);

  constructor(compare?: Comparator<T>) {
    super(compare);
  }

  /** O(log n): place the value in a new last node and move it up the grandparent chain. */
  push(value: T): void {
    this.requireValue(value);
    this._size++;
    this.insertAt(this._size + 1, value);
    this.touch();
  }

  /** O(1): the minimum element, or undefined when empty. */
  peekMin(): T | undefined {
    return this._size === 0 ? undefined : this._items[2];
  }

  /** O(1): the maximum element, or undefined when empty. */
  peekMax(): T | undefined {
    if (this._size === 0) {
      return undefined;
    }
    return this._size === 1 ? this._items[2] : this._items[3];
  }

  /** O(log n): remove node 2 and refill it from the left children below. */
  popMin(): T | undefined {
    if (this._size === 0) {
      return undefined;
    }
    const items = this._items;
    const result = items[2] as T;
    const last = this._size + 1;
    const moved = items[last] as T;
    items.length = last;
    this._size--;
    if (last > 2) {
      this.siftDownMin(moved, last - 1);
    }
    this.touch();
    return result;
  }

  /** O(log n): remove node 3 (node 2 when one element remains) and refill it. */
  popMax(): T | undefined {
    if (this._size <= 1) {
      return this.popMin();
    }
    const items = this._items;
    const result = items[3] as T;
    const last = this._size + 1;
    const moved = items[last] as T;
    items.length = last;
    this._size--;
    if (last > 3) {
      this.siftDownMax(moved, last - 1);
    }
    this.touch();
    return result;
  }

  /** O(1): height in edges below the empty root. */
  get height(): number {
    return this._size === 0 ? 0 : completeTreeHeight(this._size + 1) - 1;
  }

  /** O(n log n): validates every value, then reinserts them one at a time. */
  override build(values: Iterable<T>): void {
    const items = [...values];
    for (const value of items) {
      this.requireValue(value);
    }
    this._items = new Array<T>(2);
    this._size = 0;
    for (const value of items) {
      this._size++;
      this.insertAt(this._size + 1, value);
    }
    this.touch();
  }

  /** O(n): checks size, defined values, and P1–P3 at every node. */
  validate(): true | string {
    const items = this._items;
    const last = this._size + 1;
    if (items.length !== Math.max(2, last + 1)) {
      return "array length does not match size";
    }
    for (let index = 2; index <= last; index++) {
      const value = items[index];
      if (value === undefined) {
        return `node ${index} is undefined`;
      }
      if ((index & 1) === 0 && index + 1 <= last && this.compare(value, items[index + 1] as T) > 0) {
        return `sibling order violated at node ${index}`;
      }
      if (index >= 4) {
        const left = (index >> 2) << 1;
        if (this.compare(items[left] as T, value) > 0) {
          return `grandparent's left child exceeds node ${index}`;
        }
        if (this.compare(items[left + 1] as T, value) < 0) {
          return `grandparent's right child is below node ${index}`;
        }
      }
    }
    return true;
  }

  /** O(n log n): rebuilds through build() and validates the payload. */
  static deserialize<T>(json: unknown, compare?: Comparator<T>): SymmetricMinMaxHeap<T> {
    const { values } = parseDepq(json, "SymmetricMinMaxHeap");
    const heap = new SymmetricMinMaxHeap<T>(compare);
    heap.build(values as T[]);
    if (heap.validate() !== true) {
      throw new TypeError(`Invalid SymmetricMinMaxHeap payload: ${heap.validate()}`);
    }
    return heap;
  }

  protected override get serializationType(): string {
    return "SymmetricMinMaxHeap";
  }

  protected collectItems(): T[] {
    return this._items.slice(2, this._size + 2);
  }

  protected releaseStorage(): void {
    this._items = new Array<T>(2);
  }

  /**
   * O(log n): `hole` is the new last node. Fix P1 against the left sibling, then
   * pull grandparent children down while `value` falls outside their interval.
   */
  private insertAt(hole: number, value: T): void {
    const items = this._items;
    const compare = this.compare;
    let position = hole;
    if ((position & 1) === 1 && compare(value, items[position - 1] as T) < 0) {
      items[position] = items[position - 1] as T;
      position--;
    }
    while (position >= 4) {
      const left = (position >> 2) << 1;
      if (compare(value, items[left] as T) < 0) {
        items[position] = items[left] as T;
        position = left;
      } else if (compare(value, items[left + 1] as T) > 0) {
        items[position] = items[left + 1] as T;
        position = left + 1;
      } else {
        break;
      }
    }
    items[position] = value;
  }

  /**
   * O(log n): reinserts `value` (the former last element) into the hole at node
   * 2. The hole is always a left child; the next minimum candidates are the left
   * children of the hole and of its sibling. After moving down, P1 is restored
   * by trading `value` with the new right sibling when it is larger.
   */
  private siftDownMin(initial: T, last: number): void {
    const items = this._items;
    const compare = this.compare;
    let value = initial;
    let hole = 2;
    for (;;) {
      const first = hole << 1;
      if (first > last) {
        break;
      }
      let next = first;
      const second = first + 2;
      if (second <= last && compare(items[second] as T, items[first] as T) < 0) {
        next = second;
      }
      if (compare(items[next] as T, value) >= 0) {
        break;
      }
      items[hole] = items[next] as T;
      hole = next;
      if (hole + 1 <= last && compare(value, items[hole + 1] as T) > 0) {
        const swapped = items[hole + 1] as T;
        items[hole + 1] = value;
        value = swapped;
      }
    }
    items[hole] = value;
  }

  /**
   * O(log n): mirror of siftDownMin for the hole at node 3. The candidates are
   * the right children of the hole's sibling and of the hole, falling back to a
   * lone left child at the end of the array. A hole that lands on a left child
   * is the last node, so the walk stops there.
   */
  private siftDownMax(initial: T, last: number): void {
    const items = this._items;
    const compare = this.compare;
    let value = initial;
    let hole = 3;
    while ((hole & 1) === 1) {
      const siblingLeft = (hole << 1) - 2;
      if (siblingLeft > last) {
        break;
      }
      let next = siblingLeft + 1 <= last ? siblingLeft + 1 : siblingLeft;
      const ownLeft = hole << 1;
      if (ownLeft <= last) {
        const own = ownLeft + 1 <= last ? ownLeft + 1 : ownLeft;
        if (compare(items[own] as T, items[next] as T) > 0) {
          next = own;
        }
      }
      if (compare(items[next] as T, value) <= 0) {
        break;
      }
      items[hole] = items[next] as T;
      hole = next;
      if ((hole & 1) === 1 && compare(value, items[hole - 1] as T) < 0) {
        const swapped = items[hole - 1] as T;
        items[hole - 1] = value;
        value = swapped;
      }
    }
    items[hole] = value;
  }
}
