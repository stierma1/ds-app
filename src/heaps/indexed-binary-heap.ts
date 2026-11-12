import {
  assertDefined,
  ContainerBase,
  resolveComparator,
  UnsupportedError,
} from "../core/index.ts";
import type { Comparator } from "../core/index.ts";
import { implicitHeight } from "./base.ts";
import { parseEntries, serializeEntries } from "./serialization.ts";
import type { IndexedPriorityQueue } from "./types.ts";

/**
 * Binary min-heap keyed by K with a satellite V and a Map from key to array position. The index
 * makes get/has O(1) and turns delete/update/decreaseKey/increaseKey into one O(log n) sift after
 * the O(1) lookup. This is the indexed priority queue used by Dijkstra-style applications.
 *
 * Insert rejects a key that is already present (SameValueZero, i.e. Map equality). decreaseKey and
 * increaseKey return false when the direction is wrong or the new key already exists. The heap does
 * not support merge and throws UnsupportedError. Iteration follows heap order as [key, value] pairs.
 */
export class IndexedBinaryHeap<K, V>
  extends ContainerBase<[K, V]>
  implements IndexedPriorityQueue<K, V> {
  readonly compare: Comparator<K>;
  private _keys: K[] = [];
  private _values: V[] = [];
  private _positions = new Map<K, number>();

  constructor(compare?: Comparator<K>) {
    super();
    this.compare = resolveComparator(compare);
  }

  /** O(log n): append and sift up; false when the key is already present. */
  insert(key: K, value: V): boolean {
    assertDefined(key, "key");
    assertDefined(value, "value");
    if (this._positions.has(key)) {
      return false;
    }
    const index = this._keys.length;
    this._keys.push(key);
    this._values.push(value);
    this._positions.set(key, index);
    this._size++;
    this.siftUp(index);
    this.touch();
    return true;
  }

  /** O(1): direct index lookup. */
  get(key: K): V | undefined {
    assertDefined(key, "key");
    const position = this._positions.get(key);
    return position === undefined ? undefined : this._values[position];
  }

  /** O(1). */
  has(key: K): boolean {
    assertDefined(key, "key");
    return this._positions.has(key);
  }

  /** O(1): overwrites the satellite value without changing the key or position. */
  update(key: K, value: V): boolean {
    assertDefined(key, "key");
    assertDefined(value, "value");
    const position = this._positions.get(key);
    if (position === undefined) {
      return false;
    }
    this._values[position] = value;
    this.touch();
    return true;
  }

  /** O(log n): removes by key; false when absent. */
  delete(key: K): boolean {
    assertDefined(key, "key");
    const position = this._positions.get(key);
    if (position === undefined) {
      return false;
    }
    this.removeAt(position);
    this.touch();
    return true;
  }

  /** O(log n): sifts up after lowering the key; false when absent, increased, or duplicated. */
  decreaseKey(key: K, newKey: K): boolean {
    assertDefined(key, "key");
    assertDefined(newKey, "newKey");
    const position = this._positions.get(key);
    if (position === undefined) {
      return false;
    }
    if (this.compare(newKey, key) > 0) {
      return false;
    }
    if (!Object.is(newKey, key) && this._positions.has(newKey)) {
      return false;
    }
    this.replaceKey(position, key, newKey);
    this.siftUp(position);
    this.touch();
    return true;
  }

  /** O(log n): sifts down after raising the key; false when absent, decreased, or duplicated. */
  increaseKey(key: K, newKey: K): boolean {
    assertDefined(key, "key");
    assertDefined(newKey, "newKey");
    const position = this._positions.get(key);
    if (position === undefined) {
      return false;
    }
    if (this.compare(newKey, key) < 0) {
      return false;
    }
    if (!Object.is(newKey, key) && this._positions.has(newKey)) {
      return false;
    }
    this.replaceKey(position, key, newKey);
    this.siftDown(position);
    this.touch();
    return true;
  }

  /** O(1): the minimum entry, or undefined when empty. */
  peek(): [K, V] | undefined {
    if (this._size === 0) {
      return undefined;
    }
    return [this._keys[0], this._values[0]];
  }

  /** O(1): the minimum key, or undefined when empty. */
  peekKey(): K | undefined {
    return this._size === 0 ? undefined : this._keys[0];
  }

  /** O(log n): removes and returns the minimum entry. */
  pop(): [K, V] | undefined {
    if (this._size === 0) {
      return undefined;
    }
    const entry: [K, V] = [this._keys[0], this._values[0]];
    this.removeAt(0);
    this.touch();
    return entry;
  }

  /** O(n): replaces the contents with the supplied unique entries, then heapifies. */
  build(entries: Iterable<readonly [K, V]>): void {
    const keys: K[] = [];
    const values: V[] = [];
    const positions = new Map<K, number>();
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length !== 2) {
        throw new TypeError("entries must be [key, value] pairs");
      }
      const [key, value] = entry;
      assertDefined(key, "key");
      assertDefined(value, "value");
      if (positions.has(key)) {
        throw new TypeError("build does not accept duplicate keys");
      }
      positions.set(key, keys.length);
      keys.push(key);
      values.push(value);
    }
    this._keys = keys;
    this._values = values;
    this._positions = positions;
    this._size = keys.length;
    for (let index = (keys.length >> 1) - 1; index >= 0; index--) {
      this.siftDown(index);
    }
    this.touch();
  }

  /** O(n): heap order, index consistency, and size. */
  validate(): true | string {
    if (this._keys.length !== this._size || this._values.length !== this._size) {
      return "array lengths do not match size";
    }
    if (this._positions.size !== this._size) {
      return "index size does not match heap size";
    }
    for (let index = 0; index < this._size; index++) {
      const key = this._keys[index];
      if (key === undefined) {
        return `key slot ${index} is undefined`;
      }
      if (this._values[index] === undefined) {
        return `value slot ${index} is undefined`;
      }
      if (this._positions.get(key) !== index) {
        return `index entry for slot ${index} is incorrect`;
      }
      if (index > 0) {
        const parent = (index - 1) >> 1;
        if (this.compare(this._keys[parent], key) > 0) {
          return `heap order violated at index ${index}`;
        }
      }
    }
    return true;
  }

  /** O(1): height in edges of the implicit complete binary tree. */
  get height(): number {
    return implicitHeight(this._size, 2);
  }

  /** The indexed heap is a two-way mapping, so melding would require rebuilding the index. */
  merge(): never {
    throw new UnsupportedError("IndexedBinaryHeap does not support merge");
  }

  /** O(n): fresh array of [key, value] pairs in heap order. */
  override toArray(): Array<[K, V]> {
    const entries: Array<[K, V]> = new Array(this._size);
    for (let index = 0; index < this._size; index++) {
      entries[index] = [this._keys[index], this._values[index]];
    }
    return entries;
  }

  /** O(n) up front: snapshot iterator over heap order. */
  override [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.snapshotIterator(this.toArray());
  }

  /** O(1): drops the arrays and index. */
  override clear(): void {
    this._keys = [];
    this._values = [];
    this._positions = new Map();
    this._size = 0;
    this.touch();
  }

  /** O(n): entries in heap order plus a versioned type tag. */
  override serialize(): string {
    return serializeEntries("IndexedBinaryHeap", this.toArray());
  }

  /** O(n): rebuilds through build() and validates the payload. */
  static deserialize<K, V>(
    json: unknown,
    compare?: Comparator<K>,
  ): IndexedBinaryHeap<K, V> {
    const { entries } = parseEntries(json, "IndexedBinaryHeap");
    const heap = new IndexedBinaryHeap<K, V>(compare);
    heap.build(entries as Array<[K, V]>);
    if (heap.validate() !== true) {
      throw new TypeError(`Invalid IndexedBinaryHeap payload: ${heap.validate()}`);
    }
    return heap;
  }

  private replaceKey(position: number, key: K, newKey: K): void {
    this._keys[position] = newKey;
    if (this._positions.get(key) === position) {
      this._positions.delete(key);
    }
    this._positions.set(newKey, position);
  }

  private removeAt(position: number): void {
    const key = this._keys[position];
    const lastIndex = this._size - 1;
    const lastKey = this._keys[lastIndex];
    const lastValue = this._values[lastIndex];
    if (position !== lastIndex) {
      this._keys[position] = lastKey;
      this._values[position] = lastValue;
      this._positions.set(lastKey, position);
    }
    this._keys.pop();
    this._values.pop();
    this._positions.delete(key);
    this._size--;
    if (position < this._size) {
      const parent = (position - 1) >> 1;
      if (position > 0 && this.compare(this._keys[position], this._keys[parent]) < 0) {
        this.siftUp(position);
      } else {
        this.siftDown(position);
      }
    }
  }

  private siftUp(index: number): void {
    const keys = this._keys;
    const values = this._values;
    const key = keys[index];
    const value = values[index];
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.compare(key, keys[parent]) >= 0) {
        break;
      }
      keys[index] = keys[parent];
      values[index] = values[parent];
      this._positions.set(keys[index], index);
      index = parent;
    }
    keys[index] = key;
    values[index] = value;
    this._positions.set(key, index);
  }

  private siftDown(index: number): void {
    const keys = this._keys;
    const size = this._size;
    const key = keys[index];
    const value = this._values[index];
    while (true) {
      const left = index * 2 + 1;
      if (left >= size) {
        break;
      }
      const right = left + 1;
      let child = left;
      if (right < size && this.compare(keys[right], keys[left]) < 0) {
        child = right;
      }
      if (this.compare(keys[child], key) >= 0) {
        break;
      }
      keys[index] = keys[child];
      this._values[index] = this._values[child];
      this._positions.set(keys[index], index);
      index = child;
    }
    keys[index] = key;
    this._values[index] = value;
    this._positions.set(key, index);
  }
}
