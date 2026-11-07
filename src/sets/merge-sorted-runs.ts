import { assertDefined, resolveComparator } from "../core/index.ts";
import type { Comparator } from "../core/index.ts";

interface HeapItem<E> {
  value: E;
  run: number;
}

class MinHeap<E> {
  private _items: Array<HeapItem<E>> = [];
  private readonly _compare: Comparator<E>;

  constructor(compare: Comparator<E>) {
    this._compare = compare;
  }

  get size(): number {
    return this._items.length;
  }

  push(item: HeapItem<E>): void {
    this._items.push(item);
    this.siftUp(this._items.length - 1);
  }

  pop(): HeapItem<E> | undefined {
    if (this._items.length === 0) {
      return undefined;
    }
    const top = this._items[0];
    const last = this._items.pop()!;
    if (this._items.length > 0) {
      this._items[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  private less(a: HeapItem<E>, b: HeapItem<E>): boolean {
    const comparison = this._compare(a.value, b.value);
    return comparison < 0 || (comparison === 0 && a.run < b.run);
  }

  private siftUp(index: number): void {
    while (index > 0) {
      const parent = (index - 1) >>> 1;
      if (!this.less(this._items[index], this._items[parent])) {
        break;
      }
      [this._items[index], this._items[parent]] = [
        this._items[parent],
        this._items[index],
      ];
      index = parent;
    }
  }

  private siftDown(index: number): void {
    const length = this._items.length;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < length && this.less(this._items[left], this._items[smallest])) {
        smallest = left;
      }
      if (right < length && this.less(this._items[right], this._items[smallest])) {
        smallest = right;
      }
      if (smallest === index) {
        return;
      }
      [this._items[index], this._items[smallest]] = [
        this._items[smallest],
        this._items[index],
      ];
      index = smallest;
    }
  }
}

export function* mergeSortedRuns<E>(
  runs: Iterable<Iterable<E>>,
  compare: Comparator<E>,
  options: { unique?: boolean } = {},
): IterableIterator<E> {
  const comparator = resolveComparator(compare);
  const runList = [...runs];
  const iterators = runList.map((run) => run[Symbol.iterator]());
  const previous: E[] = new Array(runList.length);
  const heap = new MinHeap<E>(comparator);
  for (let index = 0; index < iterators.length; index++) {
    const next = iterators[index].next();
    if (next.done) {
      continue;
    }
    assertDefined(next.value, "run element");
    previous[index] = next.value;
    heap.push({ value: next.value, run: index });
  }
  let last: E | undefined;
  let hasLast = false;
  for (let item = heap.pop(); item !== undefined; item = heap.pop()) {
    const value = item.value;
    if (!options.unique || !hasLast || comparator(last as E, value) !== 0) {
      yield value;
      last = value;
      hasLast = true;
    }
    const next = iterators[item.run].next();
    if (next.done) {
      continue;
    }
    assertDefined(next.value, "run element");
    if (comparator(previous[item.run], next.value) > 0) {
      throw new RangeError("run is not sorted");
    }
    previous[item.run] = next.value;
    heap.push({ value: next.value, run: item.run });
  }
}
