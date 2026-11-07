# Part 27 — Integer Keys: Searching and Priority Queues in o(log n) Time

**Module:** `ds-app/integer-keys` · **Source:** `src/integer-keys/` · **Status:** planned

## Scope

Ordered dictionaries and priority queues over bounded integer keys that beat the
comparison lower bound: van Emde Boas trees, x-fast and y-fast tries, and the
fusion tree as a word-RAM reference. Keys are unsigned integers below a universe
`U = 2^w` fixed at construction.

## Common API

```ts
import type { OrderedMap, PriorityQueue } from 'ds-app/core';
import type { RandomSource } from 'ds-app/randomized';

export interface IntegerOptions {
  bits: number;            // w, from 1 to 32
  rng?: RandomSource | number;
}

export interface IntegerMap<V = number> extends OrderedMap<number, V> {
  readonly bits: number;
  readonly universe: number;
}

export interface IntegerPriorityQueue extends PriorityQueue<number> {
  readonly bits: number;
  decreaseKey(oldKey: number, newKey: number): boolean;
}
```

Shared ordered-map members come from
[`OrderedMap`](./00-common-contract.md#ordered-map--ordered-set); the
comparator is fixed to numeric order and `compare` is exposed for conformance.
`IntegerPriorityQueue` is the same structure used as an integer heap.

### Semantics

- A key must be an integer in `[0, 2^bits)`; anything else throws `RangeError`.
  `bits` is at most 32 so keys fit `Uint32Array`.
- `at`/`indexOf` throw `UnsupportedError` for every implementation in this
  part.
- x-fast and y-fast tries use hashing (Part 8) and accept a seed for
  reproducible bucket layouts.
- `validate()` checks cluster/summary consistency (vEB), level hash tables and
  descendant pointers (x-fast), bucket size bounds (y-fast), and size.

## Implementations and complexity

| Operation | `VanEmdeBoasTree` | `XFastTrie` | `YFastTrie` | `FusionTree` (static) |
|-----------|-------------------|-------------|-------------|-----------------------|
| `get` / `has` | O(log log U) | O(1) expected | O(log log U) expected | O(log_w n) |
| `set` / `delete` | O(log log U) | O(log U) expected | O(log log U) expected amortized | — |
| `min` / `max` | O(1) | O(1) | O(1) | O(log_w n) |
| `predecessor` / `successor` | O(log log U) | O(log log U) expected | O(log log U) expected | O(log_w n) |
| `range` | O(k log log U) | O(k log log U) expected | O(k log log U) expected | O(log_w n + k) |
| `build` from n sorted keys | O(n log log U) | O(n log U) expected | O(n log log U) expected | O(n) |
| Space | O(U) bits (bitwise variant), O(n log U) with hashed clusters | O(n log U) expected | O(n) expected | O(n) |

Definitions: `n` keys, `U = 2^w` universe, `w` word size in bits, `k` reported
keys. Bounds for hashed structures are expected over the hash choice.

### Notes

- **van Emde Boas tree:** recursive summary/cluster decomposition on the high
  and low halves of the key; the implementation stores leaves of 32 keys as a
  bitmask and uses a hashed cluster map to avoid `O(U)` space when `bits` is
  large.
- **x-fast trie:** a binary trie over keys with one hash table per level and
  threaded leaves; a predecessor search binary-searches over the `w` levels.
- **y-fast trie:** an x-fast trie over representatives, each owning a balanced
  tree (Part 9) of `Θ(w)` keys; splitting and merging buckets gives amortized
  updates and linear space.
- **Fusion tree:** packs `w^{1/5}` keys per node and compares them in parallel
  with word operations. With 32-bit words it is a teaching structure, not a
  practical one, and it is static.
- An integer priority queue is a vEB tree or y-fast trie with `pop` as
  delete-min; it makes Dijkstra with integer weights run in `O(E log log C)`
  for maximum weight `C`.

## Example

```js
import { VanEmdeBoasTree } from 'ds-app/integer-keys';

const veb = new VanEmdeBoasTree({ bits: 16 });
[5, 300, 42, 7].forEach((k) => veb.set(k, k));

veb.successor(8);    // [42, 42]
veb.predecessor(5);  // undefined
veb.min();           // [5, 5]
veb.validate();      // true
```

## Conformance checklist

- Every implementation passes the ordered-map conformance suite with integer
  keys, including key `0` and `2^bits - 1`.
- Out-of-range and non-integer keys throw `RangeError`.
- Random and adversarial key sets (dense, sparse, clustered) are
  differential-tested against a sorted array.
- Operation counts are measured to confirm sub-logarithmic scaling in `U`.
- `validate()` detects an inconsistent summary and a wrong bucket size.
