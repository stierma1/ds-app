# Part 8 — Hash Tables

**Module:** `ds-app/hash-tables` · **Source:** `src/hash-tables/` · **Status:** done

## Scope

Hash-based dictionaries and sets with configurable hash functions, equality,
capacity, and load factor. The part covers separate chaining, open addressing,
coalesced hashing, Robin Hood, cuckoo hashing, universal and perfect hashing,
and extendible hashing.

## Common API

```ts
import type { Container, SetLike } from 'ds-app/core';

export interface HashOptions<K> {
  capacity?: number;
  loadFactor?: number;
  hash?: (key: K) => number;
  equals?: (a: K, b: K) => boolean;
}

export interface HashMap<K, V> extends Container<[K, V]> {
  set(key: K, value: V): this;
  get(key: K): V | undefined;
  has(key: K): boolean;
  delete(key: K): boolean;
  keys(): IterableIterator<K>;
  values(): IterableIterator<V>;
  entries(): IterableIterator<[K, V]>;
  clear(): void;
  reserve(capacity: number): void;
}

export interface HashSet<E> extends SetLike<E> {
  values(): IterableIterator<E>;
}
```

Shared members come from [`Container`](./00-common-contract.md#container).
Hash tables are unordered: iteration order is implementation-defined and may
change after a resize.

### Semantics

- `set` inserts or replaces and returns `this`.
- `get` returns `undefined` when the key is absent; `has` distinguishes an
  absent key from a stored falsy value.
- `delete` returns `true` only if an entry was removed.
- `reserve(n)` ensures capacity for at least `n` entries without rehashing.
- `equals` defaults to `Object.is`; `hash` defaults to a stable built-in hash
  for primitives and a structural hash for tuples and plain records.
- Mutable keys must not change in a way that changes their hash or equality
  while stored.
- `validate()` checks bucket chains, tombstone counts, size, and load factor.

## Implementations and complexity

`α = n / m` is the load factor (`n` entries, `m` buckets). Average bounds assume
a uniform hash function.

| Implementation | `get` | `set` | `delete` | Iteration | Space |
|----------------|-------|-------|----------|-----------|-------|
| `SeparateChaining` | O(1 + α) avg, O(n) worst | O(1 + α) avg, O(n) worst | O(1 + α) avg, O(n) worst | O(n + m) | O(n + m) |
| `LinearProbing` | O(1/(1-α)) avg success, O(1/(1-α)²) avg failure, O(n) worst | O(1/(1-α)²) avg (an unsuccessful probe), O(n) worst | O(1/(1-α)) avg, O(n) worst | O(n + m) | O(n + m) |
| `QuadraticProbing` | O(1/(1-α)) avg, O(n) worst | O(1/(1-α)) avg, O(n) worst | O(1/(1-α)) avg, O(n) worst | O(n + m) | O(n + m) |
| `DoubleHashing` | O(1/(1-α)) avg, O(n) worst | O(1/(1-α)) avg, O(n) worst | O(1/(1-α)) avg, O(n) worst | O(n + m) | O(n + m) |
| `CoalescedHashing` | O(1 + α) avg, O(n) worst | O(1 + α) avg, O(n) worst | O(1 + α) avg, O(n) worst | O(n + m) | O(n + m) |
| `RobinHood` | O(1) expected, O(n) worst | O(1) expected, O(n) worst | O(1) expected, O(n) worst | O(n + m) | O(n + m) |
| `CuckooHashing` | O(1) worst | O(1) expected amortized, O(n) worst | O(1) worst | O(n + m) | O(n) |
| `UniversalHashing` | O(1) expected, O(n) worst | O(1) expected, O(n) worst | O(1) expected, O(n) worst | O(n + m) | O(n + m) |
| `PerfectHashing` (static) | O(1) worst | — | — | O(n) | O(n) |
| `ExtendibleHashing` | O(1) expected, O(n) worst | O(1) amortized expected | O(1) expected | O(n + directory) | O(n + directory) |
| `OrderedHashMap` | O(1 + α) avg, O(n) worst | O(1 + α) avg, O(n) worst | O(1 + α) avg, O(n) worst | O(n) insertion order | O(n) |

### Notes

- `SeparateChaining` stores a bucket array of lists; the load factor may exceed
  1, and iteration walks all buckets.
- `LinearProbing` has excellent cache behavior but primary clustering; its
  average cost grows sharply as `α → 1`. Tombstones are used for deletion and
  cleared during rehash.
- `QuadraticProbing` reduces primary clustering but needs a prime or
  power-of-two table size and a load factor below 1/2 for guaranteed insertion.
- `DoubleHashing` uses a second hash to determine the probe step; it approaches
  uniform hashing behavior.
- `CoalescedHashing` links colliding entries inside the table itself, combining
  open addressing with chaining.
- `RobinHood` keeps probe-distance order and gives low variance; lookup and
  delete can stop early.
- `CuckooHashing` uses two tables and two hashes; lookups inspect exactly two
  slots. Insert may evict and rehash; cyclic eviction triggers a rebuild.
- `UniversalHashing` selects a hash function at random from a universal family,
  giving expected O(1) against any fixed key set.
- `PerfectHashing` builds a static two-level scheme with O(1) worst-case lookup
  and O(n) expected construction.
- `ExtendibleHashing` grows a directory of bucket pointers instead of rehashing
  everything; local depth controls splits.
- `HashMap` defaults to `SeparateChaining`; `HashSet` reuses the same options.
- `OrderedHashMap` preserves insertion order for iteration and serialization; updating
  an existing key does not move it, while deletion and re-insertion append it.

## Example

```js
import { HashMap } from 'ds-app/hash-tables';

const map = new HashMap({ capacity: 16, loadFactor: 0.75 });
map.set('a', 1).set('b', 2);

map.get('a');   // 1
map.has('c');   // false
map.delete('a'); // true
map.validate(); // true
```

## Conformance checklist

- Every implementation matches a reference `Map` on randomized key sets.
- Colliding-key stress tests (constant hash) exercise worst-case paths.
- Deletion followed by lookup is tested under every probing scheme, including
  tombstones and backward-shift deletion.
- Resizing preserves all entries and does not corrupt iteration.
- Cuckoo rebuilds terminate and preserve entries.
- `validate()` detects a broken chain, a dangling tombstone, and an invalid
  load factor.
