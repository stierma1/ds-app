# A11 — Image Data Structures

**Module:** `ds-app/applications/image` · **Status:** planned ·
**Builds on:** Part 18 (quadtrees), Part 24 (union-find, bit sets), Part 1 (queues), Part 20 (Hilbert/Morton codes)

## Use case

Binary and label images from scanners, segmentation, OCR, and GIS rasters
need to be stored compactly, combined with set operations, broken into
connected regions, measured for distances, and filled or cleaned up with
morphological operators. The structures here make those operations run in
time proportional to the image's content rather than its area.

## Problem

Represent a `W × H` image so that boolean operations between images, region
labeling, distance transforms, flood fill, and erosion/dilation are fast, and
so that large sparse images do not cost `W·H` memory.

## How it is solved

1. **Region quadtree images.** A binary image is a Part 18 region quadtree
   whose leaves are uniform blocks. Space is proportional to the length of
   region boundaries, not to the area. Union and intersection of two images
   walk both trees in lockstep and never descend into a block that is uniform
   in both; translation, rotation by 90 degrees, and connected-component
   labeling are tree traversals with neighbor finding through the common
   ancestor. A linear quadtree stores only the leaves as Morton codes, which
   is the form used for disk storage and for Hilbert-ordered tiling of large
   rasters.
2. **Run-length encoding.** Each row is a list of runs of equal value. It is
   the natural input format for scanners and fax images and the most compact
   for text-like images; row-wise operations (boolean ops, labeling, moments)
   merge runs in time linear in the number of runs.
3. **Connected-component labeling.** The two-pass algorithm scans the image
   once, assigning provisional labels and recording label equivalences in a
   Part 24 union-find whenever two labeled neighbors meet, then relabels with
   the representatives. Cost is `O(W·H · α)` and it extends directly to
   run-length input, where equivalences are recorded per overlapping run.
4. **Distance transform.** The exact Euclidean distance transform uses the
   two-pass separable algorithm of Felzenszwalb and Huttenlocher, which
   computes a lower envelope of parabolas per row and then per column in
   `O(W·H)`; chamfer distances (3-4, 5-7-11) are two raster passes with a
   small mask when an approximation suffices. Both feed skeletonization and
   nearest-feature maps.
5. **Flood fill.** A scanline fill pushes horizontal spans on a Part 1 queue
   or stack rather than individual pixels, which bounds memory by the number
   of spans and visits each pixel once.
6. **Morphology on bit sets.** Rows are packed into Part 24 `BitSet`s;
   erosion and dilation by a rectangular structuring element are word-parallel
   shifts, ANDs, and ORs, so an operation costs `O(W·H / w)` word operations
   for word size `w`. Opening and closing compose them.
7. **Tiling.** Large rasters are split into tiles ordered by Hilbert or
   Morton code so that spatially nearby tiles are nearby in storage.

## Structures used

| Part | Structure | Role |
|------|-----------|------|
| 18 | `RegionQuadtree`, `LinearQuadtree`, Morton codes | Compact images, set operations, tiling |
| 24 | `UnionFind`, `BitSet` | Component labeling, morphology |
| 1 | `ArrayQueue`, `ArrayStack` | Scanline flood fill |
| 20 | Hilbert codes | Tile ordering |

## Complexity summary

| Operation | Cost |
|-----------|------|
| Quadtree build / boolean op | O(W·H) / O(nodes of both trees) |
| Run-length boolean op | O(runs) |
| Component labeling | O(W·H · α(W·H)) |
| Euclidean distance transform | O(W·H) |
| Flood fill | O(filled pixels) |
| Erosion / dilation | O(W·H / w) word operations |

## Example

```js
import { BinaryImage } from 'ds-app/applications/image';

const img = BinaryImage.fromBits(bits, 640, 480);
const q = img.toQuadtree();
q.nodeCount;                                     // far fewer than 640·480 for a sparse image
const labels = img.connectedComponents({ connectivity: 8 });
labels.count;                                    // number of regions
img.distanceTransform()[y][x];                   // distance to the nearest set pixel
img.erode({ w: 3, h: 3 }).dilate({ w: 3, h: 3 }); // opening
```

## Validation and benchmark data

- Every operation is differential-tested against a naive per-pixel
  implementation on random, sparse, and structured (text, shapes) images.
- Benchmarks use standard binary test images and large GIS rasters,
  reporting bytes per image for each representation and time per operation.
