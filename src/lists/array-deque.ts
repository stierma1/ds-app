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

export class ArrayDeque<T> extends ContainerBase<T> implements Deque<T>, ListLike<T> {
  private _values: Array<T | undefined> = new Array(8);
  private _mask = 7;
  private _head = 0;

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

  get(index: number): T | undefined {
    assertInteger(index);
    if (index < 0 || index >= this._size) {
      return undefined;
    }
    return this._values[this.physical(index)];
  }

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

  pushFront(value: T): void {
    assertDefined(value);
    this.ensureCapacity();
    this._head = (this._head - 1) & this._mask;
    this._values[this._head] = value;
    this._size++;
    this.touch();
  }

  pushBack(value: T): void {
    assertDefined(value);
    this.ensureCapacity();
    this._values[this.physical(this._size)] = value;
    this._size++;
    this.touch();
  }

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

  front(): T | undefined {
    return this._size === 0 ? undefined : this._values[this._head];
  }

  back(): T | undefined {
    return this._size === 0 ? undefined : this._values[this.physical(this._size - 1)];
  }

  push(value: T): void {
    this.pushBack(value);
  }

  pop(): T | undefined {
    return this.popBack();
  }

  unshift(value: T): void {
    this.pushFront(value);
  }

  shift(): T | undefined {
    return this.popFront();
  }

  first(): T | undefined {
    return this.front();
  }

  last(): T | undefined {
    return this.back();
  }

  indexOf(value: T, from?: number): number {
    checkOptionalInteger(from, "from");
    const values = this.toArray();
    return from === undefined ? values.indexOf(value) : values.indexOf(value, from);
  }

  lastIndexOf(value: T, from?: number): number {
    checkOptionalInteger(from, "from");
    const values = this.toArray();
    return from === undefined ? values.lastIndexOf(value) : values.lastIndexOf(value, from);
  }

  slice(start?: number, end?: number): T[] {
    checkOptionalInteger(start, "start");
    checkOptionalInteger(end, "end");
    return this.toArray().slice(start, end);
  }

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

  reverse(): this {
    this._resetFrom(this.toArray().reverse());
    return this;
  }

  sort(compare?: Comparator<T>): this {
    if (compare !== undefined) {
      assertComparator(compare);
    }
    this._resetFrom(this.toArray().sort(compare));
    return this;
  }

  serialize(): string {
    return serializeValues("ArrayDeque", this.toArray());
  }

  static deserialize<T>(json: unknown): ArrayDeque<T> {
    const deque = new ArrayDeque<T>();
    for (const value of deserializeValues(json, "ArrayDeque")) {
      deque.pushBack(value as T);
    }
    return deque;
  }

  clear(): void {
    this._values = new Array(8);
    this._mask = 7;
    this._head = 0;
    this._size = 0;
    this.touch();
  }

  toArray(): T[] {
    const values: T[] = new Array(this._size);
    for (let i = 0; i < this._size; i++) {
      values[i] = this._values[this.physical(i)] as T;
    }
    return values;
  }

  [Symbol.iterator](): IterableIterator<T> {
    return this.snapshotIterator(this.toArray());
  }

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

export class ArrayStack<T> implements Stack<T> {
  private readonly _deque = new ArrayDeque<T>();

  get size(): number {
    return this._deque.size;
  }

  isEmpty(): boolean {
    return this._deque.isEmpty();
  }

  push(value: T): void {
    this._deque.pushBack(value);
  }

  pop(): T | undefined {
    return this._deque.popBack();
  }

  peek(): T | undefined {
    return this._deque.back();
  }

  serialize(): string {
    return serializeValues("ArrayStack", this.toArray());
  }

  static deserialize<T>(json: unknown): ArrayStack<T> {
    const stack = new ArrayStack<T>();
    for (const value of deserializeValues(json, "ArrayStack")) {
      stack.push(value as T);
    }
    return stack;
  }

  clear(): void {
    this._deque.clear();
  }

  toArray(): T[] {
    return this._deque.toArray();
  }

  [Symbol.iterator](): IterableIterator<T> {
    return this._deque[Symbol.iterator]();
  }

  validate(): true | string {
    return this._deque.validate();
  }
}

export class ArrayQueue<T> implements Queue<T> {
  private readonly _deque = new ArrayDeque<T>();

  get size(): number {
    return this._deque.size;
  }

  isEmpty(): boolean {
    return this._deque.isEmpty();
  }

  enqueue(value: T): void {
    this._deque.pushBack(value);
  }

  dequeue(): T | undefined {
    return this._deque.popFront();
  }

  peek(): T | undefined {
    return this._deque.front();
  }

  serialize(): string {
    return serializeValues("ArrayQueue", this.toArray());
  }

  static deserialize<T>(json: unknown): ArrayQueue<T> {
    const queue = new ArrayQueue<T>();
    for (const value of deserializeValues(json, "ArrayQueue")) {
      queue.enqueue(value as T);
    }
    return queue;
  }

  clear(): void {
    this._deque.clear();
  }

  toArray(): T[] {
    return this._deque.toArray();
  }

  [Symbol.iterator](): IterableIterator<T> {
    return this._deque[Symbol.iterator]();
  }

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

  peek(): T | undefined {
    return this._head?.value;
  }

  serialize(): string {
    return serializeValues("LinkedQueue", this.toArray());
  }

  static deserialize<T>(json: unknown): LinkedQueue<T> {
    const queue = new LinkedQueue<T>();
    for (const value of deserializeValues(json, "LinkedQueue")) {
      queue.enqueue(value as T);
    }
    return queue;
  }

  clear(): void {
    this._head = null;
    this._tail = null;
    this._size = 0;
    this._version++;
  }

  toArray(): T[] {
    const values: T[] = [];
    for (let node = this._head; node !== null; node = node.next) {
      values.push(node.value);
    }
    return values;
  }

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
