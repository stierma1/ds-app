import {
  assertComparator,
  assertDefined,
  assertInteger,
  ConcurrentModificationError,
  ContainerBase,
} from "../core/index.ts";
import type { Comparator } from "../core/index.ts";
import { deserializeValues, serializeValues } from "./serialization.ts";
import type { Deque, ListLike, Queue, Stack } from "./types.ts";

function checkOptionalInteger(value: number | undefined, name: string): void {
  if (value !== undefined) {
    assertInteger(value, name);
  }
}

/**
 * Ring-buffer deque over a power-of-two array with a head offset and bit mask.
 *
 * Fast: O(1) amortized push/pop at BOTH ends and O(1) random access by index,
 * which a linked list cannot offer. Slow: insert/remove/splice/reverse/sort in
 * the middle flatten the ring to a plain array and rebuild it, so they are O(n)
 * with a full allocation; prefer DoublyLinkedList if middle mutation dominates.
 * Capacity doubles when full and halves when occupancy drops below 1/4 (never
 * below 8), so a long run of pops does not leak capacity.
 * Iteration is over a snapshot and throws ConcurrentModificationError if the
 * deque is mutated mid-iteration.
 */
export class ArrayDeque<T> extends ContainerBase<T> implements Deque<T>, ListLike<T> {
  private _values: Array<T | undefined> = new Array(8);
  private _mask = 7;
  private _head = 0;

  /** Doubling policy: when full, copies into a ring of twice the capacity (O(n)). */
  private ensureCapacity(): void {
    if (this._size < this._values.length) {
      return;
    }
    const capacity = this._values.length;
    const values: Array<T | undefined> = new Array(capacity * 2);
    for (let i = 0; i < this._size; i++) {
      values[i] = this._values[(this._head + i) & this._mask];
    }
    this._values = values;
    this._mask = capacity * 2 - 1;
    this._head = 0;
  }

  /** Shrink policy: halves the ring (O(n)) when occupancy drops below 1/4, never below 8 slots. */
  private shrink(): void {
    const capacity = this._values.length;
    if (capacity <= 8 || this._size > capacity / 4) {
      return;
    }
    const nextCapacity = capacity / 2;
    const values: Array<T | undefined> = new Array(nextCapacity);
    for (let i = 0; i < this._size; i++) {
      values[i] = this._values[(this._head + i) & this._mask];
    }
    this._values = values;
    this._mask = nextCapacity - 1;
    this._head = 0;
  }

  private physical(index: number): number {
    return (this._head + index) & this._mask;
  }

  /** O(1): direct index into the ring via (head + index) & mask. */
  get(index: number): T | undefined {
    assertInteger(index);
    if (index < 0 || index >= this._size) {
      return undefined;
    }
    return this._values[this.physical(index)];
  }

  /** O(1). */
  set(index: number, value: T): T {
    assertInteger(index);
    assertDefined(value);
    if (index < 0 || index >= this._size) {
      throw new RangeError("index is out of range");
    }
    const position = this.physical(index);
    const previous = this._values[position] as T;
    this._values[position] = value;
    this.touch();
    return previous;
  }

  /** O(n): copies the ring to an array, splices, and rebuilds the ring. */
  insert(index: number, value: T): void {
    assertInteger(index);
    assertDefined(value);
    if (index < 0 || index > this._size) {
      throw new RangeError("index is out of range");
    }
    const values = this.toArray();
    values.splice(index, 0, value);
    this._resetFrom(values);
  }

  /** O(n): copies the ring to an array, splices, and rebuilds the ring. */
  remove(index: number): T | undefined {
    assertInteger(index);
    if (index < 0 || index >= this._size) {
      return undefined;
    }
    const values = this.toArray();
    const [removed] = values.splice(index, 1);
    this._resetFrom(values);
    return removed;
  }

  /** O(1) amortized; O(n) when the ring is full and must double. */
  pushFront(value: T): void {
    assertDefined(value);
    this.ensureCapacity();
    this._head = (this._head - 1) & this._mask;
    this._values[this._head] = value;
    this._size++;
    this.touch();
  }

  /** O(1) amortized; O(n) when the ring is full and must double. */
  pushBack(value: T): void {
    assertDefined(value);
    this.ensureCapacity();
    this._values[this.physical(this._size)] = value;
    this._size++;
    this.touch();
  }

  /** O(1) amortized; may shrink the ring (O(n)) when occupancy falls below 1/4. */
  popFront(): T | undefined {
    if (this._size === 0) {
      return undefined;
    }
    const value = this._values[this._head] as T;
    this._values[this._head] = undefined;
    this._head = (this._head + 1) & this._mask;
    this._size--;
    this.shrink();
    this.touch();
    return value;
  }

  /** O(1) amortized; may shrink the ring (O(n)) when occupancy falls below 1/4. */
  popBack(): T | undefined {
    if (this._size === 0) {
      return undefined;
    }
    const position = this.physical(this._size - 1);
    const value = this._values[position] as T;
    this._values[position] = undefined;
    this._size--;
    this.shrink();
    this.touch();
    return value;
  }

  /** O(1). */
  front(): T | undefined {
    return this._size === 0 ? undefined : this._values[this._head];
  }

  /** O(1). */
  back(): T | undefined {
    return this._size === 0 ? undefined : this._values[this.physical(this._size - 1)];
  }

  /** Alias for pushBack: O(1) amortized. */
  push(value: T): void {
    this.pushBack(value);
  }

  /** Alias for popBack: O(1) amortized. */
  pop(): T | undefined {
    return this.popBack();
  }

  /** Alias for pushFront: O(1) amortized. */
  unshift(value: T): void {
    this.pushFront(value);
  }

  /** Alias for popFront: O(1) amortized. */
  shift(): T | undefined {
    return this.popFront();
  }

  /** Alias for front: O(1). */
  first(): T | undefined {
    return this.front();
  }

  /** Alias for back: O(1). */
  last(): T | undefined {
    return this.back();
  }

  /** O(n): allocates a flat copy before scanning. */
  indexOf(value: T, from?: number): number {
    checkOptionalInteger(from, "from");
    const values = this.toArray();
    return from === undefined ? values.indexOf(value) : values.indexOf(value, from);
  }

  /** O(n): allocates a flat copy before scanning backward. */
  lastIndexOf(value: T, from?: number): number {
    checkOptionalInteger(from, "from");
    const values = this.toArray();
    return from === undefined ? values.lastIndexOf(value) : values.lastIndexOf(value, from);
  }

  /** O(n), not O(k): flattens the whole ring before slicing. */
  slice(start?: number, end?: number): T[] {
    checkOptionalInteger(start, "start");
    checkOptionalInteger(end, "end");
    return this.toArray().slice(start, end);
  }

  /** O(n): flattens, splices, and rebuilds the ring; omitting deleteCount removes to the end. */
  splice(start: number, deleteCount?: number, ...items: T[]): T[] {
    assertInteger(start, "start");
    checkOptionalInteger(deleteCount, "deleteCount");
    for (const item of items) {
      assertDefined(item);
    }
    const values = this.toArray();
    const removed = deleteCount === undefined
      ? values.splice(start, values.length, ...items)
      : values.splice(start, deleteCount, ...items);
    this._resetFrom(values);
    return removed;
  }

  /** O(n): rebuilds the ring from a reversed flat copy (no in-place swap). */
  reverse(): this {
    this._resetFrom(this.toArray().reverse());
    return this;
  }

  /** O(n log n) sort of a flat copy, then an O(n) ring rebuild. */
  sort(compare?: Comparator<T>): this {
    if (compare !== undefined) {
      assertComparator(compare);
    }
    this._resetFrom(this.toArray().sort(compare));
    return this;
  }

  /** O(n) in the number of appended values; each is an O(1) amortized pushBack. */
  merge(other: Iterable<T>): this {
    const values = [...other];
    for (const value of values) {
      assertDefined(value);
    }
    for (const value of values) {
      this.pushBack(value);
    }
    return this;
  }

  /** O(n): both halves are rebuilt from a flat copy. */
  split(index: number): ArrayDeque<T> {
    assertInteger(index);
    const values = this.toArray();
    if (index < 0 || index > values.length) {
      throw new RangeError("index is out of range");
    }
    const right = new ArrayDeque<T>();
    right._resetFrom(values.slice(index));
    this._resetFrom(values.slice(0, index));
    return right;
  }

  /** O(n). */
  serialize(): string {
    return serializeValues("ArrayDeque", this.toArray());
  }

  /** O(n). */
  static deserialize<T>(json: unknown): ArrayDeque<T> {
    const deque = new ArrayDeque<T>();
    for (const value of deserializeValues(json, "ArrayDeque")) {
      deque.pushBack(value as T);
    }
    return deque;
  }

  /** O(1): resets to a fresh 8-slot ring. */
  clear(): void {
    this._values = new Array(8);
    this._mask = 7;
    this._head = 0;
    this._size = 0;
    this.touch();
  }

  /** O(n): fresh array in logical order. */
  toArray(): T[] {
    const values: T[] = new Array(this._size);
    for (let i = 0; i < this._size; i++) {
      values[i] = this._values[this.physical(i)] as T;
    }
    return values;
  }

  /** O(n) up front: snapshots the ring, then throws ConcurrentModificationError on mutation. */
  [Symbol.iterator](): IterableIterator<T> {
    return this.snapshotIterator(this.toArray());
  }

  /** O(n). */
  validate(): true | string {
    const capacity = this._values.length;
    if (capacity < 8 || (capacity & (capacity - 1)) !== 0) {
      return "capacity is not a power of two of at least 8";
    }
    if (this._mask !== capacity - 1) {
      return "mask does not match capacity";
    }
    if (this._head < 0 || this._head >= capacity) {
      return "head is outside the ring";
    }
    if (this._size < 0 || this._size > capacity) {
      return "size is outside the ring capacity";
    }
    for (let i = 0; i < this._size; i++) {
      if (this._values[this.physical(i)] === undefined) {
        return `occupied slot at logical index ${i} is undefined`;
      }
    }
    return true;
  }

  /** Rebuild policy: the new ring is the smallest power of two >= n (min 8), so it may shrink. */
  private _resetFrom(values: T[]): void {
    let capacity = 8;
    while (capacity < values.length) {
      capacity *= 2;
    }
    this._values = new Array(capacity);
    this._mask = capacity - 1;
    this._head = 0;
    this._size = 0;
    for (const value of values) {
      assertDefined(value);
      this._values[this._size++] = value;
    }
    this.touch();
  }
}

/**
 * LIFO stack that wraps an ArrayDeque and pushes/pops at its back.
 *
 * O(1) amortized push/pop under ArrayDeque's doubling and 1/4-shrink policy, so
 * a single push or pop can cost O(n) when the ring resizes. toArray and
 * iteration run bottom-to-top over a snapshot that throws
 * ConcurrentModificationError if the stack is mutated mid-iteration.
 */
export class ArrayStack<T> implements Stack<T> {
  private readonly _deque = new ArrayDeque<T>();

  get size(): number {
    return this._deque.size;
  }

  isEmpty(): boolean {
    return this._deque.isEmpty();
  }

  /** O(1) amortized; O(n) when the ring must double. */
  push(value: T): void {
    this._deque.pushBack(value);
  }

  /** O(1) amortized; may shrink the ring (O(n)). */
  pop(): T | undefined {
    return this._deque.popBack();
  }

  /** O(1). */
  peek(): T | undefined {
    return this._deque.back();
  }

  /** O(n). */
  serialize(): string {
    return serializeValues("ArrayStack", this.toArray());
  }

  /** O(n). */
  static deserialize<T>(json: unknown): ArrayStack<T> {
    const stack = new ArrayStack<T>();
    for (const value of deserializeValues(json, "ArrayStack")) {
      stack.push(value as T);
    }
    return stack;
  }

  /** O(1). */
  clear(): void {
    this._deque.clear();
  }

  /** O(n), bottom to top. */
  toArray(): T[] {
    return this._deque.toArray();
  }

  /** O(n) snapshot, bottom to top. */
  [Symbol.iterator](): IterableIterator<T> {
    return this._deque[Symbol.iterator]();
  }

  /** O(n). */
  validate(): true | string {
    return this._deque.validate();
  }
}

/**
 * FIFO queue that wraps an ArrayDeque: enqueue at the back, dequeue at the front.
 *
 * O(1) amortized enqueue/dequeue in contiguous memory, with occasional O(n)
 * resizes from the doubling/1/4-shrink policy. LinkedQueue is O(1) worst case
 * per operation but allocates a node per element; prefer ArrayQueue for
 * throughput and LinkedQueue when resize latency spikes matter. Iteration is
 * over a snapshot and throws ConcurrentModificationError on mutation.
 */
export class ArrayQueue<T> implements Queue<T> {
  private readonly _deque = new ArrayDeque<T>();

  get size(): number {
    return this._deque.size;
  }

  isEmpty(): boolean {
    return this._deque.isEmpty();
  }

  /** O(1) amortized; O(n) when the ring must double. */
  enqueue(value: T): void {
    this._deque.pushBack(value);
  }

  /** O(1) amortized; may shrink the ring (O(n)). */
  dequeue(): T | undefined {
    return this._deque.popFront();
  }

  /** O(1). */
  peek(): T | undefined {
    return this._deque.front();
  }

  /** O(n). */
  serialize(): string {
    return serializeValues("ArrayQueue", this.toArray());
  }

  /** O(n). */
  static deserialize<T>(json: unknown): ArrayQueue<T> {
    const queue = new ArrayQueue<T>();
    for (const value of deserializeValues(json, "ArrayQueue")) {
      queue.enqueue(value as T);
    }
    return queue;
  }

  /** O(1). */
  clear(): void {
    this._deque.clear();
  }

  /** O(n), front to back. */
  toArray(): T[] {
    return this._deque.toArray();
  }

  /** O(n) snapshot, front to back. */
  [Symbol.iterator](): IterableIterator<T> {
    return this._deque[Symbol.iterator]();
  }

  /** O(n). */
  validate(): true | string {
    return this._deque.validate();
  }
}

class QueueNode<T> {
  value: T;
  next: QueueNode<T> | null = null;

  constructor(value: T) {
    this.value = value;
  }
}

/**
 * FIFO queue over a singly linked chain with head and tail pointers.
 *
 * enqueue and dequeue are O(1) worst case (nothing is ever resized), paid for
 * with one node allocation per element and pointer chasing on traversal. No
 * random access. Iteration copies the chain into a snapshot (O(n)) and throws
 * ConcurrentModificationError if the queue is mutated mid-iteration.
 */
export class LinkedQueue<T> implements Queue<T> {
  private _head: QueueNode<T> | null = null;
  private _tail: QueueNode<T> | null = null;
  private _size = 0;
  private _version = 0;

  get size(): number {
    return this._size;
  }

  isEmpty(): boolean {
    return this._size === 0;
  }

  /** O(1) worst case via the tail pointer. */
  enqueue(value: T): void {
    assertDefined(value);
    const node = new QueueNode(value);
    if (this._tail === null) {
      this._head = node;
      this._tail = node;
    } else {
      this._tail.next = node;
      this._tail = node;
    }
    this._size++;
    this._version++;
  }

  /** O(1) worst case. */
  dequeue(): T | undefined {
    if (this._head === null) {
      return undefined;
    }
    const node = this._head;
    this._head = node.next;
    if (this._head === null) {
      this._tail = null;
    }
    this._size--;
    this._version++;
    return node.value;
  }

  /** O(1). */
  peek(): T | undefined {
    return this._head?.value;
  }

  /** O(n). */
  serialize(): string {
    return serializeValues("LinkedQueue", this.toArray());
  }

  /** O(n). */
  static deserialize<T>(json: unknown): LinkedQueue<T> {
    const queue = new LinkedQueue<T>();
    for (const value of deserializeValues(json, "LinkedQueue")) {
      queue.enqueue(value as T);
    }
    return queue;
  }

  /** O(1): drops the chain. */
  clear(): void {
    this._head = null;
    this._tail = null;
    this._size = 0;
    this._version++;
  }

  /** O(n) walk into a fresh array. */
  toArray(): T[] {
    const values: T[] = [];
    for (let node = this._head; node !== null; node = node.next) {
      values.push(node.value);
    }
    return values;
  }

  /** O(n) up front: snapshots the chain, then throws ConcurrentModificationError on mutation. */
  [Symbol.iterator](): IterableIterator<T> {
    const values = this.toArray();
    const expected = this._version;
    let index = 0;
    const queue = this;
    const iterator: IterableIterator<T> = {
      next(): IteratorResult<T> {
        if (queue._version !== expected) {
          throw new ConcurrentModificationError();
        }
        if (index >= values.length) {
          return { done: true, value: undefined };
        }
        return { done: false, value: values[index++] };
      },
      [Symbol.iterator]() {
        return iterator;
      },
    };
    return iterator;
  }

  /** O(n). */
  validate(): true | string {
    let count = 0;
    let node = this._head;
    while (node !== null) {
      if (node.value === undefined) {
        return `node at index ${count} is undefined`;
      }
      count++;
      if (count > this._size) {
        return "cycle detected in queue links";
      }
      node = node.next;
    }
    if (count !== this._size) {
      return `size ${this._size} does not match node count ${count}`;
    }
    if (this._size === 0 && (this._head !== null || this._tail !== null)) {
      return "empty queue has non-null endpoints";
    }
    if (this._size > 0 && this._tail?.next !== null) {
      return "tail has a successor";
    }
    return true;
  }
}
