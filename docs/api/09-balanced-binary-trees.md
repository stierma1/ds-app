# Part 9 — Balanced Binary Trees

**Module:** `ds-app/balanced-trees` · **Source:** `src/balanced-trees/` · **Status:** planned

## Scope

Ordered dictionaries with a worst-case logarithmic height guarantee: AVL trees,
red-black trees, and weight-balanced trees. Splay trees (amortized), randomized
trees (expected), and B-trees (high branching) are separate parts but share the
same ordered-map contract.

## Common API

```ts
import type { Comparator, OrderedMap } from 'ds-app/core';

export interface BalancedTree<K, V = K> extends OrderedMap<K, V> {
  readonly compare: Comparator<K>;
  readonly height: number;
  join(other: BalancedTree<K, V>): BalancedTree<K, V>;
  split(key: K): [BalancedTree<K, V>, BalancedTree<K, V>];
}
```

Shared members come from [`Container`](./00-common-contract.md#container);
`set/get/has/delete/min/max/predecessor/successor/range` come from
[`OrderedMap`](./00-common-contract.md#ordered-map--ordered-set).

### Semantics

- All operations preserve the tree's balance invariant and `O(log n)` height.
- `set` replaces the value for a comparator-equal key.
- `at(index)`/`indexOf(key)` require subtree-size augmentation; they throw
  `UnsupportedError` when the selected implementation does not maintain sizes.
- `join(other)` requires every key in the receiver to be smaller than every key
  in `other`; it is destructive and consumes both inputs.
- `split(key)` returns `[< key, >= key]`; the original tree is consumed.
- `validate()` checks BST order, parent links, balance condition, and cached
  sizes/heights.

## Implementations and complexity

| Operation | AVL | Red-black | Weight-balanced (BB[α]) |
|-----------|-----|-----------|-------------------------|
| `get` / `has` | O(log n) | O(log n) | O(log n) |
| `set` | O(log n) | O(log n) | O(log n) |
| `delete` | O(log n) | O(log n) | O(log n) |
| `min` / `max` | O(log n), O(1) with cached pointers | O(log n), O(1) with cached pointers | O(log n), O(1) with cached pointers |
| `predecessor` / `successor` | O(log n) | O(log n) | O(log n) |
| `range` | O(log n + k) | O(log n + k) | O(log n + k) |
| `at` / `indexOf` | O(log n) with sizes | O(log n) with sizes | O(log n) with sizes |
| `join` / `split` | O(log n) | O(log n) | O(log n) |
| Iteration | O(n) | O(n) | O(n) |
| `height` | O(1) | O(1) | O(1) |
| Space | O(n) | O(n) | O(n) |

Definitions: `n` elements, `k` reported entries, `α` weight-balance parameter.
All bounds are worst case. Weight-balanced rebalancing with rotations does O(1)
work at each ancestor on the update path, so an update is O(log n) worst case
and performs O(1) rotations amortized (Blum and Mehlhorn). Only the
partial-rebuilding variant of BB[α] has amortized bounds, and it is not used
here.

### Notes

- **AVL:** stores a balance factor per node; height is at most
  `1.44 log₂(n + 2)`. Insert needs at most one single or double rotation;
  delete may cascade and use O(log n) rotations.
- **Red-black:** colors nodes red/black; height is at most `2 log₂(n + 1)`.
  Insert needs at most two rotations, delete at most three.
- **Weight-balanced (BB[α]):** keeps each subtree's size within an `α` fraction
  of its parent; `α` controls the height/rotation tradeoff. The implementation
  defaults to a value that guarantees O(log n) height.
- Order-statistic augmentation (`size` per node) is optional; when disabled,
  `at`/`indexOf` throw.
- Iterators are invalidated by mutation, as defined in the common contract.

## Example

```js
import { RedBlackTree } from 'ds-app/balanced-trees';

const map = new RedBlackTree((a, b) => a.localeCompare(b));
map.set('delta', 4).set('alpha', 1).set('charlie', 3);

[...map.keys()];       // ['alpha', 'charlie', 'delta']
map.min();             // ['alpha', 1]
map.range('b', 'e');   // ['charlie', 3], ['delta', 4]
map.validate();        // true
```

## Conformance checklist

- Each implementation passes the ordered-map conformance suite.
- Height stays within the theoretical bound after random and adversarial
  insert/delete sequences.
- `validate()` rejects a wrong balance factor, a red-red edge, and a violated
  weight balance.
- `join`/`split` are tested against a reference sorted array, including empty
  and single-element inputs.
- Draining via `min`/`delete` yields sorted order for all implementations.
