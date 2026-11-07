import type { Comparator, Container, Serializable } from "../core/index.ts";

/**
 * Index-addressable list ADT shared by ArrayList, ArrayDeque, the linked lists,
 * CursorList and XorLinkedList. Bounds differ sharply by implementation: arrays
 * give O(1) get/set but O(n) middle insert; linked variants give O(1) end
 * operations but walk for every index. slice always returns a fresh array;
 * splice and sort rebuild linked implementations wholesale. See each class.
 */
export interface ListLike<T> extends Container<T>, Serializable {
  get(index: number): T | undefined;
  set(index: number, value: T): T;
  insert(index: number, value: T): void;
  remove(index: number): T | undefined;
  push(value: T): void;
  pop(): T | undefined;
  unshift(value: T): void;
  shift(): T | undefined;
  first(): T | undefined;
  last(): T | undefined;
  indexOf(value: T, from?: number): number;
  lastIndexOf(value: T, from?: number): number;
  slice(start?: number, end?: number): T[];
  splice(start: number, deleteCount?: number, ...items: T[]): T[];
  reverse(): this;
  sort(compare?: Comparator<T>): this;
  merge(other: Iterable<T>): this;
  split(index: number): ListLike<T>;
}

/**
 * Sorted set ADT (add rejects comparator-equal duplicates). SortedList answers
 * find/indexOf by binary search; SortedLinkedList scans linearly.
 */
export interface SortedListLike<T> extends Container<T>, Serializable {
  add(value: T): boolean;
  remove(value: T): boolean;
  find(value: T): T | undefined;
  min(): T | undefined;
  max(): T | undefined;
  indexOf(value: T): number;
  merge(other: Iterable<T>): this;
}

/** Double-ended queue; ArrayDeque implements every operation here in O(1) amortized. */
export interface Deque<T> extends Container<T>, Serializable {
  pushFront(value: T): void;
  pushBack(value: T): void;
  popFront(): T | undefined;
  popBack(): T | undefined;
  front(): T | undefined;
  back(): T | undefined;
  get(index: number): T | undefined;
}

/** LIFO stack; ArrayStack gives O(1) amortized push/pop over a ring buffer. */
export interface Stack<T> extends Container<T>, Serializable {
  push(value: T): void;
  pop(): T | undefined;
  peek(): T | undefined;
}

/** FIFO queue; ArrayQueue is O(1) amortized, LinkedQueue is O(1) worst case. */
export interface Queue<T> extends Container<T>, Serializable {
  enqueue(value: T): void;
  dequeue(): T | undefined;
  peek(): T | undefined;
}

/**
 * Opaque handle returned by OrderMaintenanceList.insertAfter; it is the node
 * itself, so it stays valid across relabels and resolves in O(1).
 */
export interface OrderLabel {
  readonly list: unknown;
}

/**
 * Total-order maintenance ADT: O(1) compare between any two live labels, O(1)
 * delete, and O(1) amortized insertAfter (two-level labeling; the rare relabel
 * touches one O(log n) bucket or a small range of bucket tags, never the list).
 */
export interface OrderMaintenanceList<T> extends Container<T>, Serializable {
  insertAfter(label: OrderLabel | null, value: T): OrderLabel;
  delete(label: OrderLabel): boolean;
  compare(a: OrderLabel, b: OrderLabel): number;
  get(label: OrderLabel): T | undefined;
}
