# Part 7 — Double-Ended Priority Queues

**Module:** `ds-app/depq` · **Source:** `src/depq/` · **Status:** done

## Scope

Priority queues that expose both the minimum and the maximum in O(1) while
supporting insertion and deletion at either end. The common interface is
`DoubleEndedPriorityQueue<T>`.

## Common API

```ts
import type { Comparator, DoubleEndedPriorityQueue } from 'ds-app/core';

export interface Depq<T> extends DoubleEndedPriorityQueue<T> {
  readonly compare: Comparator<T>;
  readonly height: number;
  build(values: Iterable<T>): void;
  getMin(): T | undefined;
  getMax(): T | undefined;
}
```

Shared members (`size`, `isEmpty`, `clear`, `toArray`, iteration, `validate`)
come from [`Container`](./00-common-contract.md#container); the four
double-ended operations come from
[`DoubleEndedPriorityQueue`](./00-common-contract.md#double-ended-priority-queue).

### Semantics

- `peekMin()`/`peekMax()` return `undefined` only when the queue is empty;
  `getMin()`/`getMax()` are aliases.
- When exactly one element remains, both `popMin()` and `popMax()` remove it.
- Ties are broken arbitrarily.
- `build(values)` replaces the contents where supported.
- Iteration order is implementation-defined.
- `validate()` checks both heap-order directions and the representation's
  invariants (for example, the deap's corresponding-node relation).

## Implementations and complexity

| Implementation | `push` | `popMin` | `popMax` | `peekMin` | `peekMax` | `build` | Space |
|----------------|--------|----------|----------|-----------|-----------|---------|-------|
| `MinMaxHeap` | O(log n) | O(log n) | O(log n) | O(1) | O(1) | O(n) | O(n) |
| `Deap` | O(log n) | O(log n) | O(log n) | O(1) | O(1) | O(n log n)* | O(n) |
| `IntervalHeap` | O(log n) | O(log n) | O(log n) | O(1) | O(1) | O(n log n)* | O(n) |
| `SymmetricMinMaxHeap` | O(log n) | O(log n) | O(log n) | O(1) | O(1) | O(n log n)* | O(n) |
| `TwoHeapDepq` (lazy) | O(log n) | O(log n) amortized | O(log n) amortized | O(1) amortized | O(1) amortized | O(n) | O(n) |
| `SortedArrayDepq` | O(n) | O(1) | O(1) | O(1) | O(1) | O(n log n) | O(n) |
| `BalancedTreeDepq` | O(log n) | O(log n) | O(log n) | O(log n) | O(log n) | O(n log n) | O(n) |

Definitions: `n` = number of elements. `MinMaxHeap` and `TwoHeapDepq` support
O(n) construction. `Deap`, `IntervalHeap`, and `SymmetricMinMaxHeap` rebuild by repeated insertion in
this implementation, which is O(n log n); the published structures also admit
O(n) bottom-up construction. `TwoHeapDepq` keeps a min-heap and a
max-heap with lazy invalidation; each element can be stale in one heap, so
`peek`/`pop` may discard stale roots before returning, so those bounds are
amortized. `SortedArrayDepq` pops from
either end of a sorted array.

### Notes

- `MinMaxHeap` alternates min and max levels; insertion bubbles up along the
  min or max levels and deletion trickles down through grandchildren.
- `Deap` leaves the root slot empty: the root's left subtree is a min heap and
  its right subtree is a max heap (minimum at index 2 and maximum at index 3
  with 1-based indexing). Each node is paired against a corresponding node in
  the other subtree.
- `IntervalHeap` stores intervals whose endpoints are a min and a max; each
  node holds one or two elements.
- `SymmetricMinMaxHeap` (Arvind & Pandu Rangan) is a complete binary tree
  with an empty root: every left sibling is ≤ its right sibling, and every
  node lies between the left and right children of its grandparent. The
  minimum is at node 2 and the maximum at node 3 (1-based). Insertion moves a
  hole up the grandparent chain; deletion moves a hole down one side, trading
  with the sibling when the sibling order would break.
- `TwoHeapDepq` is the simplest correct implementation and a useful reference
  model, but its lazy deletion gives it higher constants.
- `BalancedTreeDepq` is the ordered-map implementation; it supports the same
  interface through `min`/`max`/`delete`.
- All five array-based structures use contiguous storage and are cache-friendly.

## Example

```js
import { MinMaxHeap } from 'ds-app/depq';

const q = new MinMaxHeap((a, b) => a - b);
[4, 9, 1, 7].forEach((v) => q.push(v));

q.peekMin(); // 1
q.peekMax(); // 9
q.popMin();  // 1
q.popMax();  // 9
q.validate(); // true
```

## Conformance checklist

- `peekMin`/`peekMax` agree with a sorted reference after every operation.
- Draining alternately from both ends yields the full sorted sequence.
- The single-element case removes the element from both ends exactly once.
- Randomized push/popMin/popMax logs are differential-tested.
- `validate()` detects a violated min-level or max-level ordering.
- `build` matches repeated insertion for all implementations.
