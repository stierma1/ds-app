# Part 13 — Trees with Minimum Weighted Path Length

**Module:** `ds-app/mwpl-trees` · **Source:** `src/mwpl-trees/` · **Status:** done

## Scope

Prefix codes and the trees that minimize weighted path length: Huffman coding,
adaptive Huffman coding, length-limited Huffman coding, and Hu-Tucker optimal
alphabetic trees. The common abstraction is a prefix code with an explicit
encode/decode surface, not a general-purpose container.

## Common API

```ts
export type SymbolKey = string | number;

export interface PrefixCode<S extends SymbolKey = string> {
  readonly alphabet: ReadonlySet<S>;
  readonly weightedPathLength: number;
  codes(): ReadonlyMap<S, string>;
  encode(symbols: Iterable<S>): string;
  decode(bits: string): S[];
  isPrefixFree(): boolean;
  validate(): true | string;
}

export interface CodeOptions {
  maxLength?: number;
}

export interface AdaptivePrefixCode<S extends SymbolKey = string>
  extends PrefixCode<S> {
  update(symbol: S): void;
  reset(): void;
}
```

### Semantics

- `PrefixCode` is a codec, not a container: it does not implement `Container`
  because its elements are symbols with an associated code, not a sequence.
- `codes()` maps every symbol in the alphabet to a binary string; no code is a
  prefix of another.
- `encode` concatenates codes without separators; symbols outside the alphabet
  throw `RangeError`.
- `decode` consumes a complete bit string; an invalid or truncated suffix throws
  `RangeError`.
- `weightedPathLength` is `Σ frequency(s) · length(code(s))` and is fixed after
  construction for static codes.
- Adaptive codes update their tree after each `update(symbol)`; `reset()`
  restores the initial model, a single not-yet-transmitted node.
- `validate()` checks prefix-freeness, alphabet coverage, and the recorded
  weighted path length.

## Implementations and complexity

| Implementation | Build | Encode | Decode | Update | Space |
|----------------|-------|--------|--------|--------|-------|
| `HuffmanCode` | O(n log n), O(n) if frequencies are presorted | O(ℓ) per symbol | O(1) per bit | — | O(n) |
| `LengthLimitedHuffman` | O(n·L) package-merge | O(ℓ) per symbol | O(1) per bit | — | O(n·L), O(n) with the space-reduced variant |
| `AdaptiveHuffmanCode` | O(σ) initialization | O(ℓ) per symbol | O(1) per bit | O(σ log σ) rebuild | O(σ) |
| `HuTuckerCode` | O(n²) worst; O(n log n) with a balanced sequence | O(ℓ) per symbol | O(1) per bit | — | O(n) |

Definitions: `n` distinct symbols with positive frequencies, `L` maximum code
length, `σ` alphabet size, `ℓ` the code length of the symbol being encoded,
decoded, or updated. Encoding and decoding are linear in the number of bits
produced or consumed; a code table makes the per-symbol lookup O(1) but the
output is still `ℓ` bits.

### Notes

- **Huffman:** repeatedly merges the two least frequent subtrees using a
  priority queue. Ties are broken deterministically by symbol insertion order so
  output is stable.
- **Length-limited Huffman:** package-merge enforces `ℓ(s) ≤ maxLength` while
  minimizing weighted path length subject to that constraint. If the constraint
  is infeasible, the constructor throws `RangeError`.
- **Adaptive Huffman:** maintains a dynamic tree and rebuilds it after each
  `update(symbol)` over the observed symbol weights plus a zero-weight
  not-yet-transmitted (NYT) leaf while any alphabet symbol is still unseen. It
  needs no frequency table in advance and is suitable for streaming. Unseen
  symbols are transmitted as the NYT path followed by a fixed-width alphabet
  index, so encoding and decoding remain self-contained. Once every alphabet
  symbol has been seen, the NYT leaf is dropped and the tree is a Huffman tree
  over the observed weights alone (a one-symbol alphabet then has the code
  `0`); `decode` rejects escapes from then on, and `reset()` restores the NYT
  leaf. Because the tree is rebuilt as a Huffman tree, the
  sibling-property invariant holds after every update.
- **Hu-Tucker:** computes an optimal *alphabetic* code, where the left-to-right
  order of symbols must match the input order. It is not a general Huffman
  replacement when order is irrelevant. The implementation uses the equivalent
  Garsia–Wachs construction and converts its leaf depths to ordered code words.
- Static codes are immutable after construction; adaptive codes are stateful.

## Example

```js
import { HuffmanCode } from 'ds-app/mwpl-trees';

const code = HuffmanCode.fromFrequencies(
  new Map([['a', 5], ['b', 2], ['c', 1], ['d', 1]]),
);

code.codes();               // Map { 'a' => '0', 'b' => '10', 'c' => '110', 'd' => '111' }
const bits = code.encode(['a', 'b', 'c']); // '0' + '10' + '110'
code.decode(bits);          // ['a', 'b', 'c']
code.weightedPathLength;    // 15
code.validate();            // true
```

## Conformance checklist

- Encode/decode round-trips for random alphabets and frequency distributions.
- Huffman weighted path length matches a brute-force optimum for small inputs.
- Length-limited codes never exceed `maxLength` and remain optimal within that
  constraint for exhaustive small cases.
- Hu-Tucker codes preserve symbol order and match a brute-force optimum.
- Adaptive codes maintain the sibling property after every update.
- `validate()` rejects a prefix violation, a missing symbol, and a stale
  weighted-path-length value.
