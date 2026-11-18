# finger-search-trees — level-linked trees and treaps with fingers

Ordered dictionaries that remember a position. This module ships
`LevelLinkedTree` (a level-linked (2,4)-tree with leaves linked at every level)
and `FingerTreap` (a treap with parent pointers, cached subtree extremes, and the
same finger operations).

## Contract

Both classes implement `FingerSearchMap<K, V>`, which extends
`OrderedMap<K, V>` from
[`docs/api/10-finger-search-trees.md`](../../docs/api/10-finger-search-trees.md):

- `set/get/has/delete`, `min/max`, `predecessor/successor`, `at/indexOf`, and
  ascending `range/keys/values/entries` iteration.
- `fingerAt(key)` returns an opaque `Finger<K>` for an existing key, or
  `undefined` when the key is absent.
- `findFrom(finger, key)` searches from the finger and does not move it.
- `insertAfter(finger, key, value)` requires `key` to lie strictly between the
  finger's key and its successor; it moves the finger to the new entry and
  returns it, throwing `RangeError` otherwise.
- `deleteAt(finger)` removes the finger's entry and invalidates that finger.
- `successorFrom(finger)` and `predecessorFrom(finger)` are neighbour queries
  that exclude the finger's own entry.
- `distance(a, b)` is the absolute rank distance between two fingers.
- `join(other)` requires every key in the receiver to compare smaller than every
  key in `other`; it consumes both inputs. `splitAt(finger)` consumes the
  receiver and returns the entries `< finger.key` and `>= finger.key`.
- A finger from another map throws `TypeError`. A finger into a consumed map
  throws `ConsumedError`; a finger invalidated by `deleteAt`, `delete`, or
  `clear` throws `ConcurrentModificationError`.
- `validate()` checks ordering, structure, links, cached counts, and every live
  finger target. Fingers are not serialized.
- `serialize()` / `deserialize(json, compare?)` use the stable
  `{ type: "LevelLinkedTree" | "FingerTreap", version: 1, entries }` shape.

## Complexity

`n` elements, `d` finger distance, `k` reported entries.

| Operation | LevelLinkedTree | FingerTreap |
|-----------|-----------------|-------------|
| `set` / `get` / `delete` | O(log n) | O(log n) expected |
| `findFrom` | O(log d) | O(log d) expected |
| `insertAfter` | O(log n) (subtree counts refreshed to the root) | O(log n) expected |
| `deleteAt` | O(log n) (subtree counts refreshed to the root) | O(log n) expected |
| `successorFrom` / `predecessorFrom` | O(1) | O(1) expected |
| `distance` | O(log n) | O(log n) expected |
| `at` / `indexOf` | O(log n) | O(log n) expected |
| `range` | O(log n + k) | O(log n + k) expected |
| `join` / `splitAt` | O(log n) | O(log n) expected |
| Space | O(n) | O(n) expected |

The level-linked tree stores every level as a doubly linked list, so finger
search climbs only until the target enters an ancestor's interval and then
descends; it never restarts at the root. The treap uses cached subtree extremes
for the same climb and expected ranks for the same bound.

## Invariants

1. In-order traversal is strictly increasing under `compare`.
2. `LevelLinkedTree` is a (2,4)-tree: leaves hold 1-3 entries, internal nodes
   hold 2-4 children, all leaves are at the same depth, each level is a doubly
   linked list in key order, and every separator equals its child's maximum key.
3. `FingerTreap` is ordered by key and heap-ordered by priority; every node's
   cached size and subtree extremes match its children.
4. Every node's parent link points back to its parent; a root has no parent.
5. Every active finger is owned by the map, points at a live entry, and matches
   its registered node or leaf slot.
6. A tree consumed by `join` or `splitAt` throws `ConsumedError` on every later
   operation, including through its fingers.

## Example

```js
import { LevelLinkedTree, FingerTreap } from 'ds-app/finger-search-trees';

const map = new LevelLinkedTree((a, b) => a - b);
for (let i = 0; i < 1000; i++) map.set(i, i);

const finger = map.fingerAt(500);
map.findFrom(finger, 503);          // [503, 503]
const moved = map.insertAfter(finger, 500.5, 'x');
moved.key;                          // 500.5
map.successorFrom(moved);           // [501, 501]
map.validate();                     // true

const treap = new FingerTreap((a, b) => a - b, { rng: 42 });
treap.set(1, 'a').set(2, 'b').set(3, 'c');
treap.findFrom(treap.fingerAt(1), 3); // [3, 'c']
treap.validate();                     // true
```
