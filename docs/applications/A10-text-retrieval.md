# A10 — Text Retrieval

**Module:** `ds-app/applications/text-retrieval` · **Status:** planned ·
**Builds on:** Part 26 (Elias-Fano), Part 22 (tries), Part 6 (heaps), Part 15 (metric trees), Part 8 (hashing), Part 35 (string search)

## Use case

Search over a document collection: find the documents that contain a set of
terms or a phrase, rank them by relevance, complete a query as the user
types, correct misspelled terms, and detect near-duplicate documents. This
is the core of web search, site search, log search, and code search.

## Problem

Index `N` documents with a vocabulary of `V` terms and `P` total postings
so that conjunctive and disjunctive queries return the top `k` documents by a
scoring function in time proportional to the posting lists touched, not to
`N`; support prefix completion over the vocabulary; find terms within a small
edit distance of a misspelled query term; and group documents that share most
of their content.

## How it is solved

1. **Inverted index.** Tokenization and normalization produce, for each term,
   a sorted list of document ids with term frequencies and positions. The
   dictionary maps term to list offset through a Part 22 compressed trie,
   which also serves prefix queries. Each posting list is a monotone sequence
   stored with Part 26 Elias-Fano encoding, partitioned into blocks so dense
   and sparse regions get different parameters; frequencies and positions are
   stored alongside with variable-byte codes. The encoding supports
   `nextGEQ(d)`, the jump to the first document id at or beyond `d`, through
   `select`, which is the operation query processing needs.
2. **Conjunctive queries.** Lists are intersected by leap-frogging: start
   from the shortest list and call `nextGEQ` on the others, so the cost is
   proportional to the shortest list times a logarithmic factor rather than
   to the sum of lengths. Phrase queries intersect on document id and then
   check positions for adjacency.
3. **Ranked disjunctive queries.** Each document is scored with BM25 from
   term frequency, document length, and inverse document frequency. A Part 6
   min-heap of size `k` holds the current top results. The WAND and MaxScore
   strategies store each list's maximum possible score and skip documents
   that cannot enter the top `k`, which avoids scoring most of the candidates.
4. **Autocomplete.** The query prefix is located in the dictionary trie and
   the subtree is enumerated by stored popularity with a heap-bounded search,
   returning the top completions without visiting the whole subtree.
5. **Spelling correction.** Vocabulary terms are placed in a BK-tree (a Part
   15 metric tree over Levenshtein distance); a query term retrieves all
   terms within distance 1 or 2 by pruning on the triangle inequality. For
   very long vocabularies, Part 35's Shift-Or approximate matcher scans the
   candidate set instead.
6. **Near-duplicate detection.** Each document is reduced to its set of
   `w`-word shingles, hashed; a minhash signature of `s` hash functions
   estimates Jaccard similarity; locality-sensitive hashing bands the
   signature into Part 8 hash tables so candidate pairs are found without
   comparing every pair.

## Structures used

| Part | Structure | Role |
|------|-----------|------|
| 26 | `EliasFanoSequence` | Posting lists with `nextGEQ` |
| 22 | `CompressedTrie` | Dictionary and prefix completion |
| 6 | `BinaryHeap` | Top-k and heap-bounded completion |
| 15 | `VantagePointTree` / BK-tree | Edit-distance neighbors |
| 8 | `HashMap` | Minhash LSH bands, term statistics |
| 35 | `ShiftOr` | Approximate term scan |

## Complexity summary

| Operation | Cost |
|-----------|------|
| Index build | O(P log P) for sorting postings, then O(P) encoding |
| Index space | about 2 + log(N/df) bits per posting plus frequencies and positions |
| Conjunctive query | O(shortest list · log(longest / shortest)) |
| Top-k disjunctive | O(candidates scored · log k), far below sum of list lengths with WAND |
| Completion | O(prefix + k log k) |
| Spelling candidates | O(log V) expected probes with pruning |
| Near-duplicates | O(N · s) signatures plus O(candidate pairs) |

## Example

```js
import { Index } from 'ds-app/applications/text-retrieval';

const index = Index.build(documents, { positions: true });
index.search('data structures', { topK: 10 });         // [{ doc, score }]
index.phrase('"suffix array"');                        // documents with the exact phrase
index.complete('suff', 5);                             // ['suffix', 'suffix array', ...]
index.suggest('sufix');                                // ['suffix']
index.nearDuplicates({ shingle: 5, bands: 20 });       // clusters of similar documents
```

## Validation and benchmark data

- Query results are differential-tested against a brute-force scan of the
  documents; BM25 scores match a reference implementation; minhash
  similarity estimates are checked against exact Jaccard on small sets.
- Benchmarks index a Wikipedia subset and a TREC-style collection and report
  index size in bits per posting, queries per second for conjunctive and
  top-k queries, and completion latency.
