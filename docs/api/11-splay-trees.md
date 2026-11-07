# Part 11 — Splay Trees

**Module:** `ds-app/splay-trees` · **Source:** `src/splay-trees/` · **Status:** planned

## Scope

Self-adjusting binary search trees. Every access splays the accessed node to the
root using single rotations and zig-zig/zig-zag double rotations. All operations
are `O(log n)` amortized and can be `O(n)` for a single operation.

## Common API

```ts
import type { Comparator, OrderedMap } from 'ds-app/core';

export interface SplayTree<K, V = K> extends OrderedMap<K, V> {
  readonly compare: Comparator<K>;
  readonly root: unknown | null;
  splay(key: K): void;
  join(other: SplayTree<K, V>): SplayTree<K, V>;
  split(key: K): [SplayTree<K, V>, SplayTree<K, V>];
}
```

Shared members come from [`Container`](./00-common-contract.md#container);
`set/get/has/delete/min/max/predecessor/successor/range` come from
[`OrderedMap`](./00-common-contract.md#ordered-map--ordered-set).

### Semantics

- Every `get`, `set`, and successful `delete` splays the accessed or last
  accessed node to the root.
- `splay(key)` moves the node with that key (or the last node on the search
  path) to the root; it is exposed for teaching and benchmarking.
- `join` requires all keys in the receiver to be smaller than all keys in
  `other`; it is destructive.
- `split(key)` returns `[< key, >= key]` and consumes the original tree.
- `validate()` checks BST order, parent links, and size; balance is not an
  invariant and is not validated.
- Iteration of a splay tree is ordered, but performing a `get` during iteration
  mutates the tree and invalidates the iterator.

## Implementations and complexity

| Operation | Bottom-up splay | Top-down splay |
|-----------|-----------------|----------------|
| `get` / `find` | O(log n) amortized, O(n) worst | O(log n) amortized, O(n) worst |
| `set` / `insert` | O(log n) amortized, O(n) worst | O(log n) amortized, O(n) worst |
| `delete` | O(log n) amortized, O(n) worst | O(log n) amortized, O(n) worst |
| `splay` | O(log n) amortized, O(n) worst | O(log n) amortized, O(n) worst |
| `min` / `max` | O(log n) amortized | O(log n) amortized |
| `predecessor` / `successor` | O(log n) amortized | O(log n) amortized |
| `range` | O(log n + k) amortized | O(log n + k) amortized |
| `join` / `split` | O(log n) amortized | O(log n) amortized |
| Iteration | O(n) | O(n) |
| Space | O(n) | O(n) |

Definitions: `n` elements, `k` reported entries. The amortized bound holds over
a sequence of operations starting from an empty tree. Worst-case bounds are per
operation and are not amortized.

### Notes

- Bottom-up splaying uses parent pointers and walks back to the root; it is the
  direct implementation of the book's cases.
- Top-down splaying restructures while descending and needs no parent pointers;
  it is faster in practice and uses less memory per node.
- Splay trees have no balance metadata, so a deliberately skewed insertion
  order can produce a linear tree.
- Access locality is the point: repeatedly accessed keys migrate to the root and
  become O(1) to read.
- `join`/`split` are built from splaying the maximum/minimum and attaching
  subtrees.

## Example

```js
import { SplayTree } from 'ds-app/splay-trees';

const splay = new SplayTree((a, b) => a - b);
[5, 2, 8, 1, 9].forEach((k) => splay.set(k, `v${k}`));

splay.get(9);        // 'v9'; 9 is splayed to the root
splay.min();         // [1, 'v1']
[...splay.keys()];   // [1, 2, 5, 8, 9]
splay.validate();    // true
```

## Conformance checklist

- Every sequence matches the ordered-map reference model after each operation.
- Amortized cost is measured over random and locality-heavy access sequences.
- Top-down and bottom-up implementations agree on contents and order.
- `join`/`split` are tested against a sorted reference, including empty inputs.
- `validate()` rejects a violated BST order, a bad parent link, and a wrong size.
- Deep chains do not overflow the stack during splay or iteration.
