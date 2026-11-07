# Common API Contract

Every ds-app structure implements the contracts below unless its part document
explicitly documents a deviation. The contracts are TypeScript interfaces; the
compiled package ships the same shapes in `.d.ts` files.

- Shared rules live here: comparators, empty results, iteration order,
  invalidation, ownership, errors, validation.
- Each part document lists its own operations and the **time complexity of every
  implementation** for those operations.

---

## Comparators

```ts
export type Comparator<T> = (a: T, b: T) => number;
```

A comparator must define a consistent total order and return a negative number,
zero, or a positive number. If omitted, the default comparator supports
`number`, `bigint`, `string`, `Date`, and objects with `valueOf` returning one of
those. Other types require an explicit comparator; otherwise the constructor
throws `TypeError`.

Ordered structures treat comparator equality as key identity. Two keys that
compare equal are the same key.

## Container

```ts
export interface Container<T> {
  readonly size: number;
  isEmpty(): boolean;
  clear(): void;
  toArray(): T[];
  [Symbol.iterator](): IterableIterator<T>;
  validate(): true | string;
}
```

| Member | Semantics |
|--------|-----------|
| `size` | Number of stored elements; never negative. |
| `isEmpty()` | `size === 0`. |
| `clear()` | Removes all elements in O(n) or better; releases references. |
| `toArray()` | Snapshot in iteration order; does not consume the container. |
| `[Symbol.iterator]()` | Iterates without consuming; may be invalidated by mutation. |
| `validate()` | Returns `true` or a string describing the first invariant violation. O(n) unless documented otherwise. |

`undefined` is not a valid stored element, key, or map value. Operations that
return a single element return `undefined` when there is no such element, which
is unambiguous because stored values cannot be `undefined`.

## Ordered map / ordered set

```ts
export interface RangeOptions<K> {
  lo?: 'inclusive' | 'exclusive';
  hi?: 'inclusive' | 'exclusive';
}

export interface OrderedMap<K, V = K> extends Container<[K, V]> {
  readonly compare: Comparator<K>;
  set(key: K, value: V): this;
  get(key: K): V | undefined;
  has(key: K): boolean;
  delete(key: K): boolean;
  min(): [K, V] | undefined;
  max(): [K, V] | undefined;
  predecessor(key: K): [K, V] | undefined;
  successor(key: K): [K, V] | undefined;
  at(index: number): [K, V] | undefined;
  indexOf(key: K): number;
  range(lo?: K, hi?: K, options?: RangeOptions<K>): IterableIterator<[K, V]>;
  keys(): IterableIterator<K>;
  values(): IterableIterator<V>;
  entries(): IterableIterator<[K, V]>;
}
```

- `set` replaces the value for a comparator-equal key and returns `this`.
- `delete` returns `true` only if a key was removed.
- `at(index)` and `indexOf(key)` are order-statistic operations. Structures
  that cannot support them in the documented bound throw `UnsupportedError`.
- `range` defaults to inclusive bounds at both ends and iterates ascending.
- Iteration order is ascending by key.
- `validate()` also checks comparator ordering and balance invariants.

## Priority queue

```ts
export interface PriorityQueue<T> extends Container<T> {
  push(value: T): void;
  pop(): T | undefined;
  peek(): T | undefined;
}
```

- `peek` and `pop` return `undefined` when empty.
- Iteration order is implementation-defined unless the part document promises
  sorted order. `toArray()` matches iteration order.
- `pop` on an empty queue returns `undefined` and does not throw.

## Meldable priority queue

```ts
export interface MeldablePriorityQueue<T> extends PriorityQueue<T> {
  merge(other: MeldablePriorityQueue<T>): MeldablePriorityQueue<T>;
}
```

`merge` is destructive: it consumes `other`, and any later operation on `other`
throws `ConsumedError`. The returned queue owns both sets of elements.
Implementations that cannot merge in the documented bound throw
`UnsupportedError`.

## Double-ended priority queue

```ts
export interface DoubleEndedPriorityQueue<T> extends Container<T> {
  push(value: T): void;
  popMin(): T | undefined;
  popMax(): T | undefined;
  peekMin(): T | undefined;
  peekMax(): T | undefined;
}
```

`peekMin`/`peekMax` return `undefined` only when the queue is empty. When one
element remains, `popMin` and `popMax` both remove it.

## Set

```ts
export interface SetLike<E> extends Container<E> {
  add(value: E): boolean;
  delete(value: E): boolean;
  has(value: E): boolean;
  union(other: Iterable<E>): SetLike<E>;
  intersection(other: Iterable<E>): SetLike<E>;
  difference(other: Iterable<E>): SetLike<E>;
  symmetricDifference(other: Iterable<E>): SetLike<E>;
  isSubsetOf(other: Iterable<E>): boolean;
  isSupersetOf(other: Iterable<E>): boolean;
  equals(other: Iterable<E>): boolean;
}
```

- `add` returns `true` only if the element was absent.
- `delete` returns `true` only if the element was present.
- Set-algebra methods return a new set and do not mutate either operand.
- `equals` compares membership, not iteration order.

## Spatial index

```ts
export type Point = readonly number[];
export type Bounds = { readonly min: Point; readonly max: Point };

export interface NearestResult<T> {
  value: T;
  distance: number;
}

export interface SpatialIndex<T> extends Container<T> {
  insert(bounds: Bounds, value: T): void;
  delete(bounds: Bounds, value?: T): boolean;
  search(bounds: Bounds): T[];
  nearest(point: Point, k?: number): NearestResult<T>[];
}
```

- `Bounds` is a closed axis-aligned box; `min[i] <= max[i]`.
- Points and bounds must have the index's dimension, otherwise `RangeError`.
- `search` reports exact matches unless the part is approximate.
- `nearest` returns up to `k` results sorted by increasing distance.
- Ties are broken deterministically by insertion order.

## String index

```ts
export interface StringIndex extends Container<number> {
  readonly textLength: number;
  contains(pattern: string): boolean;
  count(pattern: string): number;
  search(pattern: string): number[];
  longestRepeatedSubstring(): { start: number; length: number };
  suffixArray(): Int32Array;
  lcpArray(): Int32Array;
}
```

- Positions are code-unit offsets unless a part documents code-point offsets.
- `search` returns occurrence start positions in ascending order.
- Empty patterns follow the part document; the default is a `RangeError`.

## Shared semantics

1. **Empty results.** Single-element reads return `undefined` when no element
   exists. Bulk reads return an empty array or iterator.
2. **No implicit copies.** Destructive operations are named and documented
   (`merge`, `split`, `join`, `drain`). All other operations leave inputs
   untouched. A container consumed by a destructive operation is invalid, and
   every later operation on it throws `ConsumedError`.
3. **Iteration order.** Ordered containers iterate ascending by key. Unordered
   containers document their iteration order. Mutating a container invalidates
   its live iterators; using one afterwards throws
   `ConcurrentModificationError`.
4. **Fail fast on arguments.** Wrong arity, wrong dimension, invalid comparator,
   and out-of-range indices throw `TypeError` or `RangeError`. No silent
   coercion.
5. **Invariants.** `validate()` checks the structure's invariants and returns
   the first failure as a human-readable string. It never mutates.
6. **Determinism.** Randomized structures take an optional seeded PRNG and
   produce identical results for the same seed and operation sequence.
7. **No runtime dependencies.** Structures use only the language runtime and
   `src/core` helpers.
8. **Complexity notation.** `n` elements, `h` height, `α` load factor, `d`
   dimension, `L` key length, `m` pattern length, `k` reported results, `B`
   node capacity, `ε` approximation parameter, `U` universe size, `σ` alphabet
   size.
9. **Amortized and expected bounds.** These are labeled explicitly; a bare
   `O(...)` in a table is a worst-case bound.
10. **Serialization.** Where offered, `toJSON()` emits a stable shape and
    `fromJSON()` validates it. Serialization is not part of the core contract.

## Errors

```ts
export class UnsupportedError extends Error {}
export class ConcurrentModificationError extends Error {}
export class ConsumedError extends Error {}
```

`TypeError`, `RangeError`, and these subclasses are the only errors thrown for
documented misuse. `ConsumedError` is thrown by a container that was consumed by
`merge`, `join`, or `split`, and by a handle (finger, cursor) into such a
container. Internal invariant failures throw `Error`.

## Versioning

Adding an optional operation is a minor release. Changing a return type,
iteration order, ownership rule, or documented complexity bound is a major
release.
