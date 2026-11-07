import {
  assertComparator,
  assertDefined,
  assertInteger,
  ContainerBase,
} from "../core/index.ts";
import type { Comparator } from "../core/index.ts";
import { deserializeValues, serializeValues } from "./serialization.ts";
import type { ListLike } from "./types.ts";

function checkOptionalInteger(value: number | undefined, name: string): void {
  if (value !== undefined) {
    assertInteger(value, name);
  }
}

class SinglyNode<T> {
  value: T;
  next: SinglyNode<T> | null = null;

  constructor(value: T) {
    this.value = value;
  }
}

export class SinglyLinkedList<T> extends ContainerBase<T> implements ListLike<T> {
  private _head: SinglyNode<T> | null = null;
  private _tail: SinglyNode<T> | null = null;

  private nodeAt(index: number): SinglyNode<T> | null {
    let node = this._head;
    for (let i = 0; i < index && node !== null; i++) {
      node = node.next;
    }
    return node;
  }

  get(index: number): T | undefined {
    assertInteger(index);
    if (index < 0 || index >= this._size) {
      return undefined;
    }
    return this.nodeAt(index)?.value;
  }

  set(index: number, value: T): T {
    assertInteger(index);
    assertDefined(value);
    if (index < 0 || index >= this._size) {
      throw new RangeError("index is out of range");
    }
    const node = this.nodeAt(index)!;
    const previous = node.value;
    node.value = value;
    this.touch();
    return previous;
  }

  insert(index: number, value: T): void {
    assertInteger(index);
    assertDefined(value);
    if (index < 0 || index > this._size) {
      throw new RangeError("index is out of range");
    }
    if (index === 0) {
      this.unshift(value);
      return;
    }
    if (index === this._size) {
      this.push(value);
      return;
    }
    const previous = this.nodeAt(index - 1)!;
    const node = new SinglyNode(value);
    node.next = previous.next;
    previous.next = node;
    this._size++;
    this.touch();
  }

  remove(index: number): T | undefined {
    assertInteger(index);
    if (index < 0 || index >= this._size) {
      return undefined;
    }
    if (index === 0) {
      return this.shift();
    }
    if (index === this._size - 1) {
      return this.pop();
    }
    const previous = this.nodeAt(index - 1)!;
    const node = previous.next!;
    previous.next = node.next;
    this._size--;
    this.touch();
    return node.value;
  }

  push(value: T): void {
    assertDefined(value);
    const node = new SinglyNode(value);
    if (this._tail === null) {
      this._head = node;
      this._tail = node;
    } else {
      this._tail.next = node;
      this._tail = node;
    }
    this._size++;
    this.touch();
  }

  pop(): T | undefined {
    if (this._size === 0) {
      return undefined;
    }
    if (this._size === 1) {
      const value = this._head!.value;
      this._head = null;
      this._tail = null;
      this._size = 0;
      this.touch();
      return value;
    }
    const previous = this.nodeAt(this._size - 2)!;
    const value = previous.next!.value;
    previous.next = null;
    this._tail = previous;
    this._size--;
    this.touch();
    return value;
  }

  unshift(value: T): void {
    assertDefined(value);
    const node = new SinglyNode(value);
    node.next = this._head;
    this._head = node;
    if (this._tail === null) {
      this._tail = node;
    }
    this._size++;
    this.touch();
  }

  shift(): T | undefined {
    if (this._size === 0) {
      return undefined;
    }
    const node = this._head!;
    this._head = node.next;
    if (this._head === null) {
      this._tail = null;
    }
    this._size--;
    this.touch();
    return node.value;
  }

  first(): T | undefined {
    return this._head?.value;
  }

  last(): T | undefined {
    return this._tail?.value;
  }

  indexOf(value: T, from?: number): number {
    checkOptionalInteger(from, "from");
    let index = 0;
    const start = from === undefined ? 0 : from < 0 ? Math.max(this._size + from, 0) : from;
    let node = this._head;
    while (node !== null) {
      if (index >= start && node.value === value) {
        return index;
      }
      index++;
      node = node.next;
    }
    return -1;
  }

  lastIndexOf(value: T, from?: number): number {
    checkOptionalInteger(from, "from");
    const items = this.toArray();
    return from === undefined ? items.lastIndexOf(value) : items.lastIndexOf(value, from);
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
    let previous: SinglyNode<T> | null = null;
    let node = this._head;
    this._tail = this._head;
    while (node !== null) {
      const next = node.next;
      node.next = previous;
      previous = node;
      node = next;
    }
    this._head = previous;
    this.touch();
    return this;
  }

  sort(compare?: Comparator<T>): this {
    if (compare !== undefined) {
      assertComparator(compare);
    }
    const values = this.toArray().sort(compare);
    this._resetFrom(values);
    return this;
  }

  serialize(): string {
    return serializeValues("SinglyLinkedList", this.toArray());
  }

  static deserialize<T>(json: unknown): SinglyLinkedList<T> {
    const list = new SinglyLinkedList<T>();
    for (const value of deserializeValues(json, "SinglyLinkedList")) {
      list.push(value as T);
    }
    return list;
  }

  clear(): void {
    this._head = null;
    this._tail = null;
    this._size = 0;
    this.touch();
  }

  toArray(): T[] {
    const values: T[] = [];
    let node = this._head;
    while (node !== null) {
      values.push(node.value);
      node = node.next;
    }
    return values;
  }

  [Symbol.iterator](): IterableIterator<T> {
    return this.snapshotIterator(this.toArray());
  }

  validate(): true | string {
    let count = 0;
    let node = this._head;
    const seen = new Set<SinglyNode<T>>();
    while (node !== null) {
      if (seen.has(node)) {
        return "cycle detected in forward links";
      }
      seen.add(node);
      if (node.value === undefined) {
        return `node at index ${count} is undefined`;
      }
      if (node.next === null && node !== this._tail) {
        return "tail pointer is not the last node";
      }
      count++;
      if (count > this._size) {
        return "list contains more nodes than size";
      }
      node = node.next;
    }
    if (count !== this._size) {
      return `size ${this._size} does not match node count ${count}`;
    }
    if (this._size > 0 && this._tail?.next !== null) {
      return "tail has a successor";
    }
    if (this._size === 0 && (this._head !== null || this._tail !== null)) {
      return "empty list has non-null endpoints";
    }
    return true;
  }

  private _resetFrom(values: T[]): void {
    this._head = null;
    this._tail = null;
    this._size = 0;
    for (const value of values) {
      assertDefined(value);
      const node = new SinglyNode(value);
      if (this._tail === null) {
        this._head = node;
      } else {
        this._tail.next = node;
      }
      this._tail = node;
      this._size++;
    }
    this.touch();
  }
}

class DoublyNode<T> {
  value: T | undefined;
  prev: DoublyNode<T>;
  next: DoublyNode<T>;

  constructor(value: T | undefined, prev?: DoublyNode<T>, next?: DoublyNode<T>) {
    this.value = value;
    this.prev = prev ?? this;
    this.next = next ?? this;
  }
}

export class DoublyLinkedList<T> extends ContainerBase<T> implements ListLike<T> {
  private readonly _head: DoublyNode<T>;

  constructor() {
    super();
    this._head = new DoublyNode<T>(undefined);
    this._head.prev = this._head;
    this._head.next = this._head;
  }

  protected get sentinel(): DoublyNode<T> {
    return this._head;
  }

  private nodeAt(index: number): DoublyNode<T> {
    if (index < this._size / 2) {
      let node = this._head.next;
      for (let i = 0; i < index; i++) {
        node = node.next;
      }
      return node;
    }
    let node = this._head.prev;
    for (let i = this._size - 1; i > index; i--) {
      node = node.prev;
    }
    return node;
  }

  private insertBefore(where: DoublyNode<T>, value: T): DoublyNode<T> {
    const node = new DoublyNode(value);
    node.prev = where.prev;
    node.next = where;
    where.prev.next = node;
    where.prev = node;
    return node;
  }

  private unlink(node: DoublyNode<T>): T {
    node.prev.next = node.next;
    node.next.prev = node.prev;
    const value = node.value as T;
    node.value = undefined;
    node.prev = this._head;
    node.next = this._head;
    return value;
  }

  get(index: number): T | undefined {
    assertInteger(index);
    if (index < 0 || index >= this._size) {
      return undefined;
    }
    return this.nodeAt(index).value;
  }

  set(index: number, value: T): T {
    assertInteger(index);
    assertDefined(value);
    if (index < 0 || index >= this._size) {
      throw new RangeError("index is out of range");
    }
    const node = this.nodeAt(index);
    const previous = node.value as T;
    node.value = value;
    this.touch();
    return previous;
  }

  insert(index: number, value: T): void {
    assertInteger(index);
    assertDefined(value);
    if (index < 0 || index > this._size) {
      throw new RangeError("index is out of range");
    }
    const where = index === this._size ? this._head : this.nodeAt(index);
    this.insertBefore(where, value);
    this._size++;
    this.touch();
  }

  remove(index: number): T | undefined {
    assertInteger(index);
    if (index < 0 || index >= this._size) {
      return undefined;
    }
    const value = this.unlink(this.nodeAt(index));
    this._size--;
    this.touch();
    return value;
  }

  push(value: T): void {
    assertDefined(value);
    this.insertBefore(this._head, value);
    this._size++;
    this.touch();
  }

  pop(): T | undefined {
    if (this._size === 0) {
      return undefined;
    }
    const value = this.unlink(this._head.prev);
    this._size--;
    this.touch();
    return value;
  }

  unshift(value: T): void {
    assertDefined(value);
    this.insertBefore(this._head.next, value);
    this._size++;
    this.touch();
  }

  shift(): T | undefined {
    if (this._size === 0) {
      return undefined;
    }
    const value = this.unlink(this._head.next);
    this._size--;
    this.touch();
    return value;
  }

  first(): T | undefined {
    return this._size === 0 ? undefined : this._head.next.value;
  }

  last(): T | undefined {
    return this._size === 0 ? undefined : this._head.prev.value;
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
    let node: DoublyNode<T> = this._head;
    do {
      const next = node.next;
      const previous = node.prev;
      node.next = previous;
      node.prev = next;
      node = next;
    } while (node !== this._head);
    this.touch();
    return this;
  }

  sort(compare?: Comparator<T>): this {
    if (compare !== undefined) {
      assertComparator(compare);
    }
    const values = this.toArray().sort(compare);
    this._resetFrom(values);
    return this;
  }

  serialize(): string {
    return serializeValues("DoublyLinkedList", this.toArray());
  }

  static deserialize<T>(json: unknown): DoublyLinkedList<T> {
    const list = new DoublyLinkedList<T>();
    for (const value of deserializeValues(json, "DoublyLinkedList")) {
      list.push(value as T);
    }
    return list;
  }

  clear(): void {
    this._head.next = this._head;
    this._head.prev = this._head;
    this._size = 0;
    this.touch();
  }

  toArray(): T[] {
    const values: T[] = [];
    for (let node = this._head.next; node !== this._head; node = node.next) {
      values.push(node.value as T);
    }
    return values;
  }

  [Symbol.iterator](): IterableIterator<T> {
    return this.snapshotIterator(this.toArray());
  }

  validate(): true | string {
    let count = 0;
    let node = this._head.next;
    let previous = this._head;
    while (node !== this._head) {
      if (node.prev !== previous) {
        return `broken prev link at index ${count}`;
      }
      if (node.value === undefined) {
        return `node at index ${count} is undefined`;
      }
      previous = node;
      node = node.next;
      count++;
      if (count > this._size) {
        return "cycle detected in forward links";
      }
    }
    if (count !== this._size) {
      return `size ${this._size} does not match node count ${count}`;
    }
    if (this._head.prev !== previous) {
      return "sentinel prev link is incorrect";
    }
    let backCount = 0;
    let backward = this._head.prev;
    while (backward !== this._head) {
      backCount++;
      if (backCount > this._size) {
        return "cycle detected in backward links";
      }
      backward = backward.prev;
    }
    if (backCount !== count) {
      return "forward and backward node counts differ";
    }
    return true;
  }

  protected _resetFrom(values: T[]): void {
    this._head.next = this._head;
    this._head.prev = this._head;
    this._size = 0;
    for (const value of values) {
      assertDefined(value);
      this.insertBefore(this._head, value);
      this._size++;
    }
    this.touch();
  }
}

export class CircularList<T> extends DoublyLinkedList<T> {
  override serialize(): string {
    return serializeValues("CircularList", this.toArray());
  }

  static override deserialize<T>(json: unknown): CircularList<T> {
    const list = new CircularList<T>();
    for (const value of deserializeValues(json, "CircularList")) {
      list.push(value as T);
    }
    return list;
  }

  rotate(steps: number): this {
    assertInteger(steps, "steps");
    const n = this._size;
    if (n <= 1) {
      return this;
    }
    const shift = ((steps % n) + n) % n;
    if (shift === 0) {
      return this;
    }
    const sentinel = this.sentinel;
    const a = sentinel.next;
    let split: DoublyNode<T> = a;
    for (let i = 0; i < n - shift - 1; i++) {
      split = split.next;
    }
    const b = split.next;
    const oldLast = sentinel.prev;
    const oldFirst = sentinel.next;
    split.next = sentinel;
    sentinel.prev = split;
    oldLast.next = oldFirst;
    oldFirst.prev = oldLast;
    sentinel.next = b;
    b.prev = sentinel;
    this.touch();
    return this;
  }
}
