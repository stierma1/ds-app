# Part 4 — Leftist Trees

**Module:** `ds-app/leftist-trees` · **Source:** `src/leftist-trees/` · **Status:** planned

## Scope

Meldable priority queues implemented as leftist trees. A leftist tree maintains
the null-path-length (rank) invariant: for every node, the right child's rank is
not greater than the left child's. This guarantees that the right spine is
`O(log n)` long, so melding two trees is `O(log n)` worst case.

## Common API

```ts
import type { Comparator, MeldablePriorityQueue } from 'ds-app/core';

export interface LeftistHeap<T> extends MeldablePriorityQueue<T> {
  readonly compare: Comparator<T>;
  readonly rank: number;
  merge(other: LeftistHeap<T>): LeftistHeap<T>;
  peekMin(): T | undefined;
}

export interface DoubleEndedLeftistTree<T> extends LeftistHeap<T> {
  peekMax(): T | undefined;
  popMin(): T | undefined;
  popMax(): T | undefined;
}
```

Shared members (`size`, `isEmpty`, `clear`, `toArray`, iteration, `validate`)
come from [`Container`](./00-common-contract.md#container); `push`, `pop`,
`peek`, and `merge` come from
[`MeldablePriorityQueue`](./00-common-contract.md#meldable-priority-queue).

### Semantics

- `merge` is destructive: `a.merge(b)` consumes `b` and returns the merged
  heap. `a` must not be used independently afterwards; the returned heap owns
  both. Any operation on a consumed heap throws `ConsumedError`.
- A single-element heap has `rank = 1`; the null tree has `rank = 0`.
- `peek`/`peekMin` are O(1) and return `undefined` when empty. `peekMax` is
  available only on `DoubleEndedLeftistTree`.
- `popMin`/`popMax` remove exactly one element. With one element left, both
  remove it.
- Ties are broken arbitrarily.
- `toArray()` and iteration order are implementation-defined (heap order, not
  sorted order).
- `validate()` checks heap order, the leftist rank invariant, rank values,
  parent links (if kept), and size.

## Implementations and complexity

| Operation | Height-biased leftist | Weight-biased leftist | Double-ended leftist |
|-----------|-----------------------|-----------------------|----------------------|
| `push` | O(log n) | O(log n) | O(log n) |
| `pop` / `popMin` | O(log n) | O(log n) | O(log n) |
| `popMax` | — | — | O(log n) |
| `peek` / `peekMin` | O(1) | O(1) | O(1) |
| `peekMax` | — | — | O(1) |
| `merge` | O(log n) | O(log n) | O(log n) |
| `build` from n items | O(n) bottom-up | O(n) bottom-up | O(n log n) |
| Space | O(n) | O(n) | O(n) |

Definitions: `n` = number of elements. All bounds are worst case, not amortized.
`build` is the two-pass bottom-up construction that melds singleton trees level
by level; repeated `push` costs `O(n log n)`.

### Notes

- Height-biased leftists store the null-path length (rank) at each node.
- Weight-biased leftists store subtree size instead of rank and also guarantee
  `O(log n)` meld; they tend to have a better constant for some workloads.
- A max-heap is the same structure with the comparator reversed, not a separate
  implementation.
- The double-ended variant maintains min and max structures or a min-max
  leftist variant; each pop is `O(log n)`.

## Example

```js
import { LeftistHeap } from 'ds-app/leftist-trees';

const a = new LeftistHeap((x, y) => x - y);
const b = new LeftistHeap((x, y) => x - y);
[5, 1, 9].forEach((v) => a.push(v));
[7, 3].forEach((v) => b.push(v));

const merged = a.merge(b);
merged.peek(); // 1
merged.pop();  // 1
merged.validate(); // true
```

## Conformance checklist

- Random melds maintain heap order and the rank invariant.
- Meld results agree with a reference binary heap on sorted drain order.
- `merge` invalidates the consumed heap; using it afterwards throws
  `ConsumedError`.
- Bottom-up build produces a valid leftist tree for random and sorted inputs.
- Double-ended operations agree with a sorted reference model.
