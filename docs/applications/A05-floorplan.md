# A5 — Floorplan Representation in VLSI

**Module:** `ds-app/applications/floorplan` · **Status:** planned ·
**Builds on:** Part 2 (trees), Part 3 (graphs), Part 27 (integer keys), Part 9 (ordered maps)

## Use case

Floorplanning places the large blocks of a chip (memories, cores, IP blocks)
on the die before detailed placement. An optimizer such as simulated annealing
explores millions of candidate floorplans, so the representation must encode
a floorplan compactly, support small random perturbations, and evaluate the
resulting area and wirelength quickly.

## Problem

Given `n` rectangular modules, some with a fixed shape and some "soft" with a
set of allowed aspect ratios, and a netlist connecting them, represent the
relative positions of the modules so that (a) every representation decodes to
a non-overlapping packing, (b) a random move produces a nearby valid
representation, and (c) the packing's area and half-perimeter wirelength can
be evaluated in time close to linear in `n`.

## How it is solved

1. **Slicing trees.** A floorplan obtained by recursively cutting the die
   with horizontal and vertical lines is a binary tree whose leaves are
   modules and whose internal nodes are `H` or `V` cuts (Part 2). Written in
   postfix it is a Polish expression; the normalized form (no two consecutive
   identical operators) makes the encoding unique. Moves swap adjacent
   operands, complement a chain of operators, or swap an operand with an
   operator. Area is evaluated bottom-up with shape curves: each module
   contributes its list of (width, height) options, and a cut node merges its
   children's curves (adding heights and taking the maximum width for `H`,
   the converse for `V`), which is a linear merge of two sorted lists. The
   root's curve gives the minimal-area shape and the choice is propagated back
   down to size the soft modules. Evaluation is `O(n·k)` for `k` shape
   options per module.
2. **Sequence pairs.** A pair of permutations `(Γ₊, Γ₋)` encodes any
   non-slicing packing: module `a` is left of `b` if `a` precedes `b` in both
   sequences, and below `b` if `a` follows `b` in `Γ₊` and precedes it in
   `Γ₋`. Decoding builds horizontal and vertical constraint graphs (Part 3)
   and takes longest paths, `O(n²)`. The faster decoder observes that each
   module's `x` is the weight of the longest common subsequence of the two
   sequences ending at that module, and computes all of them in
   `O(n log log n)` with a Part 27 van Emde Boas tree over sequence positions
   (Tang and Wong), or in `O(n log n)` with a Part 9 ordered map. Moves swap
   two modules in one or both sequences or rotate a module.
3. **Mosaic floorplans.** When no empty rooms are allowed, the floorplan is a
   mosaic and admits `O(n)`-size encodings: the corner block list records,
   for modules inserted at the top-right corner, the orientation and the
   number of T-junctions covered, and twin binary trees give a bijection with
   mosaic floorplans. Both decode in `O(n)` and give the smallest move
   neighborhood.
4. **Cost hooks.** The optimizer supplies a cost function; the module
   provides area, aspect-ratio penalty, and half-perimeter wirelength
   computed from the netlist and decoded module centers, each `O(n + pins)`.

## Structures used

| Part | Structure | Role |
|------|-----------|------|
| 2 | `BinaryTree` | Slicing tree |
| 3 | `AdjacencyList`, DAG longest path | Constraint graphs for sequence pairs |
| 27 | `VanEmdeBoasTree` | Weighted LCS decoder for sequence pairs |
| 9 | `RedBlackTree` | Portable LCS decoder |
| 12 | seeded PRNG | Reproducible annealing moves |

## Complexity summary

| Representation | Encoding size | Decode (area) | Move | Covers |
|----------------|---------------|---------------|------|--------|
| Slicing tree / Polish expression | O(n) | O(n·k) shape-curve merge | O(1) to O(n) | slicing floorplans |
| Sequence pair | 2 permutations | O(n log log n) or O(n²) | O(1) | all packings |
| Corner block list / twin binary trees | O(n) | O(n) | O(1) | mosaic floorplans |

## Example

```js
import { SequencePair, anneal } from 'ds-app/applications/floorplan';

const modules = [{ id: 'cpu', w: 40, h: 30 }, { id: 'ram', w: 20, h: 50, soft: true }, { id: 'io', w: 10, h: 10 }];
const sp = SequencePair.initial(modules, { rng: 1 });
const packing = sp.decode();          // { positions, width, height }
const best = anneal(sp, { nets, cost: (p) => p.width * p.height + 0.5 * p.hpwl, iterations: 1e6 });
best.decode().width * best.decode().height; // minimized area
```

## Validation and benchmark data

- Every decoder is checked for non-overlap and matches the `O(n²)` constraint
  graph decoder; slicing-tree area matches brute-force enumeration of shape
  choices for small trees.
- Benchmarks run annealing on the MCNC (ami33, ami49) and GSRC (n100, n300)
  floorplanning benchmarks and report decode time per move and final area
  against published results.
