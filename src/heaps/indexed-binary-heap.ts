import {
  assertDefined,
  ContainerBase,
  resolveComparator,
  UnsupportedError,
} from "../core/index.ts";
import type { Comparator } from "../core/index.ts";
import { implicitHeight } from "./base.ts";
import { parseEntries, serializeEntries } from "./serialization.ts";
import type { IndexedBinaryHeapOptions, IndexedPriorityQueue } from "./types.ts";

type KeyIdentity = string | number | bigint | boolean | symbol | null;

function requireIdentity(identity: unknown): KeyIdentity {
  const kind = typeof identity;
  if (
    identity === null ||
    kind === "string" ||
    kind === "number" ||
    kind === "bigint" ||
    kind === "boolean" ||
    kind === "symbol"
  ) {
    if (kind === "number" && Number.isNaN(identity)) {
      throw new TypeError("key identity must not be NaN");
    }
    return identity as KeyIdentity;
  }
  throw new TypeError("keyOf must return a primitive other than undefined");
}

/**
 * O(1): the primitive the default comparator orders `key` by, used as its index identity, so two
 * keys are the same key exactly when the default comparator calls them equal. number, bigint, and
 * string keys are their own identity (a Map keeps 1, "1", and 1n apart, and the default comparator
 * refuses to compare them anyway); a Date is identified by getTime(), and any other object by a
 * primitive valueOf(). Everything else, and NaN, throws TypeError, as the default comparator does.
 */
function defaultKeyIdentity(key: unknown): KeyIdentity {
  let primitive: unknown = key;
  if (key instanceof Date) {
    primitive = key.getTime();
  } else if (key !== null && typeof key === "object") {
    const valueOf = (key as { valueOf?: unknown }).valueOf;
    primitive = typeof valueOf === "function" ? (valueOf as () => unknown).call(key) : key;
  }
  const kind = typeof primitive;
  if (kind === "number") {
    if (Number.isNaN(primitive)) {
      throw new TypeError("key must not be NaN or an invalid Date");
    }
    return primitive as number;
  }
  if (kind === "string" || kind === "bigint") {
    return primitive as string | bigint;
  }
  throw new TypeError(
    "IndexedBinaryHeap keys must be number, bigint, string, Date, or valueOf primitives; pass keyOf for other key types",
  );
}

/**
 * Binary min-heap keyed by K with a satellite V and a Map from key identity to array position. The
 * index makes get/has O(1) and turns delete/update/decreaseKey/increaseKey into one O(log n) sift
 * after the O(1) lookup. This is the indexed priority queue used by Dijkstra-style applications.
 *
 * Key identity follows the common contract's default-comparator equality: number, bigint, and
 * string keys by value, Date keys by time, other objects by a primitive valueOf (so two
 * `new Date(5)` keys are one key). `options.keyOf(key)` supplies a primitive identity for any other
 * key type; a key with neither throws TypeError. Insert rejects a key whose identity is present;
 * decreaseKey and increaseKey return false when the direction is wrong or the new key's identity
 * belongs to another entry. The heap does not support merge and throws UnsupportedError. Iteration
 * follows heap order as [key, value] pairs.
 */
export class IndexedBinaryHeap<K, V>
  extends ContainerBase<[K, V]>
  implements IndexedPriorityQueue<K, V> {
  readonly compare: Comparator<K>;
  /** Primitive identity of a key; see the class comment. */
  readonly keyOf: (key: K) => KeyIdentity;
  private _keys: K[] = [];
  /** `_ids[i]` is the identity of `_keys[i]`, moved in lockstep so sifts never recompute it. */
  private _ids: KeyIdentity[] = [];
  private _values: V[] = [];
  private _positions = new Map<KeyIdentity, number>();

  constructor(compare?: Comparator<K>, options: IndexedBinaryHeapOptions<K> = {}) {
    super();
    this.compare = resolveComparator(compare);
    const keyOf = options.keyOf;
    if (keyOf !== undefined && typeof keyOf !== "function") {
      throw new TypeError("keyOf must be a function");
    }
    this.keyOf =
      keyOf === undefined ? defaultKeyIdentity : (key: K): KeyIdentity => requireIdentity(keyOf(key));
  }

  /** O(log n): append and sift up; false when a key with the same identity is present. */
  insert(key: K, value: V): boolean {
    const id = this.identity(key);
    assertDefined(value, "value");
    if (this._positions.has(id)) {
      return false;
    }
    const index = this._keys.length;
    this._keys.push(key);
    this._ids.push(id);
    this._values.push(value);
    this._positions.set(id, index);
    this._size++;
    this.siftUp(index);
    this.touch();
    return true;
  }

  /** O(1): direct index lookup. */
  get(key: K): V | undefined {
    const position = this._positions.get(this.identity(key));
    return position === undefined ? undefined : this._values[position];
  }

  /** O(1). */
  has(key: K): boolean {
    return this._positions.has(this.identity(key));
  }

  /** O(1): overwrites the satellite value without changing the key or position. */
  update(key: K, value: V): boolean {
    const id = this.identity(key);
    assertDefined(value, "value");
    const position = this._positions.get(id);
    if (position === undefined) {
      return false;
    }
    this._values[position] = value;
    this.touch();
    return true;
  }

  /** O(log n): removes by key; false when absent. */
  delete(key: K): boolean {
    const position = this._positions.get(this.identity(key));
    if (position === undefined) {
      return false;
    }
    this.removeAt(position);
    this.touch();
    return true;
  }

  /** O(log n): sifts up after lowering the key; false when absent, increased, or duplicated. */
  decreaseKey(key: K, newKey: K): boolean {
    return this.changeKey(key, newKey, -1);
  }

  /** O(log n): sifts down after raising the key; false when absent, decreased, or duplicated. */
  increaseKey(key: K, newKey: K): boolean {
    return this.changeKey(key, newKey, 1);
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
    const ids: KeyIdentity[] = [];
    const values: V[] = [];
    const positions = new Map<KeyIdentity, number>();
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length !== 2) {
        throw new TypeError("entries must be [key, value] pairs");
      }
      const [key, value] = entry;
      const id = this.identity(key);
      assertDefined(value, "value");
      if (positions.has(id)) {
        throw new TypeError("build does not accept duplicate keys");
      }
      positions.set(id, keys.length);
      keys.push(key);
      ids.push(id);
      values.push(value);
    }
    this._keys = keys;
    this._ids = ids;
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
    if (
      this._keys.length !== this._size ||
      this._ids.length !== this._size ||
      this._values.length !== this._size
    ) {
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
      if (!Object.is(this._ids[index], this.keyOf(key)) && this._ids[index] !== this.keyOf(key)) {
        return `stored identity for slot ${index} does not match its key`;
      }
      if (this._positions.get(this._ids[index]) !== index) {
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
    this._ids = [];
    this._values = [];
    this._positions = new Map();
    this._size = 0;
    this.touch();
  }

  /** O(n): entries in heap order plus a versioned type tag. */
  override serialize(): string {
    return serializeEntries("IndexedBinaryHeap", this.toArray());
  }

  /**
   * O(n): rebuilds through build() and validates the payload. Pass the same `keyOf` the heap was
   * built with when keys are not default-comparator types (functions are not serialized).
   */
  static deserialize<K, V>(
    json: unknown,
    compare?: Comparator<K>,
    options: IndexedBinaryHeapOptions<K> = {},
  ): IndexedBinaryHeap<K, V> {
    const { entries } = parseEntries(json, "IndexedBinaryHeap");
    const heap = new IndexedBinaryHeap<K, V>(compare, options);
    heap.build(entries as Array<[K, V]>);
    if (heap.validate() !== true) {
      throw new TypeError(`Invalid IndexedBinaryHeap payload: ${heap.validate()}`);
    }
    return heap;
  }

  /** O(1) plus the key function: identity of a defined key, or TypeError. */
  private identity(key: K): KeyIdentity {
    assertDefined(key, "key");
    return this.keyOf(key);
  }

  /** O(log n): shared body of decreaseKey (direction -1) and increaseKey (direction 1). */
  private changeKey(key: K, newKey: K, direction: -1 | 1): boolean {
    const id = this.identity(key);
    const newId = this.identity(newKey);
    const position = this._positions.get(id);
    if (position === undefined) {
      return false;
    }
    if (this.compare(newKey, this._keys[position]) * direction < 0) {
      return false;
    }
    if (newId !== id && this._positions.has(newId)) {
      return false;
    }
    this._keys[position] = newKey;
    this._ids[position] = newId;
    this._positions.delete(id);
    this._positions.set(newId, position);
    if (direction < 0) {
      this.siftUp(position);
    } else {
      this.siftDown(position);
    }
    this.touch();
    return true;
  }

  private removeAt(position: number): void {
    const id = this._ids[position];
    const lastIndex = this._size - 1;
    const lastKey = this._keys[lastIndex];
    const lastId = this._ids[lastIndex];
    const lastValue = this._values[lastIndex];
    if (position !== lastIndex) {
      this._keys[position] = lastKey;
      this._ids[position] = lastId;
      this._values[position] = lastValue;
      this._positions.set(lastId, position);
    }
    this._keys.pop();
    this._ids.pop();
    this._values.pop();
    this._positions.delete(id);
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
    const ids = this._ids;
    const values = this._values;
    const key = keys[index];
    const id = ids[index];
    const value = values[index];
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.compare(key, keys[parent]) >= 0) {
        break;
      }
      keys[index] = keys[parent];
      ids[index] = ids[parent];
      values[index] = values[parent];
      this._positions.set(ids[index], index);
      index = parent;
    }
    keys[index] = key;
    ids[index] = id;
    values[index] = value;
    this._positions.set(id, index);
  }

  private siftDown(index: number): void {
    const keys = this._keys;
    const ids = this._ids;
    const size = this._size;
    const key = keys[index];
    const id = ids[index];
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
      ids[index] = ids[child];
      this._values[index] = this._values[child];
      this._positions.set(ids[index], index);
      index = child;
    }
    keys[index] = key;
    ids[index] = id;
    this._values[index] = value;
    this._positions.set(id, index);
  }
}
