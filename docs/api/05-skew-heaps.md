# Part 5 — Skew Heaps

**Module:** `ds-app/skew-heaps` · **Source:** `src/skew-heaps/` · **Status:** done

## Scope

Self-adjusting meldable heaps. A skew heap drops all balance metadata and
unconditionally swaps children during meld. Every operation is `O(log n)`
amortized and can be `O(n)` in the worst case for a single operation.

## Common API

```ts
import type { Comparator, MeldablePriorityQueue } from 'ds-app/core';

export interface SkewHeap<T> extends MeldablePriorityQueue<T> {
  readonly compare: Comparator<T>;
  build(values: Iterable<T>): void;
  merge(other: SkewHeap<T>): SkewHeap<T>;
}
```

`SkewHeap` (also exported as `IterativeSkewHeap`) is the default iterative
implementation; `RecursiveSkewHeap` provides the textbook recursive meld for
reference and teaching.

Shared members come from [`Container`](./00-common-contract.md#container);
`push`, `pop`, `peek`, and `merge` come from
[`MeldablePriorityQueue`](./00-common-contract.md#meldable-priority-queue).

### Semantics

- `merge` is destructive and consumes `other`; the returned heap owns both
  sets of elements, and any operation on `other` afterwards throws
  `ConsumedError`.
- `push` is `merge` with a singleton heap.
- `pop` melds the root's left and right subtrees.
- No rank or size metadata is stored at nodes; the tree shape can be highly
  unbalanced.
- Iteration order is implementation-defined.
- `validate()` checks heap order, parent links (if kept), and size. It cannot check
  balance because no balance invariant exists.

## Implementations and complexity

| Operation | Recursive meld | Iterative meld |
|-----------|----------------|----------------|
| `push` | O(log n) amortized, O(n) worst | O(log n) amortized, O(n) worst |
| `pop` | O(log n) amortized, O(n) worst | O(log n) amortized, O(n) worst |
| `peek` | O(1) | O(1) |
| `merge` | O(log n) amortized, O(n) worst | O(log n) amortized, O(n) worst |
| `build` from n items | O(n) | O(n) |
| Space | O(n) | O(n) |

Definitions: `n` = number of elements. The amortized bound is over a sequence of
operations on the heap, not per operation independently. `build` merges
singleton heaps pairwise through a queue; because the potential starts at zero,
the total cost is O(n), whereas repeated `push` is O(n log n).

### Notes

- The iterative meld is the default (`SkewHeap`, aliased as `IterativeSkewHeap`):
  it walks the right spines of both heaps, links the smaller root, and swaps
  children on the way back. It avoids stack overflow on degenerate shapes.
- `RecursiveSkewHeap` implements the textbook recursive meld and is provided for
  reference and teaching.
- A max-heap is obtained by reversing the comparator.
- Skew heaps are not stable; equal priorities are ordered arbitrarily.

## Example

```js
import { SkewHeap } from 'ds-app/skew-heaps';

const h = new SkewHeap((a, b) => a - b);
[4, 1, 3, 1, 5].forEach((v) => h.push(v));

h.peek();  // 1
h.pop();   // 1
h.pop();   // 1
h.validate(); // true
```

## Conformance checklist

- Amortized behavior is measured over long random push/pop/meld sequences.
- Iterative and recursive melds produce the same multiset and drain order.
- `merge` consumes the argument and invalidates it.
- Heap order and size survive randomized operations.
- Degenerate monotone insertion does not overflow the stack.
