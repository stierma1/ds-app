# Part 23 — Suffix Trees and Suffix Arrays

**Module:** `ds-app/suffix` · **Source:** `src/suffix/` · **Status:** planned

## Scope

Indexes over a fixed text for substring search and string analysis: suffix
trees, suffix arrays, LCP arrays, and the FM-index. All implementations expose
`SuffixIndex`, which extends the shared `StringIndex` contract.

## Common API

```ts
import type { StringIndex } from 'ds-app/core';

export interface SuffixIndex extends StringIndex {
  longestCommonSubstring(other: StringIndex): {
    startA: number;
    startB: number;
    length: number;
  };
  lcp(i: number, j: number): number;
  bwt(): { last: string; primaryIndex: number };
}

export interface SuffixOptions {
  terminator?: string;
  alphabet?: 'binary' | 'ascii' | 'unicode';
}
```

### Semantics

- `textLength`, `contains`, `count`, `search`, `longestRepeatedSubstring`,
  `suffixArray`, and `lcpArray` come from
  [`StringIndex`](./00-common-contract.md#string-index); an empty pattern
  throws `RangeError`.
- The indexed text is immutable after construction; the index does not store
  the text as elements, so `size` is `textLength` and iteration yields suffix
  start positions in suffix-array order.
- `search(pattern)` returns start positions in ascending order.
- `count(pattern)` returns the number of occurrences without materializing them.
- `longestRepeatedSubstring` returns the leftmost longest repeat on ties.
- `longestCommonSubstring` finds the longest string occurring in both texts,
  not necessarily a suffix of either.
- `lcp(i, j)` returns the longest common prefix length of the suffixes starting
  at `i` and `j`.
- `bwt()` returns the Burrows-Wheeler last column and the primary index.
- `validate()` checks suffix order, LCP consistency, and (for suffix trees)
  edge-label and terminal invariants.

## Implementations and complexity

| Implementation | Build | `search` | `count` (no report) | Longest repeat | Space |
|----------------|-------|----------|---------------------|----------------|-------|
| `SuffixTree` (Ukkonen) | O(n) constant alphabet, O(n log σ) general | O(m + k) | O(m) with leaf counts | O(n) | O(n) |
| `SuffixArray` (prefix doubling) | O(n log n) | O(m log n + k) | O(m log n) | O(n log n) | O(n) |
| `SuffixArray` (SA-IS) | O(n) | O(m log n + k), O(m + log n + k) with LCP | O(m + log n) with LCP | O(n) | O(n) |
| `LCPArray` (Kasai) | O(n) | — | — | O(n) with RMQ | O(n) |
| `FMIndex` | O(n) expected, O(n log σ) worst | O(m + k) | O(m) | O(n log n) | O(n) compressed |

Definitions: `n` = text length, `m` = pattern length, `k` = number of
occurrences, `σ` = alphabet size. `lcp(i, j)` is O(1) after an `O(n)` RMQ
preprocessing.

### Notes

- **Suffix tree (Ukkonen):** builds in linear time with implicit suffix links.
  Search follows edge labels in `O(m)` and then reports all leaves in the
  subtree. Space has a large constant; the implementation stores edge ranges,
  not copied substrings.
- **Suffix array (prefix doubling):** sorts suffixes by doubling the compared
  prefix length; `O(n log n)` time and `O(n)` space.
- **SA-IS:** induces the suffix array in linear time using LMS substrings; the
  implementation falls back to prefix doubling for very small alphabets if
  configured.
- **LCP array (Kasai):** computes LCPs between adjacent suffixes in `O(n)`.
  Combined with Part 17's `RangeMinimumQuery`, `lcp(i, j)` is `O(1)`.
- **FM-index:** stores the BWT in a Part 26 wavelet tree over rank/select bit
  vectors, plus sampled suffix-array values; pattern counting is `O(m)` and
  reporting is `O(m + k)`. Because Part 26 ships in Phase 7, the FM-index is
  the one Part 23 structure delivered with that phase.
- `search` on a suffix array uses binary search over suffix order; with the LCP
  array the lower/upper bounds are found in `O(m + log n)`.

## Example

```js
import { SuffixArray } from 'ds-app/suffix';

const index = new SuffixArray('mississippi');
index.search('issi');   // [1, 4]
index.count('issi');    // 2
index.contains('miss'); // true
index.longestRepeatedSubstring(); // { start: 1, length: 4 } -> 'issi'
index.suffixArray();    // Int32Array of suffix starts
index.validate();       // true
```

## Conformance checklist

- `search`/`count` are differential-tested against a brute-force scanner for
  random and adversarial texts (single character, periodic, Unicode).
- Suffix-tree and suffix-array results agree on all patterns.
- LCP values match direct character comparison for adjacent and arbitrary
  suffixes.
- `longestRepeatedSubstring` and `longestCommonSubstring` match brute force on
  small inputs.
- BWT inversion recovers the original text.
- `validate()` detects a misordered suffix, an inconsistent LCP, and a broken
  suffix-tree edge.
