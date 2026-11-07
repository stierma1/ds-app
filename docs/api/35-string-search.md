# Part 35 — String Searching

**Module:** `ds-app/string-search` · **Source:** `src/string-search/` · **Status:** planned

## Scope

Single-pattern exact matching with preprocessed patterns: Knuth-Morris-Pratt,
Boyer-Moore and its Horspool and Sunday variants, Rabin-Karp, the Z algorithm,
bit-parallel Shift-Or, and the Two-Way algorithm. Multi-pattern matching is
Aho-Corasick in Part 22; indexed search over a fixed text is Part 23.

## Common API

```ts
export interface PatternMatcher {
  readonly pattern: string;
  first(text: string, from?: number): number;
  search(text: string, from?: number): number[];
  count(text: string, from?: number): number;
  matches(text: string, from?: number): IterableIterator<number>;
  validate(): true | string;
}

export interface MatcherOptions {
  alphabet?: 'binary' | 'ascii' | 'unicode';
  caseSensitive?: boolean;
  overlapping?: boolean;   // default true
}

export function indexOf(text: string, pattern: string, from?: number): number;
export function zArray(s: string): Int32Array;
export function failureFunction(pattern: string): Int32Array;
```

A matcher is not a `Container`; it is a preprocessed pattern whose `validate()`
checks its tables. Positions are code-unit offsets unless
`alphabet: 'unicode'` selects code points.

### Semantics

- `first` returns `-1` when there is no match at or after `from`.
- `search` returns ascending start positions; with `overlapping: false` matches
  are the leftmost non-overlapping set.
- An empty pattern throws `RangeError`.
- `matches` is lazy and stops early when the consumer stops.
- `validate()` recomputes the failure, shift, or Z tables and compares them.

## Implementations and complexity

| Matcher | Preprocessing | Search (worst) | Search (average) | Extra space |
|---------|---------------|----------------|------------------|-------------|
| `KnuthMorrisPratt` | O(m) | O(n) | O(n) | O(m) |
| `BoyerMoore` (bad character + good suffix) | O(m + σ) | O(n + m) with Galil's rule, O(n·m) without | O(n/m) best, sublinear typical | O(m + σ) |
| `BoyerMooreHorspool` | O(m + σ) | O(n·m) | O(n/m) to O(n) | O(σ) |
| `Sunday` (quick search) | O(m + σ) | O(n·m) | sublinear typical | O(σ) |
| `RabinKarp` | O(m) | O(n·m) | O(n + m) expected | O(1) |
| `ZMatcher` | O(m) | O(n + m) | O(n + m) | O(n + m) |
| `ShiftOr` | O(m + σ) | O(n·⌈m/w⌉) | O(n·⌈m/w⌉) | O(σ·⌈m/w⌉) words |
| `TwoWay` | O(m) | O(n) | O(n) | O(1) |

Definitions: `n` text length, `m` pattern length, `σ` alphabet size, `w` word
size (32 bits; longer patterns use several words).

### Notes

- **KMP:** the failure function lets the scan never back up in the text; it is
  the default for streams.
- **Boyer-Moore family:** skips ahead using the last character of the window;
  Horspool and Sunday keep only the bad-character table and are fastest in
  practice for natural-language text.
- **Rabin-Karp:** rolling hash with verification; its strength is matching many
  equal-length patterns at once, which `RabinKarp.multi` exposes.
- **Z algorithm:** computes, for each position, the longest prefix match;
  `zArray` is exported on its own because it is reused by Part 23.
- **Shift-Or:** state as a bit mask; trivially extended to approximate
  matching with `k` errors (`ShiftOr.approximate`).
- **Two-Way:** critical factorization gives linear time with constant extra
  space; it is the basis of `String.prototype.indexOf` in several engines.

## Example

```js
import { BoyerMoore, KnuthMorrisPratt } from 'ds-app/string-search';

const bm = new BoyerMoore('needle');
bm.first('haystack with a needle in it');   // 16
bm.search('needle needle');                 // [0, 7]

const kmp = new KnuthMorrisPratt('aa');
kmp.search('aaaa');                         // [0, 1, 2]
kmp.count('aaaa');                          // 3
kmp.validate();                             // true
```

## Conformance checklist

- Every matcher agrees with a naive scanner on random and adversarial texts
  (periodic, single-character, binary, Unicode with surrogate pairs).
- Overlapping and non-overlapping modes are both tested.
- Worst-case inputs for Horspool and Rabin-Karp stay within the documented
  bounds.
- Patterns longer than one word exercise multiword Shift-Or.
- `validate()` detects a corrupted failure table.
