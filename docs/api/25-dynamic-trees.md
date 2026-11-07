# Part 25 — Dynamic Trees

**Module:** `ds-app/dynamic-trees` · **Source:** `src/dynamic-trees/` · **Status:** planned

## Scope

Forests whose edges change by `link` and `cut` while path and subtree queries
stay logarithmic: link-cut trees, Euler-tour trees, and top trees. Nodes are
created by the structure and addressed by integer handles; the forest is never
copied. Dynamic graphs (Part 29) and persistent structures (Part 28) build on
this part.

## Common API

```ts
export type NodeId = number;

export interface AggregateOptions<T, A> {
  measure: (value: T) => A;
  combine: (x: A, y: A) => A;
  identity: A;
  apply?: (aggregate: A, delta: A, count: number) => A;
}

export interface DynamicForest<T> {
  readonly size: number;
  readonly treeCount: number;
  makeNode(value: T): NodeId;
  deleteNode(v: NodeId): boolean;
  link(child: NodeId, parent: NodeId): boolean;
  cut(child: NodeId): boolean;
  connected(a: NodeId, b: NodeId): boolean;
  findRoot(v: NodeId): NodeId;
  parent(v: NodeId): NodeId | undefined;
  get(v: NodeId): T;
  set(v: NodeId, value: T): void;
  validate(): true | string;
}

export interface PathForest<T, A> extends DynamicForest<T> {
  evert(v: NodeId): void;
  lca(a: NodeId, b: NodeId): NodeId | undefined;
  pathAggregate(a: NodeId, b: NodeId): A;
  pathUpdate(a: NodeId, b: NodeId, delta: A): void;
  pathLength(a: NodeId, b: NodeId): number;
}

export interface SubtreeForest<T, A> extends DynamicForest<T> {
  reroot(v: NodeId): void;
  subtreeAggregate(v: NodeId): A;
  treeAggregate(v: NodeId): A;
  subtreeSize(v: NodeId): number;
}
```

`DynamicForest` is a handle-based structure, not a `Container`: it exposes
`size` (nodes), `treeCount`, and `validate()` directly. Aggregates are supplied
as a monoid (`measure`, `combine`, `identity`); `apply` enables lazy path or
subtree updates.

### Semantics

- `link(child, parent)` requires `child` to be a root and in a different tree
  from `parent`; otherwise it returns `false` and changes nothing.
- `cut(child)` removes the edge to its parent and returns `false` for a root.
- `evert(v)` / `reroot(v)` makes `v` the root of its tree.
- `pathAggregate(a, b)` and `pathUpdate` require `a` and `b` to be connected;
  otherwise they throw `RangeError`.
- `deleteNode` requires an isolated node.
- `validate()` checks the auxiliary-tree invariants (splay order, path-parent
  pointers, Euler-tour sequence, cluster boundaries), aggregate values against a
  recomputation, and node counts.

## Implementations and complexity

| Operation | `LinkCutTree` | `EulerTourTree` | `TopTree` |
|-----------|---------------|-----------------|-----------|
| `link` / `cut` | O(log n) amortized | O(log n) expected | O(log n) amortized |
| `connected` / `findRoot` | O(log n) amortized | O(log n) expected | O(log n) amortized |
| `evert` / `reroot` | O(log n) amortized | O(log n) expected | O(log n) amortized |
| `lca` | O(log n) amortized | — | O(log n) amortized |
| `pathAggregate` / `pathUpdate` | O(log n) amortized | — | O(log n) amortized |
| `subtreeAggregate` / `treeAggregate` | O(log n) amortized, invertible monoids only | O(log n) expected | O(log n) amortized |
| Space | O(n) | O(n) | O(n) |

Definitions: `n` = number of nodes. The link-cut tree uses splay trees for its
preferred paths, so its bounds are amortized; with globally biased search trees
the same bounds hold worst case. The Euler-tour tree stores each tour in a treap
(Part 12) and so is expected. The top tree is implemented over the link-cut tree
and inherits amortized bounds.

### Notes

- **Link-cut tree:** decomposes each tree into preferred paths, each stored in a
  splay tree ordered by depth; `access(v)` makes the root-to-`v` path preferred.
  Path aggregates are splay-tree aggregates; subtree aggregates require
  "virtual subtree" augmentation and an invertible monoid (for example, sums
  but not minima).
- **Euler-tour tree:** stores the Euler tour of each tree in a balanced
  sequence; `link` and `cut` are sequence splits and joins, which makes it the
  natural structure for subtree aggregates and dynamic connectivity in forests
  (Part 29). It cannot answer path queries.
- **Top tree:** a contraction hierarchy of clusters with a user-defined
  `combine`; it supports both path and subtree queries and non-local operations
  such as tree diameter and center. Implemented over link-cut trees as in
  Tarjan and Werneck.
- Handles are stable integers so values can be stored in parallel typed arrays.

## Example

```js
import { LinkCutTree } from 'ds-app/dynamic-trees';

const forest = new LinkCutTree({
  measure: (w) => w, combine: (a, b) => a + b, identity: 0,
});
const [a, b, c] = [forest.makeNode(1), forest.makeNode(2), forest.makeNode(3)];
forest.link(b, a);
forest.link(c, b);

forest.pathAggregate(a, c); // 6
forest.cut(c);
forest.connected(a, c);     // false
forest.validate();          // true
```

## Conformance checklist

- `link`/`cut`/`connected` are differential-tested against a union-find rebuilt
  from scratch after every operation.
- Path and subtree aggregates match a naive tree walk after random operation
  logs with random reroots.
- `lca` matches a parent-pointer reference.
- Long paths (10^5 nodes) are built and queried without stack overflow.
- `validate()` detects a wrong path-parent pointer and a stale aggregate.
