# A13 — Compression

**Module:** `ds-app/applications/compression` · **Status:** planned ·
**Builds on:** Part 23 (suffix arrays, BWT), Part 1 (lists), Part 13 (Huffman), Part 22 (tries), Part 8 (hashing)

## Use case

General-purpose lossless compression of text and binary data, as done by
gzip, bzip2, and LZW-based formats. This module composes the string parts
into the two classic pipelines: block sorting (Burrows-Wheeler) and
dictionary coding (Lempel-Ziv), each followed by entropy coding. It is the
clearest demonstration that Parts 13, 22, and 23 fit together.

## Problem

Transform an input byte sequence into a shorter one from which the original
can be recovered exactly. Compression ratio and throughput are the measures;
the decoder must be fast and must not need the structures the encoder used.

## How it is solved

### Block-sorting pipeline (bzip2 style)

1. **Burrows-Wheeler transform.** The block is split into chunks; each chunk
   is sorted by its cyclic rotations using a Part 23 suffix array (SA-IS,
   linear time), and the last column of the sorted rotations is emitted along
   with the index of the original rotation. The BWT groups together
   characters that precede the same context, so the output has long runs of
   few distinct symbols. Decoding needs only the last column: counting
   symbols yields the first column, the LF-mapping links each position to
   its predecessor, and following it from the primary index recovers the
   text in `O(n)`.
2. **Move-to-front.** A Part 1 list of the 256 symbols; each input symbol is
   replaced by its current position and moved to the front. Recently seen
   symbols become small numbers, turning the BWT's local repetition into a
   skewed distribution of small values.
3. **Run-length encoding** of the zero runs the move-to-front step produces.
4. **Huffman coding.** A Part 13 static Huffman code built from the block's
   symbol frequencies, with the code lengths transmitted in the header; the
   length-limited variant keeps codes within 20 bits for table-driven
   decoding. The adaptive code is the alternative for streaming without a
   header.

### Dictionary pipelines (LZ family)

5. **LZ77 / deflate.** The encoder slides a window over the input and, at
   each position, finds the longest earlier occurrence of the upcoming bytes
   within the window, emitting a (distance, length) pair or a literal. Match
   finding uses Part 8 hash chains keyed by the next three bytes, with a
   bounded chain walk, or for maximum ratio a Part 23 suffix array over the
   block with LCP information. Deflate then Huffman-codes the literals,
   lengths, and distances with two code tables.
6. **LZ78 / LZW.** The encoder maintains a dictionary of phrases in a Part 22
   trie; it walks the trie as far as the input matches, emits the code of the
   longest phrase, and adds that phrase extended by the next byte. The decoder
   rebuilds the identical dictionary from the codes alone, so no dictionary is
   transmitted; LZW pre-seeds the trie with all single bytes and handles the
   one-step-behind case where a code refers to the phrase being defined.

## Structures used

| Part | Structure | Role |
|------|-----------|------|
| 23 | `SuffixArray` (SA-IS), `bwt`, `lcpArray` | Block sorting, longest-match search |
| 1 | `ArrayList` / `DoublyLinkedList` | Move-to-front list |
| 13 | `HuffmanCode`, `LengthLimitedHuffman`, `AdaptiveHuffmanCode` | Entropy coding |
| 22 | `StandardTrie` | LZ78/LZW dictionary |
| 8 | `HashMap` with chains | LZ77 match finder |

## Complexity summary

| Stage | Encode | Decode |
|-------|--------|--------|
| BWT | O(n) via SA-IS | O(n) via LF-mapping |
| Move-to-front | O(n · σ) worst, near O(n) in practice | same |
| Huffman | O(σ log σ) build, O(n · ℓ) coding | O(n · ℓ), O(n) with lookup tables |
| LZ77 (hash chains) | O(n · chain bound) | O(n) |
| LZ77 (suffix array) | O(n) | O(n) |
| LZ78 / LZW | O(n) trie walks | O(n) |

## Example

```js
import { bzip, deflate, lzw } from 'ds-app/applications/compression';

const data = new TextEncoder().encode(text);
const a = bzip.compress(data, { blockSize: 900_000 });
bzip.decompress(a);                                   // equals data
const b = deflate.compress(data, { level: 6 });
const c = lzw.compress(data);
[a.length, b.length, c.length].map((n) => n / data.length); // compression ratios
```

## Validation and benchmark data

- Every pipeline round-trips random, empty, single-byte, periodic, and
  binary inputs; BWT inversion is checked independently; deflate output is
  verified against a reference inflater.
- Benchmarks run the Canterbury and Silesia corpora and report compression
  ratio and encode/decode throughput for each pipeline and level.
