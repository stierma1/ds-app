import type { Comparator } from "../core/index.ts";
import { completeTreeHeight, DepqBase } from "./base.ts";
import { parseDepq } from "./serialization.ts";

/**
 * Deap (double-ended heap) in a 1-based array whose slot 1 is never referenced.
 * The left subtree of the empty root is a min heap and the right subtree is a
 * max heap: with positions 2..n+1, the minimum is at position 2 and the maximum
 * at position 3.
 *
 * Every min-side node is paired with the max-side node at the mirror position
 * obtained by flipping the bit below its leading one; the paired min value is
 * never larger than the paired max value. Insertion and deletion use that
 * relation, so both ends are O(1) to inspect and O(log n) to change.
 *
 * Duplicate values are allowed and ties are broken arbitrarily. Iteration walks
 * the array, not sorted order.
 */
export class Deap<T> extends DepqBase<T> {
  private _items: T[] = new Array<T>(2);

  constructor(compare?: Comparator<T>) {
    super(compare);
  }

  /** O(log n): place the value and bubble it up its min or max subtree. */
  push(value: T): void {
    this.requireValue(value);
    this._size++;
    const index = this._size + 1;
    this.place(index, value, index);
    this.touch();
  }

  /** O(1): the element at position 2, or undefined when empty. */
  peekMin(): T | undefined {
    return this._size === 0 ? undefined : this._items[2];
  }

  /** O(1): the element at position 3, or the sole element when size is one. */
  peekMax(): T | undefined {
    if (this._size === 0) {
      return undefined;
    }
    return this._size === 1 ? this._items[2] : this._items[3];
  }

  /** O(log n): remove the minimum and repair both subtrees. */
  popMin(): T | undefined {
    return this.removeExtreme(true);
  }

  /** O(log n): remove the maximum and repair both subtrees. */
  popMax(): T | undefined {
    return this.removeExtreme(false);
  }

  /** O(1): height in edges below the empty root. */
  get height(): number {
    return this._size === 0
      ? 0
      : completeTreeHeight(this._size + 1) - 1;
  }

  /** O(n): checks size, both heaps, and the corresponding-node relation. */
  validate(): true | string {
    const items = this._items;
    if (items.length !== this._size + 2) {
      return "array length does not match size";
    }
    const last = this._size + 1;
    for (let index = 2; index <= last; index++) {
      if (items[index] === undefined) {
        return `array slot ${index} is undefined`;
      }
      const parent = index >> 1;
      if (parent >= 2) {
        if (this.isMinSide(index)) {
          if (this.compare(items[parent], items[index]) > 0) {
            return `min-heap order violated at index ${index}`;
          }
        } else if (this.compare(items[parent], items[index]) < 0) {
          return `max-heap order violated at index ${index}`;
        }
      }
      const partner = this.correspondingIndex(index, last);
      if (partner >= 2) {
        if (this.isMinSide(index)) {
          if (this.compare(items[index], items[partner]) > 0) {
            return `corresponding-node order violated at index ${index}`;
          }
        } else if (this.compare(items[partner], items[index]) > 0) {
          return `corresponding-node order violated at index ${index}`;
        }
      }
    }
    return true;
  }

  /** O(n log n): rebuilds by repeated insertion and validates the payload. */
  static deserialize<T>(json: unknown, compare?: Comparator<T>): Deap<T> {
    const { values } = parseDepq(json, "Deap");
    const heap = new Deap<T>(compare);
    heap.build(values as T[]);
    if (heap.validate() !== true) {
      throw new TypeError(`Invalid Deap payload: ${heap.validate()}`);
    }
    return heap;
  }

  protected override get serializationType(): string {
    return "Deap";
  }

  protected collectItems(): T[] {
    const values: T[] = [];
    for (let index = 2; index <= this._size + 1; index++) {
      values.push(this._items[index]);
    }
    return values;
  }

  protected releaseStorage(): void {
    this._items = new Array<T>(2);
  }

  /**
   * O(log n): shared deletion. The last element `x` is held back while a hole
   * moves down the removed side; if the corresponding node on the other side can
   * improve the hole, its best node is moved across and `x` moves up that side
   * instead. Only then is `x` placed and the array shortened.
   */
  private removeExtreme(isMin: boolean): T | undefined {
    const oldSize = this._size;
    if (oldSize === 0) {
      return undefined;
    }
    const items = this._items;
    const lastIndex = oldSize + 1;
    const result =
      isMin || oldSize === 1 ? items[2] : items[3];
    const x = items[lastIndex];
    if (oldSize <= 3) {
      if (oldSize === 3) {
        items[isMin ? 2 : 3] = items[4];
      } else if (oldSize === 2 && isMin) {
        items[2] = items[3];
      }
      items.pop();
      this._size--;
      this.touch();
      return result;
    }

    let hole = this.moveHoleDown(isMin ? 2 : 3, lastIndex, isMin, x);
    let corresponding = partnerIndex(hole);
    if (isMin && corresponding >= lastIndex) {
      corresponding >>= 1;
    }
    const crossed = this.swapCorresponding(
      corresponding,
      lastIndex,
      isMin,
      hole,
      x,
    );
    if (crossed !== null) {
      hole = this.moveUp(crossed.hole, crossed.isMin, x);
    }
    items[hole] = x;
    items.pop();
    this._size--;
    this.touch();
    return result;
  }

  /** Floyd-style hole descent that holds back the element `x` being relocated. */
  private moveHoleDown(
    start: number,
    lastIndex: number,
    isMin: boolean,
    x: T,
  ): number {
    const items = this._items;
    let hole = start;
    while (true) {
      const left = hole * 2;
      if (left >= lastIndex) {
        return hole;
      }
      const right = left + 1;
      const child =
        right < lastIndex && this.better(items[right], items[left], isMin)
          ? right
          : left;
      if (!this.better(items[child], x, isMin)) {
        return hole;
      }
      items[hole] = items[child];
      hole = child;
    }
  }

  /**
   * Try to move the best node of the opposite subtree (the corresponding node or
   * one of its children) into the hole. Returns the new hole and direction when
   * an element is moved, or null when the hole should simply receive `x`.
   */
  private swapCorresponding(
    corresponding: number,
    lastIndex: number,
    isMin: boolean,
    hole: number,
    x: T,
  ): { hole: number; isMin: boolean } | null {
    const items = this._items;
    let target = corresponding;
    const left = target * 2;
    if (left < lastIndex && this.better(items[left], items[target], isMin)) {
      target = left;
    }
    const right = left + 1;
    if (right < lastIndex && this.better(items[right], items[target], isMin)) {
      target = right;
    }
    if (!this.better(items[target], x, isMin)) {
      return null;
    }
    items[hole] = items[target];
    return { hole: target, isMin: !isMin };
  }

  /** Move `x` up the other subtree, shifting ancestors down into the hole. */
  private moveUp(hole: number, isMin: boolean, x: T): number {
    const items = this._items;
    let current = hole;
    while (true) {
      const parent = current >> 1;
      if (parent < 2 || !this.better(x, items[parent], isMin)) {
        return current;
      }
      items[current] = items[parent];
      current = parent;
    }
  }

  private better(left: T, right: T, isMin: boolean): boolean {
    const order = this.compare(left, right);
    return isMin ? order < 0 : order > 0;
  }

  /**
   * O(log n): store `value` at `index`, swap it with the corresponding node when
   * it belongs on the other side, and bubble up the affected subtree.
   */
  private place(index: number, value: T, last: number): void {
    const items = this._items;
    items[index] = value;
    const other = this.correspondingIndex(index, last);
    if (this.isMinSide(index)) {
      if (other >= 2 && this.compare(value, items[other]) > 0) {
        items[index] = items[other];
        items[other] = value;
        this.siftUpMax(other);
      } else {
        this.siftUpMin(index);
      }
    } else if (this.compare(value, items[other]) < 0) {
      items[index] = items[other];
      items[other] = value;
      this.siftUpMin(other);
    } else {
      this.siftUpMax(index);
    }
  }

  /**
   * The opposite-side node to compare against: the mirror position when it
   * exists, otherwise the parent of that position, which is the last max-side
   * node available (the deap's "corresponding node").
   */
  private correspondingIndex(index: number, last: number): number {
    const partner = partnerIndex(index);
    if (this.isMinSide(index) && partner > last) {
      return partner >> 1;
    }
    return partner;
  }

  private siftUpMin(start: number): void {
    const items = this._items;
    let index = start;
    while (index >= 4) {
      const parent = index >> 1;
      if (this.compare(items[index], items[parent]) >= 0) {
        return;
      }
      const value = items[index];
      items[index] = items[parent];
      items[parent] = value;
      index = parent;
    }
  }

  private siftUpMax(start: number): void {
    const items = this._items;
    let index = start;
    while (index >= 4) {
      const parent = index >> 1;
      if (this.compare(items[index], items[parent]) <= 0) {
        return;
      }
      const value = items[index];
      items[index] = items[parent];
      items[parent] = value;
      index = parent;
    }
  }

  private isMinSide(index: number): boolean {
    const msb = 1 << (31 - Math.clz32(index));
    return (index & (msb >> 1)) === 0;
  }
}

/** Mirror position in the opposite subtree: flips the bit below the leading one. */
function partnerIndex(index: number): number {
  const msb = 1 << (31 - Math.clz32(index));
  return index ^ (msb >> 1);
}
