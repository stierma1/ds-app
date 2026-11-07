# Part 12 — Randomized Dictionary Structures

**Module:** `ds-app/randomized` · **Source:** `src/randomized/` · **Status:** planned

## Scope

Dictionaries whose balance comes from randomization rather than stored balance
metadata: treaps, randomized binary search trees, skip lists, and randomized
meldable heaps. All bounds are expected over the random choices, and every
structure accepts a seeded PRNG for reproducibility.

## Common API

```ts
import type { Comparator, MeldablePriorityQueue, OrderedMap } from 'ds-app/core';

export interface RandomSource {
  next(): number;
}

export interface RandomizedMap<K, V = K> extends OrderedMap<K, V> {
  readonly compare: Comparator<K>;
  readonly rng: RandomSource;
}

export interface RandomizedMeldableHeap<T> extends MeldablePriorityQueue<T> {
  readonly compare: Comparator<T>;
  readonly rng: RandomSource;
}

export interface RandomOptions {
  rng?: RandomSource | number;
}
```

Shared ordered-map members come from
[`OrderedMap`](./00-common-contract.md#ordered-map--ordered-set); shared heap
members come from
[`MeldablePriorityQueue`](./00-common-contract.md#meldable-priority-queue).

### Semantics

- `rng` accepts a `RandomSource`, a numeric seed, or is omitted (a seed is
  generated from the platform CSPRNG and recorded for debugging).
- The same seed and operation sequence produce the same structure and the same
  iteration order.
- Treap priorities and skip-list levels are internal; they are not exposed as
  keys and are not serialized.
- `merge` on a randomized meldable heap is destructive and consumes its argument.
- `validate()` checks BST/skip-list order, heap order, level structure, and
  size. It does not require balance.

## Implementations and complexity

| Operation | Treap | Randomized BST | Skip list | Randomized meldable heap |
|-----------|-------|----------------|-----------|--------------------------|
| `get` / `find` | O(log n) expected, O(n) worst | O(log n) expected, O(n) worst | O(log n) expected, O(n) worst | — |
| `set` / `insert` | O(log n) expected | O(log n) expected | O(log n) expected | O(log n) expected |
| `delete` | O(log n) expected | O(log n) expected | O(log n) expected | — |
| `min` / `max` | O(log n) expected | O(log n) expected | O(1) expected at ends | — |
| `predecessor` / `successor` | O(log n) expected | O(log n) expected | O(log n) expected | — |
| `range` | O(log n + k) expected | O(log n + k) expected | O(log n + k) expected | — |
| `push` / `pop` / `peek` | — | — | — | O(log n) expected / O(log n) expected / O(1) |
| `merge` | — | — | — | O(log n) expected |
| Iteration | O(n) | O(n) | O(n) | implementation-defined |
| Space | O(n) expected | O(n) expected | O(n) expected | O(n) |

Definitions: `n` elements, `k` reported entries. Expected bounds are over the
internal random choices, not over the input distribution. There is no amortized
guarantee.

### Notes

- **Treap:** a BST ordered by key and a heap ordered by random priority. Rotations
  restore heap order after insert/delete.
- **Randomized BST:** stores subtree sizes and performs randomized rotations
  during insertion; equivalent in distribution to a random BST.
- **Skip list:** a hierarchy of linked lists with geometrically distributed
  levels. Search starts at the top-left and drops levels. Space is expected
  `O(n)` because each node's level is geometric.
- **Randomized meldable heap:** keeps the smaller root (heap order is never
  violated), flips a fair coin to pick that root's left or right child, and
  recursively melds that child with the other heap (Gambin and Malinowski);
  expected `O(log n)`.
  It is a useful alternative to leftist and skew heaps when worst-case balance
  metadata is unwanted.
- A seeded PRNG makes failures reproducible: tests record the seed and the
  operation log.

## Example

```js
import { Treap, SkipList } from 'ds-app/randomized';

const treap = new Treap((a, b) => a - b, { rng: 42 });
[5, 2, 8].forEach((k) => treap.set(k, k * 10));
treap.get(5);        // 50
treap.validate();    // true

const skip = new SkipList((a, b) => a - b, { rng: 42 });
skip.set('b', 2).set('a', 1);
[...skip.keys()];    // ['a', 'b']
```

## Conformance checklist

- Seeded runs are reproducible across platforms for the same PRNG algorithm.
- Treap, randomized BST, and skip list pass the ordered-map conformance suite.
- Long random operation sequences stay within expected height/level bounds.
- Randomized meldable heap matches a reference binary heap on drain order.
- `validate()` detects a violated priority, a broken skip-list level, and a
  wrong size.
