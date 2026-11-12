# ds-app

A JavaScript library of data structures and applications, implemented from the
*Handbook of Data Structures and Applications* (Dinesh P. Mehta and Sartaj Sahni,
eds.). The goal is a complete, dependency-free, production-quality implementation
of every structure and application in the book — not a collection of demos.

This document is the project roadmap and definition of done. It is a living
document: phases, module names, and acceptance criteria evolve as the library
grows.

---

## Vision

Turn the book's catalog of data structures into a coherent JavaScript library
with one consistent API, documented complexity guarantees, and tests that pin
behavior to the published algorithms. Every structure should be usable directly
by application code, teachable as a reference implementation, and fast enough
for real workloads.

## Goals

| # | Goal | What it means in practice |
|---|------|---------------------------|
| G1 | **Completeness** | All 38 structure parts and 15 application areas below are implemented and exported. |
| G2 | **Honest complexity** | Each operation documents its asymptotic cost and meets it under a benchmark, including amortized and randomized bounds. |
| G3 | **Correctness first** | Unit tests, property-based tests against naive reference models, invariant checks, and fuzzing. |
| G4 | **Idiomatic JavaScript** | ES modules, iterables, `Map`/`Set`-like ergonomics, comparator injection, no hidden globals. |
| G5 | **Zero runtime dependencies** | No runtime `dependencies`. Browser, Node, Deno, and Bun supported. |
| G6 | **Tree-shakeable** | One subpath export per part; importing `lists` never pulls in `r-trees`. |
| G7 | **Type safe** | TypeScript declarations shipped for every public symbol; the source is authored in TypeScript and compiled to plain JavaScript. |
| G8 | **Teachable** | Every module has a README with the ADT, invariants, complexity table, diagrams, and a link to the source algorithm. |
| G9 | **Deterministic** | Randomized structures accept a seeded PRNG so results are reproducible. |
| G10 | **Generic interfaces** | Each part is defined by a shared generic contract; every implementation publishes its per-operation time and space complexity. |

## Non-goals

- Reimplementing the book's prose or figures. This is an independent
  implementation; no book text is reproduced.
- A visualizer, playground, or GUI in the core package. Those may live in
  separate packages later.
- Wrapping third-party data structure libraries. Everything is implemented here.
- WASM/GPU acceleration before the pure-JavaScript versions are correct and
  benchmarked.
- Persistence, databases, or network protocols.

## Guiding principles

1. **ADT first, implementation second.** Public behavior is defined by the
   abstract data type; the chosen structure is an implementation detail exposed
   only where it matters (e.g. `SplayTree`, `RedBlackTree`).
2. **One shape of API.** All containers support `size`, `isEmpty`, `clear`,
   `toArray`, iteration, and `validate()`. Ordered containers accept an optional
   comparator. Maps accept `set/get/has/delete`. Queues accept
   `push/pop/peek`.
3. **Explicit invariants.** `validate(): true | string` checks the structural
   invariant and is called by the test suite after every mutation.
4. **No silent surprises.** Out-of-range access returns `undefined`; invalid
   arguments throw `TypeError`/`RangeError`; empty `pop`/`peek` is documented
   per structure and tested.
5. **Reference models.** Every structure is tested against a slow, obviously
   correct model (e.g. a sorted array for ordered sets) with randomized
   operation sequences.
6. **Benchmark or it did not happen.** Performance claims are backed by
   benchmarks with committed baselines and regression thresholds.

---

## Architecture

Single published package with subpath exports. The internal layout mirrors the
book so that code and chapter stay easy to cross-reference.

```text
src/
  core/            # comparators, iterators, errors, invariant helpers, seeded RNG
  lists/           # Part 1
  trees/           # Part 2
  graphs/          # Part 3
  leftist-trees/   # Part 4
  skew-heaps/      # Part 5
  heaps/           # Part 6
  depq/            # Part 7
  hash-tables/     # Part 8
  balanced-trees/  # Part 9
  finger-search-trees/   # Part 10
  splay-trees/     # Part 11
  randomized/      # Part 12
  mwpl-trees/      # Part 13
  b-trees/         # Part 14
  spatial/         # Part 15
  pslg/            # Part 16
  interval-trees/  # Part 17
  quadtrees/       # Part 18
  bsp/             # Part 19
  r-trees/         # Part 20
  approximate/     # Part 21
  tries/           # Part 22
  suffix/          # Part 23
  sets/            # Part 24
  dynamic-trees/   # Part 25
  succinct/        # Part 26
  integer-keys/    # Part 27
  persistent/      # Part 28
  dynamic-graphs/  # Part 29
  cache-oblivious/ # Part 30
  kinetic/         # Part 31
  pq-trees/        # Part 32
  spatiotemporal/  # Part 33
  external-memory/ # Part 34
  string-search/   # Part 35
  distance-oracles/      # Part 36
  cuttings/        # Part 37
  online-dictionaries/   # Part 38
  applications/    # A1-A15
tests/
  unit/ property/ fuzz/ invariants/
benchmarks/
docs/
  api/             # one contract document per part
  applications/    # one write-up per application
```

Each directory exports from an `index.ts`; the package exposes
`ds-app/<module>` subpaths plus a barrel `ds-app` for convenience.

### Public API sketch

```js
import { BinaryHeap } from 'ds-app/heaps';
import { SplayTree } from 'ds-app/splay-trees';

const tasks = new BinaryHeap((a, b) => a.priority - b.priority);
tasks.push({ id: 'a', priority: 2 });
tasks.push({ id: 'b', priority: 1 });
tasks.peek(); // { id: 'b', priority: 1 }
[...tasks];   // snapshot in heap order, not sorted; never consumes the queue

const idx = new SplayTree((x, y) => x.localeCompare(y));
idx.set('gamma', 3);
idx.get('gamma'); // 3
idx.validate();   // true
```

### API contracts

The generic interfaces for all 38 parts, with per-implementation complexity
tables, live in [`docs/api/`](./docs/api/README.md). The shared container,
ordering, error, ownership, iteration, and serialization rules are defined once
in the [Common API Contract](./docs/api/00-common-contract.md) and referenced by
every part document. Each application in Phase 8 has a write-up in
[`docs/applications/`](./docs/applications/README.md) covering its use case,
the approach, and the parts it composes.

### Complexity documentation format

Every structure README contains a table in this form, and the test suite asserts
the corresponding behavior where it is observable (e.g. node counts, comparisons
counted through the comparator):

| Operation | Average | Worst | Amortized | Notes |
|-----------|---------|-------|-----------|-------|
| `find`    | O(log n)| O(n)  | —         | Splay trees are amortized only. |

---

## Roadmap overview

| Phase | Theme | Parts | Target release |
|-------|-------|-------|----------------|
| 0 | Foundations | tooling, core, docs skeleton | v0.0 |
| 1 | Fundamental structures | 1, 2, 3 | v0.1 |
| 2 | Hashing and sets | 8, 24 | v0.2 |
| 3 | Priority queues | 4, 5, 6, 7, 13 | v0.3 |
| 4 | Search trees | 9, 10, 11, 12, 14 | v0.4 |
| 5 | String indexes | 22, 23 | v0.5 |
| 6 | Spatial and geometric structures | 15, 16, 17, 18, 19, 20, 21 | v0.6 |
| 7 | Advanced structures | 25-38 | v0.7 |
| 8 | Applications | A1-A15 | v1.0 |

Status legend: `planned` · `in progress` · `done`. Current status: **Phase 3,
done**; `heaps`, `leftist-trees`, `skew-heaps`, `depq`, and `mwpl-trees` are
done.

Dependencies flow left to right and top to bottom: trees before search trees,
heaps before priority-queue variants, spatial indexes before GIS and collision
detection. Applications are last because they compose the earlier parts.

---

## Phase 0 — Foundations

- Package scaffolding: TypeScript source, ESM output, CJS compatibility build,
  `.d.ts` declarations, subpath exports.
- `src/core`: comparator utilities, `Iterator` helpers, error types, seeded
  PRNG (xoshiro128**), invariant/assert helpers, optional operation counting.
- Test runner, coverage, property-based testing, fuzzing harness.
- Benchmark harness with committed baselines and CI regression thresholds.
- Documentation site skeleton and per-module README template.
- API review: locking the common container interface before Part 1.

**Exit criteria:** CI runs lint, typecheck, unit tests, property tests, and a
benchmark smoke test; a published dry-run package can be imported from both ESM
and CJS.

---

## Phase 1 — Fundamental structures (v0.1)

| # | Module | Scope |
|---|--------|-------|
| 1 | `lists` | Array-backed and linked lists, singly/doubly/circular/sorted variants, cursor lists, XOR-linked list, ring-buffer deque with stack and queue views, order-maintenance list, generalized/orthogonal lists, list merge and split. |
| 2 | `trees` | Binary tree representation, traversals (pre/in/post/level, Euler tour), threaded trees, binary search tree, n-ary/general trees, parent pointers, static lowest common ancestor (Euler tour + RMQ, binary lifting), serialization. |
| 3 | `graphs` | Adjacency list and matrix, BFS/DFS, connected components, strongly connected components, bridges and articulation points, topological sort, spanning trees, shortest paths (Dijkstra, Bellman-Ford, Floyd-Warshall, A*), max-flow (Edmonds-Karp, Dinic), min-cost flow, bipartite matching, Euler paths, 2-SAT, graph generators. |

**Exit criteria:** every traversal iterates without recursion where depth could
overflow the stack; graph algorithms pass against known reference graphs and
randomized cross-checks.

---

## Phase 2 — Hashing and sets (v0.2)

| # | Module | Scope |
|---|--------|-------|
| 8 | `hash-tables` | Separate chaining, open addressing (linear, quadratic, double hashing), coalesced hashing, Robin Hood, cuckoo hashing, universal and perfect hashing, extendible/dynamic hashing, ordered hash maps. |
| 24 | `sets` | Set ADT, bitset/bit-vector sets, union-find (quick-find, quick-union, weighted, path compression), interval sets, Bloom filter with counting, partitioned, and scalable variants, cuckoo filter, k-way merge and set operations over sorted runs. |

**Exit criteria:** load-factor sweeps are benchmarked; adversarial key sets
cannot force pathological behavior beyond documented bounds; union-find matches
inverse-Ackermann expectations in practice.

**Status:** done. Run `npm run benchmark:phase2` for the load-factor sweep;
adversarial constant-hash and union-find depth checks live in
`tests/unit/phase2-exit.test.ts`.

---

## Phase 3 — Priority queues (v0.3)

| # | Module | Scope |
|---|--------|-------|
| 6 | `heaps` | Binary and d-ary heaps, bottom-up heap construction, pairing heap, binomial heap, Fibonacci heap, indexed heaps with decrease-key, monotone integer queues (bucket queue, radix heap), timer queues (calendar queue, hierarchical timing wheel). |
| 4 | `leftist-trees` | Leftist, height-biased, and weight-biased heaps; O(log n) meld; min, max, and double-ended variants. |
| 5 | `skew-heaps` | Self-adjusting meldable heap; amortized O(log n) insert/delete-min; recursive and iterative meld. |
| 7 | `depq` | Double-ended priority queues: min-max heap, deap, interval heap, symmetric variants, `getMin`/`getMax` in O(1). |
| 13 | `mwpl-trees` | Huffman coding, adaptive Huffman, length-limited Huffman, Hu-Tucker optimal alphabetic trees, minimum weighted path length trees. |

**Exit criteria:** meld-based structures are compared against binary heaps on
mixed workloads; decrease-key is tested for indexed variants; Huffman output is
verified by code-length optimality and decode round-trips.

**Status:** done. Run `npm run benchmark:phase3-heaps`,
`npm run benchmark:phase3-leftist`, `npm run benchmark:phase3-skew`,
`npm run benchmark:phase3-depq`, and `npm run benchmark:phase3-mwpl` for the
mixed workload and prefix-code comparisons; `tests/unit/heaps-*.test.ts`,
`tests/unit/leftist-trees.test.ts`, `tests/unit/skew-heaps.test.ts`,
`tests/unit/depq.test.ts`, and `tests/unit/mwpl-trees.test.ts` cover the heap,
indexed, monotone, timer, leftist, skew-heap, double-ended priority-queue, and
prefix-code contracts.

---

## Phase 4 — Search trees (v0.4)

| # | Module | Scope |
|---|--------|-------|
| 9 | `balanced-trees` | AVL, red-black, weight-balanced trees; rotations, join/split, order statistics, range queries, iterator stability. |
| 11 | `splay-trees` | Bottom-up and top-down splaying, `find`/`insert`/`delete`, `join`/`split`, amortized analysis tests. |
| 12 | `randomized` | Treap, skip list, randomized BST, randomized meldable heap; seeded RNG for reproducibility. |
| 10 | `finger-search-trees` | Level-linked B-tree, finger search from a held position, meldable finger search trees, neighbor queries. |
| 14 | `b-trees` | B-tree, B+-tree, B*-tree, 2-3-4 tree, order parameter, bulk loading, sequential access, disk-page simulation. |

**Exit criteria:** all ordered trees share a conformance suite (same operations,
same observable order); balance invariants are validated after every randomized
mutation; finger search shows the expected improvement when the finger moves
locally.

---

## Phase 5 — String indexes (v0.5)

| # | Module | Scope |
|---|--------|-------|
| 22 | `tries` | Standard trie, compressed/radix trie, Patricia trie, ternary search trie, double-array trie, Aho-Corasick multi-pattern search, longest-prefix match. |
| 23 | `suffix` | Suffix tree (Ukkonen), suffix array (prefix doubling and SA-IS), LCP array (Kasai), pattern search, longest repeated substring, Burrows-Wheeler transform, FM-index. |

**Exit criteria:** construction and search are validated against brute-force
string search on randomized and adversarial alphabets (single character,
binary, Unicode); memory behavior is measured on large inputs. The FM-index
depends on Part 26 and ships with Phase 7; it is the one permitted forward
dependency.

---

## Phase 6 — Spatial and geometric structures (v0.6)

| # | Module | Scope |
|---|--------|-------|
| 15 | `spatial` | kd-tree, range trees, vantage-point and metric trees, ball trees, cover trees, nearest-neighbor and k-NN search, spatial hashing. |
| 16 | `pslg` | Planar straight-line graphs: DCEL/half-edge representation, segment intersection, sweep-line triangulation, monotone polygons, trapezoidal-map point location, overlay. |
| 17 | `interval-trees` | Interval tree, segment tree, range tree, priority search tree; stabbing, window, and 3-sided queries; lazy propagation for segment trees; Fenwick tree, sparse table, and range-minimum query. |
| 18 | `quadtrees` | Region, point, PR, and linear quadtrees; octrees; neighbor finding; spatial decomposition and compression. |
| 19 | `bsp` | BSP tree construction with splitter selection, front-to-back traversal, CSG operations, visibility ordering, polygon classification. |
| 20 | `r-trees` | R-tree, R+-tree, R*-tree, Hilbert R-tree, STR bulk loading, insertion/split strategies, range and nearest-neighbor queries, bounding-volume hierarchy (SAH and LBVH builds, refit, ray cast, pairwise overlap). |
| 21 | `approximate` | Approximate range searching, BBD-tree, annulus queries, epsilon-kernel/core-set constructions, approximation guarantees and error bounds. |

**Exit criteria:** every spatial index passes the same query-conformance suite
against a linear scan; results are exact where the structure is exact and within
the documented epsilon where it is approximate; degenerate geometry (duplicate
points, collinear segments, empty input) is covered.

---

## Phase 7 — Advanced structures (v0.7)

| # | Module | Scope |
|---|--------|-------|
| 25 | `dynamic-trees` | Link-cut trees, Euler-tour trees, top trees; path and subtree aggregates, evert, lowest common ancestor. |
| 26 | `succinct` | Rank/select bit vectors, Elias-Fano sequences, wavelet trees and matrices, balanced-parentheses and LOUDS trees. |
| 27 | `integer-keys` | van Emde Boas trees, x-fast and y-fast tries, fusion-tree reference, integer priority queues. |
| 28 | `persistent` | Shared lists and real-time deques, path-copied vectors and maps, partially and fully persistent maps by node copying. |
| 29 | `dynamic-graphs` | Incremental, decremental, and fully dynamic connectivity, dynamic minimum spanning forest, incremental and fully dynamic shortest paths. |
| 30 | `cache-oblivious` | van Emde Boas layout, packed-memory array, cache-oblivious B-tree, funnel sort, funnel heap, simulated block model. |
| 31 | `kinetic` | Kinetic sorted list, tournament, heap, and convex hull; certificate event queue; flight-plan updates. |
| 32 | `pq-trees` | PQ trees, PC trees, consecutive-ones test, interval-graph recognition, planarity testing with embedding or obstruction. |
| 33 | `spatiotemporal` | TPR-tree, TPR*-tree, historical R-tree, 3D R-tree for trajectories. |
| 34 | `external-memory` | Block store with I/O counting, buffer tree, external priority queue, external interval and priority search trees, external sort. |
| 35 | `string-search` | Knuth-Morris-Pratt, Boyer-Moore family, Rabin-Karp, Z algorithm, Shift-Or, Two-Way. |
| 36 | `distance-oracles` | Thorup-Zwick distance oracle, greedy and Baswana-Sen spanners, landmark bounds. |
| 37 | `cuttings` | (1/r)-cuttings, hierarchical point location in arrangements, partition trees for simplex range searching. |
| 38 | `online-dictionaries` | LCP-augmented balanced trees and string B-trees for variable-length string keys. |

**Exit criteria:** dynamic structures are differential-tested against the
static Part 3 and Part 25 algorithms after every update; succinct structures
meet their bit budgets; I/O-model structures meet their transfer bounds under
the simulated block store; kinetic structures match from-scratch recomputation
at every event.

---

## Phase 8 — Applications (v1.0)

Each application has a write-up in [`docs/applications/`](./docs/applications/README.md).

| # | Module | Scope |
|---|--------|-------|
| A1 | `applications/ip-router` | Longest-prefix matching for IPv4/IPv6: binary trie, path-compressed trie, multibit trie, LC-trie, Lulea-style compressed trie, update support. |
| A2 | `applications/packet-classification` | Multi-dimensional packet classification: hierarchical tries, tuple-space search, decision trees, HiCuts/HyperCuts, incremental updates. |
| A3 | `applications/web-graph` | Dynamic web graph: gap-encoded adjacency over Part 26 Elias-Fano sequences, reachability, PageRank/HITS; link updates and connectivity delegate to Part 29. |
| A4 | `applications/layout` | VLSI layout data structures: corner stitching, rectangle overlap and neighbor queries; point location uses Part 16's trapezoidal map. |
| A5 | `applications/floorplan` | Floorplan representation: slicing trees, mosaic floorplans, sequence pairs, area/perimeter optimization hooks. |
| A6 | `applications/graphics` | Scene graphs, BSP-based visibility, BVH and kd-tree ray-tracing accelerators, spatial hashing. |
| A7 | `applications/gis` | Spatial indexing for maps: R-tree/quadtree indexes, TIN and DEM helpers, map overlay, nearest-feature queries, geohash and Hilbert tiling over Parts 18 and 20. Projections are out of scope. |
| A8 | `applications/collision` | Broad phase with BVH, sweep-and-prune, uniform grids, octrees; narrow-phase primitive tests; continuous collision support. |
| A9 | `applications/computational-geometry` | Convex hull, Delaunay triangulation and Voronoi diagrams, closest pair, rotating calipers, polygon booleans, point location and proximity queries. PSLG machinery (segment intersection, triangulation, overlay) stays in Part 16. |
| A10 | `applications/text-retrieval` | Inverted index with Elias-Fano posting lists (Part 26), positional phrase queries, BM25 scoring with top-k heaps (Part 6), autocomplete over tries (Part 22), spelling correction with a BK-tree (Part 15), near-duplicate detection with shingling and minhash (Part 8). |
| A11 | `applications/image` | Region-quadtree images (Part 18), run-length encoding, connected-component labeling with union-find (Part 24), distance transforms, flood fill, Morton-order tiling, bitset morphology. |
| A12 | `applications/data-mining` | FP-growth over an FP-tree, Apriori with a hash tree, k-means and DBSCAN accelerated by Parts 15 and 20, hierarchical clustering with a priority queue, locality-sensitive hashing. |
| A13 | `applications/compression` | Burrows-Wheeler (Part 23), move-to-front (Part 1), run-length, Huffman and adaptive Huffman (Part 13) as a bzip2-style pipeline; LZ77 over a suffix structure, LZ78/LZW over a trie (Part 22). |
| A14 | `applications/route-planning` | A* and bidirectional Dijkstra over an indexed heap (Part 6), ALT with Part 36 landmarks, contraction hierarchies, turn restrictions, on an OpenStreetMap extract. |
| A15 | `applications/caching-simulation` | LRU, LFU, ARC, and CLOCK caches from a hash map and linked list (Parts 8 and 1); discrete-event simulation over Part 6 calendar queues and timing wheels. |

**Exit criteria:** each application ships a runnable example and a benchmark
using realistic data (routing tables, packet traces, map extracts, meshes, text
corpora); the module builds on the public APIs of earlier parts and may define
domain-specific structures, which must implement the common contract
(`Container` where applicable, `validate()`, and the shared error types).

---

## Milestones

| Version | Contents | Gate |
|---------|----------|------|
| v0.0 | Tooling, core utilities, docs skeleton | CI green, package importable |
| v0.1 | Lists, Trees, Graphs | Conformance suites pass |
| v0.2 | Hash tables, Sets | Load-factor benchmarks stable |
| v0.3 | Heaps, Leftist, Skew, DEPQ, MWPL | Priority-queue conformance passes |
| v0.4 | Balanced, Splay, Randomized, Finger, B-trees | Ordered-tree conformance passes |
| v0.5 | Tries, Suffix structures | String conformance and memory gates pass |
| v0.6 | Parts 15-21 | Spatial conformance and epsilon checks pass |
| v0.7 | Parts 25-38 | Dynamic, succinct, I/O-model, and kinetic gates pass |
| v1.0 | A1-A15, docs, benchmarks, API freeze | Full suite, docs, and examples complete |

No version ships with a structure marked `done` unless it has: implementation,
type declarations, unit + property tests, invariant checks, complexity docs,
benchmark, and an example.

---

## Definition of done (per part)

1. **Public API** implemented with the common container interface and iterables.
2. **Types** exported; no `any` in the public surface.
3. **Unit tests** for every operation and boundary case.
4. **Property tests** against a naive reference model over randomized operation
   sequences.
5. **Invariant checks** run after every mutation in tests; `validate()` exposed.
6. **Fuzz tests** for parsers/builders and adversarial inputs.
7. **Complexity table** and algorithm notes in the module README, matching the
   part contract in [`docs/api/`](./docs/api/README.md).
8. **Benchmarks** with a committed baseline and a CI regression threshold.
9. **Example** in `examples/` and a runnable snippet in the README.
10. **No runtime dependencies**, no Node-only APIs in portable modules.

## Testing strategy

- **Reference models:** sorted arrays for ordered sets, arrays for sequences,
  brute-force scans for spatial queries, naive matchers for strings.
- **Differential testing:** run the same random operation log against the
  reference model and the structure, compare after each step.
- **Invariant validation:** balance factors, heap order, node colors, prefix
  ordering, bounding boxes, trie edges, union-find forest shape.
- **Determinism:** seeded PRNG for randomized structures; failing seeds are
  recorded and replayed as regression tests.
- **Performance gates:** operations/second and memory per element tracked per
  release; regressions beyond a threshold fail CI.

## Documentation strategy

Each module gets a README with: ADT contract, supported operations, complexity
table (average/worst/amortized and space), invariants, implementation notes,
edge cases, API example, and a pointer to the corresponding book part. The root
README stays focused on the roadmap; the docs site renders the module READMEs.

## Contributing

Work one part at a time, in roadmap order unless a dependency allows otherwise.
Every PR must include the definition-of-done checklist above and must not
regress existing benchmarks. Keep structures independent: a module may import
from `core` and from earlier roadmap parts, never from later ones or from
`applications`.

## Book attribution

Based on *Handbook of Data Structures and Applications*, edited by Dinesh P.
Mehta and Sartaj Sahni (Chapman & Hall/CRC). This project is an independent
implementation and is not affiliated with or endorsed by the editors or
publisher. Book text and figures are not reproduced.

## License

Apache-2.0. See [LICENSE](./LICENSE).
