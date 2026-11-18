# randomized — treaps, randomized BSTs, skip lists, and randomized meldable heaps

Dictionaries whose balance comes from random choices rather than stored balance
metadata. This module ships `Treap`, `RandomizedBST`, `SkipList`, and
`RandomizedMeldableHeap`.

## Contract

`Treap<K, V>`, `RandomizedBST<K, V>`, and `SkipList<K, V>` implement
`RandomizedMap<K, V>`, which extends `OrderedMap<K, V>` from
[`docs/api/12-randomized-dictionaries.md`](../../docs/api/12-randomized-dictionaries.md):

- `set/get/has/delete`, `min/max`, `predecessor/successor`, `at/indexOf`, and
  ascending `range/keys/values/entries` iteration.
- `height` reports the current structural height. It is an inspection aid, not
  a balance guarantee.
- `rng` exposes the configured random source; `compare` exposes the ordering.

`RandomizedMeldableHeap<T>` implements `MeldablePriorityQueue<T>` with `push`,
`pop`, `peek`, and destructive `merge`. It also exposes `build`, `height`, and
`rng`; `merge` consumes its argument and later operations on it throw
`ConsumedError`.

All constructors take an optional comparator and an optional options object:

```ts
new Treap((a, b) => a - b, { rng: 42 });
new SkipList<string, number>(undefined, { rng: 42 });
```

`rng` accepts a `RandomSource` with `next()`, an integer seed, or is omitted. An
omitted value is seeded from the platform CSPRNG (through `SeededRandom`) and
the chosen seed is recorded, so a failing run can be replayed. The same seed and
operation sequence produce the same structure, iteration order, and height.

## Complexity

`n` elements, `k` reported entries, `h` height. Every bound below is expected
over the internal random choices, not over the input distribution; the worst
case is given where it differs.

| Operation | Treap | Randomized BST | Skip list | Randomized meldable heap |
|-----------|-------|----------------|-----------|--------------------------|
| `get` / `has` | O(log n) | O(log n) | O(log n) | — |
| `set` | O(log n) | O(log n) | O(log n) | — |
| `delete` | O(log n) | O(log n) | O(log n) | — |
| `min` / `max` | O(log n) | O(log n) | O(1) | — |
| `predecessor` / `successor` | O(log n) | O(log n) | O(log n) | — |
| `at` / `indexOf` | O(h) | O(h) | O(log n) | — |
| `range` | O(log n + k) | O(log n + k) | O(log n + k) | — |
| `push` / `pop` | — | — | — | O(log n) / O(log n) |
| `peek` | — | — | — | O(1) |
| `merge` | — | — | — | O(log n) |
| Iteration / `toArray` | O(n) | O(n) | O(n) | O(n) |
| `height` | O(n) | O(n) | O(1) | O(n) |
| Space | O(n) | O(n) | O(n) | O(n) |

The treap and randomized BST store a subtree size per node, so `at`/`indexOf`
cost O(h) and the expected height is O(log n). A skip-list node stores `span`
lengths on its forward pointers, which keeps rank/select logarithmic without
scanning. The worst case for all three ordered maps is O(n) per operation.

## Invariants

1. In-order and bottom-level traversal are strictly increasing under `compare`.
2. Every tree node's cached size is `1 + size(left) + size(right)`.
3. Treap priorities are a min-heap: no child has a smaller priority than its
   parent. Priorities are finite and are never serialized.
4. Randomized-BST insertion puts a new key at the root of a subtree with
   probability `1 / (n + 1)`; deletion joins the remaining subtrees in
   proportion to their sizes. No balance condition is checked.
5. Every skip-list level is ordered, every node on level `i` also appears on all
   lower levels, and each `span[i]` equals the number of bottom-level nodes
   crossed by that forward link. Null forward pointers have span `0`.
6. A randomized meldable heap is heap-ordered; each node's cached size matches
   its subtree; meld keeps the smaller root and chooses the left or right child
   with a fair coin.
7. `serialize()` writes only the sorted entries or heap values. Priorities,
   levels, spans, and RNG state are rebuilt on deserialization.

`validate()` checks the ordering, heap order, size caches, skip-list levels and
spans, and the stored element count. It returns the first failure as a string
and never mutates the structure. Balance is not an invariant.

## Example

```js
import {
  RandomizedMeldableHeap,
  SkipList,
  Treap,
} from 'ds-app/randomized';

const treap = new Treap((a, b) => a - b, { rng: 42 });
[5, 2, 8].forEach((key) => treap.set(key, key * 10));
treap.get(5);        // 50
[...treap.keys()];   // [2, 5, 8]
treap.validate();    // true

const skip = new SkipList((a, b) => a.localeCompare(b), { rng: 42 });
skip.set('b', 2).set('a', 1);
[...skip.keys()];    // ['a', 'b']
skip.at(1);          // ['b', 2]

const heap = new RandomizedMeldableHeap((a, b) => a - b, { rng: 42 });
heap.push(3);
heap.push(1);
heap.push(2);
heap.peek();         // 1
heap.pop();          // 1
heap.validate();     // true
```

## Reproducibility

`src/core/random.ts` provides a platform-independent xoshiro128** generator.
`new SeededRandom(seed)` expands the seed with splitmix32 and returns doubles in
`[0, 1)`. Because only 32-bit integer operations are used, the same seed
produces the same stream in browsers, Node, Deno, and Bun. Tests pin a known
seed sequence and record the seed of every randomized differential run.

## Testing and benchmarks

- `tests/unit/randomized.test.ts` covers the ordered-map conformance suite for
  all three maps, randomized differential checks, height and level bounds,
  reproducibility, corruption of priorities/spans/sizes, heap drain order,
  meld ownership, serialization, and iterator invalidation.
- `npm run benchmark:phase4-randomized` compares the randomized maps against an
  unbalanced BST for random and sorted input, and the randomized meldable heap
  against `PairingHeap` and `BinaryHeap` on push/drain workloads.
