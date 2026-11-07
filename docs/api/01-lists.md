# Part 1 — Lists

**Module:** `ds-app/lists` · **Source:** `src/lists/` · **Status:** planned

## Scope

Sequence containers with index-based access, plus linked variants optimized for
insertion and removal at known positions. `ListLike` containers are ordered by
position, not by value, and duplicate elements are allowed. `SortedList` is the
value-ordered exception and uses a separate contract. Restricted-access
sequences (`Deque`, `Stack`, `Queue`) and the order-maintenance list, which
answers "does `a` precede `b`" in O(1) under insertions, have their own
contracts below.

## Common API

```ts
import type { Container, Comparator } from 'ds-app/core';

export interface ListLike<T> extends Container<T> {
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

export interface SortedListLike<T> extends Container<T> {
  add(value: T): boolean;
  remove(value: T): boolean;
  find(value: T): T | undefined;
  min(): T | undefined;
  max(): T | undefined;
  indexOf(value: T): number;
}

export interface Deque<T> extends Container<T> {
  pushFront(value: T): void;
  pushBack(value: T): void;
  popFront(): T | undefined;
  popBack(): T | undefined;
  front(): T | undefined;
  back(): T | undefined;
  get(index: number): T | undefined;
}

export interface Stack<T> extends Container<T> {
  push(value: T): void;
  pop(): T | undefined;
  peek(): T | undefined;
}

export interface Queue<T> extends Container<T> {
  enqueue(value: T): void;
  dequeue(): T | undefined;
  peek(): T | undefined;
}

export interface OrderLabel {
  readonly list: unknown;
}

export interface OrderMaintenanceList<T> extends Container<T> {
  insertAfter(label: OrderLabel | null, value: T): OrderLabel;
  delete(label: OrderLabel): boolean;
  compare(a: OrderLabel, b: OrderLabel): number;
  get(label: OrderLabel): T | undefined;
}
```

Shared members (`size`, `isEmpty`, `clear`, `toArray`, iteration, `validate`)
come from [`Container`](./00-common-contract.md#container).

### Semantics

- Indices must be integers; a non-integer index throws `TypeError`. `get` and
  `remove` return `undefined` for an index outside `[0, size - 1]`, including a
  negative index. `set` outside `[0, size - 1]` and `insert` outside
  `[0, size]` throw `RangeError`. A negative index never counts from the end.
- `set` returns the previous value.
- `insert(size, value)` is equivalent to `push`; `insert(0, value)` is
  equivalent to `unshift`.
- `remove(index)` returns the removed element.
- `indexOf` returns `-1` when absent.
- `slice` and `splice` follow `Array.prototype` behavior, including negative
  indices that count from the end and clamping of out-of-range indices. The
  one difference is that a non-number index throws `TypeError` instead of
  being coerced.
- Iteration is positional, from index `0` to `size - 1`.
- `OrderMaintenanceList.insertAfter(null, value)` inserts at the front.
  `compare` returns a negative, zero, or positive number by list position and
  is O(1); a label from another list throws `TypeError`, and a deleted label
  throws `ConsumedError`.
- `validate()` checks size, index bounds, node link consistency (linked
  variants), and cursor free-list integrity (cursor lists).

## Implementations and complexity

| Implementation | `get` / `set` | Insert/remove front | Insert/remove back | Insert/remove at index | `indexOf` | Iterate | Space |
|----------------|---------------|---------------------|--------------------|------------------------|-----------|---------|-------|
| `ArrayList` | O(1) | O(n) | O(1) amortized | O(n) | O(n) | O(n) | O(n) |
| `SinglyLinkedList` | O(n) | O(1) | O(1) insert, O(n) remove | O(n) | O(n) | O(n) | O(n) |
| `DoublyLinkedList` | O(n) | O(1) | O(1) | O(n) by index, O(1) at a node | O(n) | O(n) | O(n) |
| `CircularList` | O(n) | O(1) | O(1) | O(n) by index, O(1) at a node | O(n) | O(n) | O(n) |
| `CursorList` | O(n) | O(1) | O(1) | O(1) given a cursor, O(n) by index | O(n) | O(n) | O(n) |
| `XorLinkedList` | O(n) | O(1) | O(1) | O(n) | O(n) | O(n) | O(n), one link per node |
| `ArrayDeque` (ring buffer) | O(1) | O(1) amortized | O(1) amortized | O(n) | O(n) | O(n) | O(n) |

`SortedList` is value-ordered and implements `SortedListLike<T>`, not
`ListLike<T>`; positional insertion and replacement would violate its sorted
invariant and are intentionally absent.

| Operation | Sorted array | Sorted linked list |
|-----------|--------------|--------------------|
| `add` / `remove` | O(n) | O(n) |
| `find` | O(log n) | O(n) |
| `min` / `max` | O(1) | O(1) |
| `indexOf` (rank) | O(log n) | O(n) |
| Iterate | O(n) | O(n) |
| Space | O(n) | O(n) |

Definitions: `n` = number of elements. For `SortedList`, `add` and `remove` pay
the cost of search plus shifting or relinking. `CursorList` stores links in
parallel arrays and supports handle-based insert/remove without object
allocation. `XorLinkedList` keeps its nodes in an integer-indexed arena
(JavaScript has no pointer arithmetic) and stores, per node, the XOR of the
previous and next node indices, so it traverses in either direction from an end
but cannot jump to an arbitrary index.

Restricted-access sequences:

| Operation | `ArrayStack` | `ArrayQueue` (ring buffer) | `LinkedQueue` | `OrderMaintenanceList` |
|-----------|--------------|----------------------------|---------------|------------------------|
| `push` / `enqueue` / `insertAfter` | O(1) amortized | O(1) amortized | O(1) | O(1) amortized |
| `pop` / `dequeue` / `delete` | O(1) | O(1) | O(1) | O(1) |
| `peek` / `compare` | O(1) | O(1) | O(1) | O(1) |
| Iterate | O(n) | O(n) | O(n) | O(n) |
| Space | O(n) | O(n) | O(n) | O(n) |

### Variant notes

- `CircularList` supports `rotate(steps)` by walking the head pointer, in
  O(min(|steps| mod n, n - |steps| mod n)); `rotate(±1)` is O(1).
- `SortedList` supports `min()`/`max()` in O(1) when end pointers are kept; it
  does not expose positional `insert`, `set`, `reverse`, or `sort`.
- `XorLinkedList` requires sequential traversal for both directions; there is no
  O(1) backward step from a stored node without an adjacent node handle.
- Generalized and orthogonal lists (sparse matrix representation) are exposed as
  `GeneralizedList` and `OrthogonalList` with domain-specific operations
  (`row`, `column`, `transpose`, `multiply`), not as `ListLike`.
- `ArrayDeque` is a growable ring buffer; `ArrayStack` and `ArrayQueue` wrap it
  with the restricted interfaces, and `LinkedQueue` is the allocation-per-element
  alternative for unbounded producer/consumer use.
- `OrderMaintenanceList` (Dietz and Sleator; Bender et al.) assigns integer
  labels in a two-level scheme and relabels a small neighborhood on overflow,
  giving O(1) amortized insertion and O(1) order comparison. Part 28 uses it to
  linearize version trees.

## Example

```js
import { DoublyLinkedList } from 'ds-app/lists';

const list = new DoublyLinkedList();
list.push('b');
list.unshift('a');
list.insert(2, 'c');
list.toArray();   // ['a', 'b', 'c']
list.remove(1);   // 'b'
list.validate();  // true
```

## Conformance checklist

- Positional operations at `0`, `size - 1`, and `size` are tested for every
  `ListLike` implementation.
- `SortedList` is differential-tested against a sorted-set reference model,
  including duplicate handling and rank/index queries.
- Linked variants are checked for link integrity after randomized
  insert/remove sequences.
- `splice`/`slice` are differential-tested against `Array.prototype`.
- `validate()` detects a broken link or cursor free-list cycle in a deliberately
  corrupted structure.
- `Deque`, `Stack`, and `Queue` are differential-tested against an array model,
  including wraparound of the ring buffer.
- `OrderMaintenanceList.compare` agrees with insertion order after 10^6 random
  inserts and deletes concentrated at one position.
