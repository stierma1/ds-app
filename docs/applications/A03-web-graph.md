# A3 — The Web as a Dynamic Graph

**Module:** `ds-app/applications/web-graph` · **Status:** planned ·
**Builds on:** Part 3 (graphs), Part 26 (Elias-Fano), Part 29 (dynamic graphs), Part 24 (filters)

## Use case

Search engines, crawlers, and link-analysis tools work with graphs whose nodes
are pages and whose edges are hyperlinks: billions of nodes, tens of billions
of edges, changing continuously. Ranking (PageRank, HITS), spam and community
detection, reachability from a seed set, and crawl scheduling all run on this
graph, so it must fit in memory in compressed form while still supporting fast
adjacency access and incremental change.

## Problem

Store a directed graph with `n` nodes and `m` edges in a few bits per edge,
iterate a node's successors fast enough for whole-graph algorithms, answer
reachability and ranking queries, and absorb a stream of link insertions and
deletions without rebuilding from scratch.

## How it is solved

1. **Ordering and gap encoding.** Pages are numbered in lexicographic URL
   order, so a page's links point mostly to nearby numbers. Each successor
   list is sorted and stored as a monotone sequence with Part 26's Elias-Fano
   encoding, which costs about `2 + log(n/deg)` bits per successor and still
   supports random access and next-greater-or-equal in constant time via
   `select`. Lists are partitioned into chunks so dense and sparse regions get
   the encoding that suits them. Reference copying from a similar earlier
   list, as in the WebGraph framework, is an optional second stage.
2. **Static algorithms over compressed storage.** Breadth-first and
   depth-first search, Part 3's Tarjan SCC (iterative, so deep crawls do not
   overflow the stack), and the bow-tie decomposition run directly over the
   compressed successor iterators. Reachability queries use the SCC
   condensation: two nodes in the same component are mutually reachable, and
   on the condensation DAG a topological-interval labeling answers most
   queries in O(1) with a bounded search for the rest.
3. **Ranking.** PageRank is the power iteration `r ← (1 − α)/n + α·Mᵀr`
   with damping `α = 0.85`, dangling nodes redistributed uniformly, and
   convergence tested on the L1 change. It streams over the compressed graph
   with two dense vectors. HITS runs the same iteration for hub and authority
   scores on a query-focused subgraph. Both support warm starts so that a
   changed graph converges in a few iterations.
4. **Dynamic links.** Insertions and deletions are buffered in a small
   uncompressed delta graph (Part 3 adjacency list) and merged into the
   compressed base periodically. Connectivity under change is delegated to
   Part 29's dynamic connectivity, and the delta graph is also the input to
   warm-started PageRank.
5. **Crawl support.** A Part 24 Bloom filter records visited URLs during a
   crawl, and the frontier is a priority queue ordered by current rank.

## Structures used

| Part | Structure | Role |
|------|-----------|------|
| 26 | `EliasFanoSequence` | Compressed successor lists |
| 3 | `CSRGraph`, `AdjacencyList`, `stronglyConnectedComponents` | Static traversal, SCC, delta graph |
| 29 | `DynamicConnectivity` | Connectivity under link changes |
| 24 | `BloomFilter` | Visited set in crawling |
| 6 | `BinaryHeap` | Crawl frontier |

## Complexity summary

| Operation | Cost |
|-----------|------|
| Successor iteration | O(deg) with O(1) random access |
| Space | about 2 + log(n/avg deg) bits per edge plus o(n) |
| SCC, BFS, bow-tie | O(n + m) |
| PageRank iteration | O(n + m); typically 50-100 iterations cold, far fewer warm |
| Link update | O(1) into the delta graph; merge O(n + m) amortized over a batch |

## Example

```js
import { WebGraph, pageRank } from 'ds-app/applications/web-graph';

const g = WebGraph.fromEdgeList(edges, { order: 'url' });
g.bitsPerEdge();                       // e.g. 3.1
const ranks = pageRank(g, { damping: 0.85, tolerance: 1e-9 });
g.addEdge(42, 7);                      // buffered in the delta graph
const ranks2 = pageRank(g, { warmStart: ranks });
g.reachable(42, 7);                    // true
```

## Validation and benchmark data

- Compressed adjacency is differential-tested against Part 3's adjacency list
  on random graphs and on the SNAP web-Google graph.
- PageRank matches a dense reference to 1e-9 on small graphs and matches
  published rank orderings on the benchmark graph.
- Benchmarks report bits per edge, successor-iteration throughput, PageRank
  time per iteration, and delta-merge time at 10^6 to 10^8 edges.
