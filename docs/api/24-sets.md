# Part 24 — Sets

**Module:** `ds-app/sets` · **Source:** `src/sets/` · **Status:** planned

## Scope

Set implementations and disjoint-set structures: hash sets, sorted-array sets,
bit vectors, interval sets, union-find, and approximate membership filters
(Bloom, counting Bloom, partitioned Bloom, scalable Bloom, and cuckoo
filters). All set-algebra operations are non-mutating and return a new set.

## Common API

```ts
import type { Container, SetLike } from 'ds-app/core';

export interface DisjointSet<E> {
  readonly setCount: number;
  makeSet(value: E): void;
  find(value: E): E;
  union(a: E, b: E): boolean;
  connected(a: E, b: E): boolean;
  sizeOf(value: E): number;
}

export interface BloomFilterOptions {
  bits?: number;
  hashes?: number;
  seed?: number;
}

export interface BloomFilter {
  readonly size: number;
  readonly bits: number;
  readonly hashes: number;
  readonly falsePositiveRate: number;
  add(value: string): void;
  has(value: string): boolean;
  clear(): void;
  validate(): true | string;
}

export interface CountingBloomFilter extends BloomFilter {
  delete(value: string): boolean;
}

export interface ScalableBloomFilter extends BloomFilter {
  readonly filterCount: number;
  readonly growthFactor: number;
  readonly tighteningRatio: number;
}

export interface CuckooFilter {
  readonly size: number;
  readonly buckets: number;
  readonly fingerprintBits: number;
  readonly loadFactor: number;
  add(value: string): boolean;
  has(value: string): boolean;
  delete(value: string): boolean;
  clear(): void;
  validate(): true | string;
}
```

Shared set members (`add/delete/has/union/intersection/difference/...`) come
from [`SetLike`](./00-common-contract.md#set); shared container members come from
[`Container`](./00-common-contract.md#container). Bloom filters are the one
exception: they cannot enumerate their elements, so they expose `size`, `clear`,
and `validate()` directly instead of implementing `Container`.

### Semantics

- `SetLike` methods are defined in the common contract; `add`/`delete` return
  whether membership changed.
- Set algebra returns a new set; operands are unchanged.
- `BitSet` uses an integer universe `[0, U)`; out-of-range values throw
  `RangeError`.
- `IntervalSet` stores disjoint closed intervals and merges adjacent or
  overlapping ranges on insertion.
- `DisjointSet` is a separate interface: `union` returns `true` only when two
  different sets were merged; `find` returns the representative.
- Bloom filters may report false positives but never false negatives; `size` is
  the number of inserted elements, `bits` is the bit-array length.
- `CountingBloomFilter.delete` decrements counters and returns `true` if any
  counter changed. It cannot distinguish a never-inserted value from a false
  positive, so deleting an arbitrary absent value can create false negatives.
- `ScalableBloomFilter` adds a new, larger filter with a tighter target rate
  when the current one reaches its capacity, so `falsePositiveRate` stays
  below the configured bound as `size` grows.
- `CuckooFilter.add` returns `false` when the eviction limit is reached (the
  filter is full); `delete` must be called only for values that were added,
  as with the counting filter.
- `validate()` checks bucket/bit/interval/forest invariants.

## Implementations and complexity

| Implementation | `add` / `delete` | `has` | Set algebra | Iterate | Space |
|----------------|------------------|-------|-------------|---------|-------|
| `HashSet` | O(1) avg, O(n) worst | O(1) avg, O(n) worst | O(n + m) avg | O(n) | O(n) |
| `SortedArraySet` | O(n) | O(log n) | O(n + m) | O(n) | O(n) |
| `BitSet` | O(1) | O(1) | O(U / w) | O(U / w), O(popcount) with rank | O(U / w) |
| `IntervalSet` | O(r log n) worst add, O(log n) delete | O(log n) | O((n + m) log(n + m)) | O(n) | O(n) |
| `UnionFind` | O(α(n)) amortized `makeSet` / `union` | O(α(n)) amortized `find` / `connected` | — | O(n) | O(n) |
| `BloomFilter` | O(k) add, no delete | O(k) | — | — | O(b) bits |
| `CountingBloomFilter` | O(k) add/delete | O(k) | — | — | O(b) counters |
| `PartitionedBloomFilter` | O(k) add, no delete | O(k) | — | — | O(b) bits |
| `ScalableBloomFilter` | O(k) add amortized, no delete | O(k · filters) | — | — | O(b) bits, growing geometrically |
| `CuckooFilter` | O(1) expected amortized add, O(1) delete | O(1), two buckets | — | — | O(n · fingerprintBits / loadFactor) bits |

Definitions: `n` and `m` set sizes, `r` the number of existing intervals merged
by one insertion, `U` universe size, `w` machine word size (bits), `k` hash
functions, `b` bit-array or counter-array length, `α` the inverse Ackermann
function. `UnionFind`
operations are amortized with union by rank and path compression.

### Notes

- **HashSet:** wraps the Part 8 hash table; iteration is unordered.
- **SortedArraySet:** binary search for membership; insertion/deletion shift
  elements. Set algebra is a linear merge.
- **BitSet:** one bit per universe element; set algebra is word-parallel. Good
  for dense sets and fixed universes.
- **IntervalSet:** a balanced interval index (Part 17); insertion merges
  overlapping/adjacent intervals in `O(r log n)` worst case and `O(log n)`
  amortized over a sequence, where `r` is the number of merged intervals.
  Deletion may split one interval into two.
- **Union-find:** `makeSet` creates a singleton; `find` follows parent pointers
  with path compression; `union` uses union by rank/size.
- **Bloom filter:** `k` independent hash functions set `k` bits. The false
  positive rate is approximately `(1 - e^{-kn/b})^k`; there are no false
  negatives and deletion is not supported.
- **Counting Bloom filter:** each position is a counter, enabling deletion at the
  cost of more space.
- **Partitioned Bloom filter:** each hash function owns its own slice of the
  bit array; the false-positive rate is slightly higher for the same `b`, but
  the slices are independent and cache-friendly.
- **Scalable Bloom filter:** a sequence of Bloom filters with geometrically
  growing size and geometrically tightening error rates (Almeida et al.);
  `has` consults every filter.
- **Cuckoo filter:** stores short fingerprints in a two-choice cuckoo table
  (Fan et al.); supports deletion, beats Bloom filters in space below about a
  3% target rate, and fills to a load factor near 95% with buckets of four.

## Example

```js
import { HashSet, UnionFind } from 'ds-app/sets';

const set = new HashSet();
set.add('a');
set.add('b');
set.union(new Set(['c'])); // new set
set.has('a');              // true
set.validate();            // true

const uf = new UnionFind();
['a', 'b', 'c'].forEach((v) => uf.makeSet(v));
uf.union('a', 'b');        // true
uf.connected('a', 'b');    // true
uf.sizeOf('b');            // 2
```

## Conformance checklist

- Every set matches a reference `Set` on randomized add/delete/has sequences.
- Set-algebra results are compared with a brute-force implementation.
- `BitSet` boundary values `0` and `U - 1` are tested; `U` and `-1` throw.
- `IntervalSet` merges and splits correctly, including touching endpoints.
- Union-find matches a naive connected-component model; path compression and
  union by rank are verified structurally.
- Bloom filters never produce false negatives for values that were inserted.
  Counting and cuckoo filters are tested with deletions only of inserted
  values.
- Measured false-positive rates for every filter stay within a tolerance of
  the configured or formula-predicted rate, including a scalable filter grown
  through several stages.
- `validate()` detects a broken bucket chain, a corrupt interval, and a
  non-root parent cycle.
