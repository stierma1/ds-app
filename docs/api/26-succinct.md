# Part 26 — Succinct Data Structures

**Module:** `ds-app/succinct` · **Source:** `src/succinct/` · **Status:** planned

## Scope

Structures stored in space close to the information-theoretic minimum that
still answer queries in constant or logarithmic time: rank/select bit vectors,
Elias-Fano sequences, wavelet trees, and succinct ordinal trees (balanced
parentheses and LOUDS). Part 23's FM-index is built from these.

## Common API

```ts
export interface BitVector {
  readonly length: number;
  readonly ones: number;
  readonly bitSize: number;
  get(i: number): 0 | 1;
  rank(i: number, bit?: 0 | 1): number;
  select(k: number, bit?: 0 | 1): number | undefined;
  validate(): true | string;
}

export interface WaveletTree {
  readonly length: number;
  readonly alphabetSize: number;
  readonly bitSize: number;
  access(i: number): number;
  rank(symbol: number, i: number): number;
  select(symbol: number, k: number): number | undefined;
  quantile(lo: number, hi: number, k: number): number;
  rangeCount(lo: number, hi: number, minSymbol: number, maxSymbol: number): number;
  validate(): true | string;
}

export interface SuccinctTree {
  readonly size: number;
  readonly root: number;
  readonly bitSize: number;
  parent(v: number): number | undefined;
  firstChild(v: number): number | undefined;
  nextSibling(v: number): number | undefined;
  degree(v: number): number;
  depth(v: number): number;
  subtreeSize(v: number): number;
  lca(a: number, b: number): number;
  validate(): true | string;
}
```

These structures are static: they are built from an input (a bit array, a
sequence of integers, or a tree in Part 2's representation) and never mutated.
They are not `Container`s because their elements are not enumerable in the
usual sense; each exposes its own counts, `bitSize`, and `validate()`.

### Semantics

- `rank(i, bit)` counts occurrences of `bit` in positions `[0, i)`;
  `select(k, bit)` returns the position of the `k`-th occurrence (0-based) or
  `undefined` past the end. The default bit is `1`.
- Wavelet-tree symbols are integers in `[0, alphabetSize)`;
  `quantile(lo, hi, k)` returns the `k`-th smallest symbol in `[lo, hi)`.
- Succinct trees number nodes in preorder (balanced parentheses) or level order
  (LOUDS), as documented by the implementation. `LoudsTree` throws
  `UnsupportedError` for `subtreeSize` and `lca`.
- `bitSize` reports the total bits used, including auxiliary directories, so
  tests can assert the `o(n)` overhead.
- `validate()` recomputes rank directories and checks parentheses balance or
  LOUDS structure.

## Implementations and complexity

| Structure | Build | `rank` | `select` | Other queries | Space (bits) |
|-----------|-------|--------|----------|---------------|--------------|
| `RankSelectBitVector` | O(n) | O(1) | O(1) with a select directory, O(log n) by binary search over rank blocks | `get` O(1) | n + o(n) |
| `EliasFanoSequence` | O(n) | O(log(n/m)) | O(1) for ones | `get` O(log(n/m)) | m log(n/m) + 2m + o(m) |
| `WaveletTree` | O(n log σ) | O(log σ) | O(log σ) | `access`, `quantile`, `rangeCount` O(log σ) | n log σ + o(n log σ) |
| `WaveletMatrix` | O(n log σ) | O(log σ) | O(log σ) | same as the wavelet tree with better constants for large σ | n log σ + o(n log σ) |
| `BalancedParenthesesTree` | O(n) | — | — | `parent`, `firstChild`, `nextSibling`, `subtreeSize`, `depth`, `lca` O(1) with a range min-max tree, O(log n) in the simple variant | 2n + o(n) |
| `LoudsTree` | O(n) | — | — | `parent`, `firstChild`, `nextSibling`, `degree` O(1) | 2n + o(n) |

Definitions: `n` = bit-vector length, sequence length, or node count; `m` =
number of one bits; `σ` = alphabet size. Bits are packed into `Uint32Array`
words; the `o(n)` term is the rank/select directory.

### Notes

- **Rank/select bit vector:** a two-level directory (superblocks and blocks)
  plus per-word popcount gives O(1) `rank`; `select` uses a sampled position
  table and a bounded scan.
- **Elias-Fano:** stores a sparse increasing sequence as high and low parts;
  `select` on ones is O(1), which makes it the preferred encoding for sorted
  integer sequences and posting lists.
- **Wavelet tree / matrix:** recursively partitions the alphabet; each level is
  a rank/select bit vector. The matrix form stores levels contiguously and
  avoids per-node overhead.
- **Balanced parentheses:** the tree's DFS as `(` and `)`; navigation reduces to
  matching parentheses and excess queries answered by a range min-max tree.
- **LOUDS:** level-order unary degree sequence; the simplest encoding with
  constant parent/child navigation through `rank` and `select`.

## Example

```js
import { RankSelectBitVector, WaveletTree } from 'ds-app/succinct';

const bits = RankSelectBitVector.fromBits([1, 0, 1, 1, 0, 0, 1]);
bits.rank(4);         // 3 ones in positions [0, 4)
bits.select(2);       // 3, position of the third one
bits.validate();      // true

const wt = WaveletTree.fromSequence([3, 1, 4, 1, 5], 6);
wt.rank(1, 4);        // 2 occurrences of symbol 1 before position 4
wt.quantile(0, 5, 2); // 3, the third smallest symbol
```

## Conformance checklist

- `rank`/`select` are differential-tested against a linear scan on random,
  all-zero, all-one, and periodic bit patterns.
- Wavelet-tree queries match brute force for random sequences and alphabets of
  size 2, 256, and 10^5.
- Succinct tree navigation matches a pointer-based tree from Part 2 on random
  shapes, including stars and paths.
- `bitSize` stays within the documented overhead on inputs of 10^7 bits.
- `validate()` detects a corrupted directory and unbalanced parentheses.
