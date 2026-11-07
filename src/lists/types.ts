import type { Comparator, Container, Serializable } from "../core/index.ts";

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
}

export interface SortedListLike<T> extends Container<T>, Serializable {
  add(value: T): boolean;
  remove(value: T): boolean;
  find(value: T): T | undefined;
  min(): T | undefined;
  max(): T | undefined;
  indexOf(value: T): number;
}

export interface Deque<T> extends Container<T>, Serializable {
  pushFront(value: T): void;
  pushBack(value: T): void;
  popFront(): T | undefined;
  popBack(): T | undefined;
  front(): T | undefined;
  back(): T | undefined;
  get(index: number): T | undefined;
}

export interface Stack<T> extends Container<T>, Serializable {
  push(value: T): void;
  pop(): T | undefined;
  peek(): T | undefined;
}

export interface Queue<T> extends Container<T>, Serializable {
  enqueue(value: T): void;
  dequeue(): T | undefined;
  peek(): T | undefined;
}

export interface OrderLabel {
  readonly list: unknown;
}

export interface OrderMaintenanceList<T> extends Container<T>, Serializable {
  insertAfter(label: OrderLabel | null, value: T): OrderLabel;
  delete(label: OrderLabel): boolean;
  compare(a: OrderLabel, b: OrderLabel): number;
  get(label: OrderLabel): T | undefined;
}
