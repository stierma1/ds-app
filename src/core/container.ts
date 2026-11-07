import type { Comparator } from "./comparator.ts";
import { ConcurrentModificationError } from "./errors.ts";
import type { Serializable } from "./serialization.ts";

export type { Comparator } from "./comparator.ts";

export interface Container<T> extends Iterable<T>, Serializable {
  readonly size: number;
  isEmpty(): boolean;
  clear(): void;
  toArray(): T[];
  [Symbol.iterator](): IterableIterator<T>;
  validate(): true | string;
}

export function assertInteger(value: number, name = "index"): void {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TypeError(`${name} must be an integer`);
  }
}

export function assertDefined<T>(
  value: T | undefined,
  name = "value",
): asserts value is T {
  if (value === undefined) {
    throw new TypeError(`${name} must not be undefined`);
  }
}

export function assertInRange(
  value: number,
  min: number,
  maxInclusive: number,
  name = "index",
): void {
  if (value < min || value > maxInclusive) {
    throw new RangeError(`${name} is out of range`);
  }
}

export function assertComparator<T>(compare: Comparator<T>): void {
  if (typeof compare !== "function") {
    throw new TypeError("Comparator must be a function");
  }
}

export abstract class ContainerBase<T> implements Container<T> {
  protected _size = 0;
  protected _version = 0;

  get size(): number {
    return this._size;
  }

  get version(): number {
    return this._version;
  }

  isEmpty(): boolean {
    return this._size === 0;
  }

  abstract clear(): void;
  abstract toArray(): T[];
  abstract [Symbol.iterator](): IterableIterator<T>;
  abstract validate(): true | string;
  abstract serialize(): string;

  protected touch(): void {
    this._version++;
  }

  protected snapshotIterator<U>(values: U[]): IterableIterator<U> {
    const container = this;
    const expected = this._version;
    let index = 0;
    const iterator: IterableIterator<U> = {
      next(): IteratorResult<U> {
        if (container._version !== expected) {
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
}
