import type { Comparator } from "../core/index.ts";
import { DepqBase, completeTreeHeight } from "./base.ts";
import { parseDepq } from "./serialization.ts";

interface Entry<T> {
  value: T;
  id: number;
  active: boolean;
}

/** Strict ordering on entries: `true` when `left` belongs above `right` in the heap. */
type Before<T> = (left: Entry<T>, right: Entry<T>) => boolean;

/**
 * Slack allowed above the live count before a heap is compacted. A heap may hold at most
 * `2 * size + COMPACTION_SLACK` entries, so space stays O(n).
 */
const COMPACTION_SLACK = 32;

let nextEntryId = 1;

/**
 * Lazy dual-heap DEPQ. A min heap and a max heap hold the same tagged entries;
 * removing from one side marks the entry inactive and leaves it in the other
 * heap, where it is discarded the next time it reaches the top. Each entry is
 * stale in at most one heap.
 *
 * Stale entries are bounded: when a heap holds more than `2 * size + 32`
 * entries, it is rebuilt bottom-up from its live entries in O(heap length).
 * At least `size + 32` stale entries were created (one per pop) since that heap
 * was last compact, so the rebuild is O(1) amortized per pop and space is O(n).
 * Discarding a stale root costs O(log n) and is charged to the pop that made it
 * stale, so `popMin`/`popMax` are O(log n) amortized and `peekMin`/`peekMax`
 * are O(1) amortized. Because both heaps stay within O(n) entries, iteration,
 * `serialize`, and `validate` are O(n) in the live size.
 *
 * This is the simplest correct implementation and doubles as the reference
 * model for the other structures. Duplicate values are distinguished by a
 * monotonic id. Iteration walks the min heap and skips inactive entries, so its
 * order is heap order rather than sorted order.
 */
export class TwoHeapDepq<T> extends DepqBase<T> {
  private _minHeap: Array<Entry<T>> = [];
  private _maxHeap: Array<Entry<T>> = [];
  private readonly _minBefore: Before<T>;
  private readonly _maxBefore: Before<T>;

  constructor(compare?: Comparator<T>) {
    super(compare);
    const order = this.compare;
    this._minBefore = (left, right) => {
      const result = order(left.value, right.value);
      return result < 0 || (result === 0 && left.id < right.id);
    };
    this._maxBefore = (left, right) => {
      const result = order(left.value, right.value);
      return result > 0 || (result === 0 && left.id > right.id);
    };
  }

  /** O(log n): insert the tagged entry into both heaps. */
  push(value: T): void {
    this.requireValue(value);
    const entry = this.createEntry(value);
    heapPush(this._minHeap, entry, this._minBefore);
    heapPush(this._maxHeap, entry, this._maxBefore);
    this._size++;
    this.touch();
  }

  /** O(log n) amortized: remove the minimum, discarding stale entries. */
  popMin(): T | undefined {
    const entry = this.popLive(this._minHeap, this._minBefore);
    if (entry === undefined) {
      return undefined;
    }
    entry.active = false;
    this._size--;
    this.compactIfNeeded();
    this.touch();
    return entry.value;
  }

  /** O(log n) amortized: remove the maximum, discarding stale entries. */
  popMax(): T | undefined {
    const entry = this.popLive(this._maxHeap, this._maxBefore);
    if (entry === undefined) {
      return undefined;
    }
    entry.active = false;
    this._size--;
    this.compactIfNeeded();
    this.touch();
    return entry.value;
  }

  /** O(1) amortized: the minimum, discarding stale entries on the way. */
  peekMin(): T | undefined {
    return this.peekLive(this._minHeap, this._minBefore);
  }

  /** O(1) amortized: the maximum, discarding stale entries on the way. */
  peekMax(): T | undefined {
    return this.peekLive(this._maxHeap, this._maxBefore);
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
    this._minHeap = heapify([...entries], this._minBefore);
    this._maxHeap = heapify(entries, this._maxBefore);
    this._size = entries.length;
    this.touch();
  }

  /** O(n): validates both heaps, the stale-entry bound, and the active-entry bookkeeping. */
  validate(): true | string {
    const minStatus = heapStatus(this._minHeap, this._minBefore);
    if (minStatus !== true) {
      return `min heap invalid: ${minStatus}`;
    }
    const maxStatus = heapStatus(this._maxHeap, this._maxBefore);
    if (maxStatus !== true) {
      return `max heap invalid: ${maxStatus}`;
    }
    const limit = 2 * this._size + COMPACTION_SLACK;
    if (this._minHeap.length > limit || this._maxHeap.length > limit) {
      return "stale entries exceed the compaction bound";
    }
    const minEntries = this._minHeap;
    const maxEntries = this._maxHeap;
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
    for (const entry of this._minHeap) {
      if (entry.active) {
        values.push(entry.value);
      }
    }
    return values;
  }

  protected releaseStorage(): void {
    this._minHeap = [];
    this._maxHeap = [];
  }

  private createEntry(value: T): Entry<T> {
    return { value, id: nextEntryId++, active: true };
  }

  /** Pops stale roots, then the live root; undefined when the heap has no live entry. */
  private popLive(heap: Array<Entry<T>>, before: Before<T>): Entry<T> | undefined {
    while (heap.length > 0) {
      const entry = heapPop(heap, before);
      if (entry.active) {
        return entry;
      }
    }
    return undefined;
  }

  private peekLive(heap: Array<Entry<T>>, before: Before<T>): T | undefined {
    while (heap.length > 0) {
      const entry = heap[0] as Entry<T>;
      if (entry.active) {
        return entry.value;
      }
      heapPop(heap, before);
    }
    return undefined;
  }

  /** O(1) amortized: rebuilds a heap from its live entries once its stale share is too large. */
  private compactIfNeeded(): void {
    const limit = 2 * this._size + COMPACTION_SLACK;
    if (this._minHeap.length > limit) {
      this._minHeap = heapify(this._minHeap.filter(isActive), this._minBefore);
    }
    if (this._maxHeap.length > limit) {
      this._maxHeap = heapify(this._maxHeap.filter(isActive), this._maxBefore);
    }
  }
}

function isActive<T>(entry: Entry<T>): boolean {
  return entry.active;
}

function heapPush<T>(heap: Array<Entry<T>>, entry: Entry<T>, before: Before<T>): void {
  let index = heap.length;
  heap.push(entry);
  while (index > 0) {
    const parent = (index - 1) >> 1;
    const above = heap[parent] as Entry<T>;
    if (!before(entry, above)) {
      break;
    }
    heap[index] = above;
    index = parent;
  }
  heap[index] = entry;
}

function heapPop<T>(heap: Array<Entry<T>>, before: Before<T>): Entry<T> {
  const top = heap[0] as Entry<T>;
  const last = heap.pop() as Entry<T>;
  if (heap.length > 0) {
    heap[0] = last;
    siftDown(heap, 0, before);
  }
  return top;
}

function siftDown<T>(heap: Array<Entry<T>>, start: number, before: Before<T>): void {
  const length = heap.length;
  const entry = heap[start] as Entry<T>;
  let index = start;
  for (;;) {
    const left = 2 * index + 1;
    if (left >= length) {
      break;
    }
    const right = left + 1;
    let child = left;
    if (right < length && before(heap[right] as Entry<T>, heap[left] as Entry<T>)) {
      child = right;
    }
    if (!before(heap[child] as Entry<T>, entry)) {
      break;
    }
    heap[index] = heap[child] as Entry<T>;
    index = child;
  }
  heap[index] = entry;
}

/** O(n): Floyd's bottom-up heap construction, in place. */
function heapify<T>(heap: Array<Entry<T>>, before: Before<T>): Array<Entry<T>> {
  for (let index = (heap.length >> 1) - 1; index >= 0; index--) {
    siftDown(heap, index, before);
  }
  return heap;
}

function heapStatus<T>(heap: Array<Entry<T>>, before: Before<T>): true | string {
  for (let index = 1; index < heap.length; index++) {
    const entry = heap[index];
    if (entry === undefined) {
      return `slot ${index} is empty`;
    }
    if (before(entry, heap[(index - 1) >> 1] as Entry<T>)) {
      return `heap order violated at index ${index}`;
    }
  }
  return true;
}
