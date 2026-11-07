# Part 10 — Finger Search Trees

**Module:** `ds-app/finger-search-trees` · **Source:** `src/finger-search-trees/` · **Status:** planned

## Scope

Ordered dictionaries that remember a position — a *finger* — and support
searches whose cost depends on the distance from that finger rather than on the
total number of elements. The primary implementation is a level-linked (2,4)
tree. A meldable finger search variant is included.

## Common API

```ts
import type { Comparator, OrderedMap } from 'ds-app/core';

export interface Finger<K> {
  readonly key: K;
}

export interface FingerSearchMap<K, V = K> extends OrderedMap<K, V> {
  readonly compare: Comparator<K>;
  fingerAt(key: K): Finger<K> | undefined;
  findFrom(finger: Finger<K>, key: K): [K, V] | undefined;
  insertAfter(finger: Finger<K>, key: K, value: V): Finger<K>;
  deleteAt(finger: Finger<K>): boolean;
  successorFrom(finger: Finger<K>): [K, V] | undefined;
  predecessorFrom(finger: Finger<K>): [K, V] | undefined;
  distance(a: Finger<K>, b: Finger<K>): number;
  join(other: FingerSearchMap<K, V>): FingerSearchMap<K, V>;
  splitAt(finger: Finger<K>): [FingerSearchMap<K, V>, FingerSearchMap<K, V>];
}
```

Shared members come from [`Container`](./00-common-contract.md#container);
`set/get/has/delete/min/max/range` come from
[`OrderedMap`](./00-common-contract.md#ordered-map--ordered-set).

### Semantics

- A `Finger<K>` is an opaque handle to a position in a specific map. Using a
  finger from another map throws `TypeError`.
- `d` always means the number of elements between the finger and the target
  (rank distance), not key distance.
- `findFrom` does not move the finger. `insertAfter` moves the finger to the
  new entry and returns it; `key` must lie strictly between the finger's key
  and its successor, otherwise `RangeError`.
- `deleteAt` removes the finger's element and invalidates the finger; using it
  afterwards throws `ConcurrentModificationError`.
- `join(other)` requires every key in the receiver to be smaller than every
  key in `other`, as in Parts 9 and 11. `join` and `splitAt` are destructive and
  consume their inputs; any finger from a consumed map is invalid and using it
  throws `ConsumedError`.
- `validate()` checks level links, node degree bounds, BST order, and finger
  targets.

## Implementations and complexity

| Operation | Level-linked (2,4) tree | Treap with fingers | Brodal finger tree |
|-----------|-------------------------|--------------------|--------------------|
| `findFrom(finger, key)` | O(log d) | O(log d) expected | O(log d) |
| `insertAfter(finger, key, value)` | O(1) amortized, O(log n) worst | O(log n) expected | O(1) |
| `deleteAt(finger)` | O(1) amortized, O(log n) worst | O(log n) expected | O(1) |
| `successorFrom` / `predecessorFrom` | O(1) | O(1) | O(1) |
| `distance` | O(log n) | O(log n) expected | O(log n) |
| `set` / `get` / `delete` | O(log n) | O(log n) expected | O(log n) |
| `join` / `splitAt` | O(log n) | O(log n) expected | O(log n) |
| `range` | O(log n + k) | O(log n + k) expected | O(log n + k) |
| Space | O(n) | O(n) expected | O(n) |

Definitions: `n` elements, `d` finger distance, `k` reported entries. `O(log d)`
is the defining search bound: when `d` is small, the search is much cheaper than
a full search. The level-linked (2,4) tree gives `O(log d)` search and `O(1)`
amortized updates at a finger (Huddleston and Mehlhorn), with an `O(log n)`
worst case when node splits or fusions cascade. The structure of Brodal,
Lagogiannis, Makris, Tsakalidis, and Tsichlas gives `O(1)` worst-case updates;
it is planned as an opt-in implementation.

### Notes

- The level-linked (2,4) tree stores each level as a doubly linked list of
  nodes, so a finger can climb and descend levels without traversing the whole
  tree.
- A treap with parent pointers and a stored finger node is a simpler
  expected-bound implementation; it is useful as a reference and for workloads
  where determinism is supplied by a seed.
- `distance` is computed from ranks; it requires subtree-size augmentation.
- Fingers are not serialized; `fromJSON()` returns a map with no active fingers.

## Example

```js
import { LevelLinkedTree } from 'ds-app/finger-search-trees';

const map = new LevelLinkedTree((a, b) => a - b);
for (let i = 0; i < 1000; i++) map.set(i, i);

const finger = map.fingerAt(500);
map.findFrom(finger, 503); // [503, 503]
map.insertAfter(finger, 500.5, 'x');
map.successorFrom(finger); // [501, 501]
map.validate();            // true
```

## Conformance checklist

- `findFrom` agrees with `get` for all keys and finger positions.
- Cost scales with `d`: benchmarked against a full search for small and large
  distances.
- Finger invalidation is tested after `deleteAt`, `splitAt`, and `join`.
- Level links and degree bounds are validated after randomized operations.
- Treap and level-linked implementations agree on ordered-map behavior.
