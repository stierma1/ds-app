# A7 — Geographic Information Systems

**Module:** `ds-app/applications/gis` · **Status:** planned ·
**Builds on:** Part 20 (R-trees), Part 18 (quadtrees), Part 16 (PSLG), Part 14 (B+-trees), A9 (geometry)

## Use case

A GIS stores map features (points of interest, roads, parcels, land cover)
and terrain, and answers questions such as "which parcels intersect this
window", "what is the nearest hospital", "what is the elevation here", and
"overlay zoning onto land use". Data sets are large and mostly static, with
periodic bulk updates, and queries are spatial.

## Problem

Index points, polylines, and polygons for window and nearest-feature
queries; represent terrain both as irregular samples and as a raster;
compute the overlay of two polygon subdivisions and join their attributes;
and tile space into keys that sort and bucket features for storage.
Coordinates are planar; map projections are out of scope.

## How it is solved

1. **Feature indexing.** Each feature's bounding box goes into a Part 20
   R*-tree, bulk-loaded with STR when a layer is imported; window queries
   return candidates whose exact geometry is then tested with A9 predicates.
   Point layers use a Part 18 PR quadtree when their distribution is skewed.
   Nearest-feature and k-nearest queries use the R-tree's best-first search
   with the box-to-point distance as the lower bound, refined by exact
   distance to the polyline or polygon.
2. **Terrain as a TIN.** Elevation samples are triangulated with A9's
   Delaunay construction and stored in a Part 16 half-edge structure, with
   slope and aspect cached per triangle. Elevation at a point is found by
   locating the triangle (Part 16 trapezoidal map) and interpolating with
   barycentric weights. Contours come from walking triangle edges at each
   level.
3. **Terrain as a DEM.** A raster grid of elevations is compressed with a
   Part 18 region quadtree where neighboring cells are within a tolerance,
   and the same tree provides level of detail by stopping descent early.
   Marching squares extracts contours from the grid.
4. **Map overlay.** Two polygon layers are converted to Part 16 planar graphs
   and overlaid with the Bentley-Ottmann sweep; each face of the result
   carries the attributes of the face it came from in each input, giving the
   attribute join. Polygon booleans in A9 are the same machinery with a face
   filter.
5. **Tiling and keys.** Morton (Z-order) and Hilbert codes from Part 18 and
   Part 20 map a cell to an integer that preserves locality; geohash is the
   base-32 string form of the Morton code. Features keyed by Hilbert code are
   stored in a Part 14 B+-tree so that a window query becomes a few range
   scans, which is how tile servers and spatial databases lay out storage.

## Structures used

| Part | Structure | Role |
|------|-----------|------|
| 20 | `RStarTree`, `STRTree` | Feature index, nearest feature |
| 18 | `PRQuadtree`, `RegionQuadtree`, Morton codes | Point layers, DEM compression, tiling |
| 16 | `PlanarGraph`, `TrapezoidalMap`, `overlay` | TIN storage, point location, map overlay |
| 14 | `BPlusTree` | Hilbert-keyed feature storage |
| A9 | Delaunay, predicates, distance | TIN construction, exact tests |

## Complexity summary

| Operation | Cost |
|-----------|------|
| Layer import (STR) | O(n log n) |
| Window query | O(log n + k) average |
| Nearest feature | O(log n) average |
| TIN build / point elevation | O(n log n) expected / O(log n) expected |
| Overlay of two layers | O((n + k) log n) |
| Hilbert-keyed range scan | O(log_B n + k/B) block transfers |

## Example

```js
import { FeatureLayer, Terrain } from 'ds-app/applications/gis';

const roads = FeatureLayer.fromGeoJSON(await load('roads.geojson'));
roads.nearest([lon, lat], 3);                       // three nearest road segments
roads.search({ min: [-122.5, 37.7], max: [-122.3, 37.8] }).length;

const tin = Terrain.fromSamples(points);           // Delaunay TIN
tin.elevationAt([-122.4, 37.75]);                  // interpolated height
tin.contours(100);                                 // polylines every 100 units
```

## Validation and benchmark data

- Window and nearest queries are differential-tested against a linear scan
  over exact geometry; TIN elevation matches direct barycentric evaluation;
  overlay output faces satisfy Euler's formula and reproduce both inputs when
  unioned.
- Benchmarks use an OpenStreetMap city extract, Natural Earth polygons, and
  an SRTM elevation tile, reporting import time, queries per second, and
  overlay time.
