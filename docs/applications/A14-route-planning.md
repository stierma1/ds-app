# A14 — Route Planning

**Module:** `ds-app/applications/route-planning` · **Status:** planned ·
**Builds on:** Part 3 (graphs), Part 6 (indexed heaps), Part 36 (landmarks), Part 20 (R-trees)

## Use case

Shortest paths on road networks for navigation, logistics, and
isochrone maps: millions of nodes, queries that must return in milliseconds,
and a graph that is static for hours but then updated. Plain Dijkstra settles
a large fraction of the continent for a long query; the techniques here
reduce that to thousands of nodes.

## Problem

Given a road network (nodes at junctions, directed edges with travel-time
weights, turn restrictions) and a source and target given as coordinates,
return the fastest route. Preprocessing may take minutes and extra memory;
queries must be fast; the result must be exact.

## How it is solved

1. **Graph and snapping.** The network is a Part 3 CSR graph for traversal
   speed. Query coordinates are snapped to the nearest edge with a Part 20
   R-tree over edge bounding boxes, and the route starts and ends at
   fractional positions on those edges.
2. **Dijkstra and A\*.** The baseline is Part 3 Dijkstra over a Part 6
   indexed binary heap with decrease-key. A\* adds a lower bound on the
   remaining distance to each key; with great-circle distance divided by the
   maximum speed as the heuristic it is admissible and expands fewer nodes
   in the direction of the target.
3. **Bidirectional search.** Forward search from the source and backward
   search from the target on the reversed graph alternate; the search stops
   when the smallest key in either queue exceeds the best meeting distance
   found so far, and the route is the concatenation at the meeting node.
   This roughly halves the settled nodes and combines with every technique
   below.
4. **ALT (landmarks).** A few dozen landmarks are chosen far apart; the
   exact distance from every node to each landmark is precomputed with
   Part 3 Dijkstra and stored (this is Part 36's `landmarkOracle`). The
   triangle inequality gives a lower bound `max over landmarks of
   |d(L, t) − d(L, v)|`, which is much tighter than straight-line distance on
   road networks and makes A\* expand an order of magnitude fewer nodes.
5. **Contraction hierarchies.** Nodes are ordered by importance (edge
   difference, contracted-neighbor count) and contracted one at a time: a
   node is removed and, for every pair of neighbors whose shortest path ran
   through it, a shortcut edge is added if a witness search finds no equally
   short alternative. The query is a bidirectional Dijkstra that only follows
   edges to more important nodes; it settles a few hundred nodes on a
   continental graph. The preprocessing takes minutes and the shortcuts add
   a modest fraction to the edge count. Routes are unpacked by expanding
   shortcuts recursively.
6. **Turn restrictions and costs.** Forbidden and penalized turns are
   modeled either on an edge-based graph (nodes are edges, arcs are allowed
   turns), which all algorithms above handle unchanged, or with per-junction
   turn tables consulted during relaxation.

## Structures used

| Part | Structure | Role |
|------|-----------|------|
| 3 | `CSRGraph`, `dijkstra`, `aStar` | Network and baseline searches |
| 6 | `IndexedBinaryHeap` | Priority queue with decrease-key |
| 36 | `landmarkOracle` | ALT lower bounds |
| 20 | `RTree` | Snapping coordinates to edges |
| 24 | `BitSet` | Visited and contracted flags |

## Complexity summary

| Technique | Preprocessing | Query (settled nodes on a continental graph) | Extra space |
|-----------|---------------|-----------------------------------------------|-------------|
| Dijkstra | none | O((V + E) log V); millions | none |
| A* (great circle) | none | fewer, direction-dependent | none |
| Bidirectional | none | about half | none |
| ALT | O(L · (V + E) log V) | tens of thousands | O(L · V) distances |
| Contraction hierarchies | minutes | hundreds | shortcuts, a fraction of E |

## Example

```js
import { Router } from 'ds-app/applications/route-planning';

const router = await Router.fromOSM('region.osm.pbf', { preprocess: 'contraction-hierarchies' });
const route = router.route([13.405, 52.52], [11.576, 48.137]);
route.travelTime;      // seconds
route.geometry.length; // coordinates along the route
router.isochrone([13.405, 52.52], 900); // polygon reachable within 15 minutes
```

## Validation and benchmark data

- Every technique returns exactly the Dijkstra distance on random queries
  over a real extract; contraction-hierarchy unpacking reproduces the
  original edges; turn restrictions are checked against hand-built
  junctions.
- Benchmarks use an OpenStreetMap region extract and the DIMACS road-network
  instances, reporting preprocessing time, memory, settled nodes, and query
  latency per technique.
