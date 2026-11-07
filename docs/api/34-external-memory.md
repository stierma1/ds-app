# Part 34 — External-Memory Data Structures

**Module:** `ds-app/external-memory` · **Source:** `src/external-memory/` · **Status:** planned

## Scope

Structures analyzed in the I/O model, where cost is the number of block
transfers between a memory of `M` elements and storage read in blocks of `B`:
the buffer tree, external priority queue, external interval tree, external
priority search tree, and external sorting. Unlike Part 30, `B` and `M` are
known and tuned. Part 14 B-trees and Part 20 R-trees run over the same block
store.

## Common API

```ts
import type { Comparator } from 'ds-app/core';

export interface BlockStore {
  readonly blockSize: number;        // B, in elements
  readonly memorySize: number;       // M, in elements
  readonly reads: number;
  readonly writes: number;
  allocate(): number;
  read(block: number): ArrayBuffer;
  write(block: number, data: ArrayBuffer): void;
  free(block: number): void;
}

export interface ExternalOptions {
  store: BlockStore;
}

export interface BufferTree<K, V = K> {
  readonly size: number;
  readonly compare: Comparator<K>;
  insert(key: K, value: V): void;
  delete(key: K): void;
  query(key: K): Promise<V | undefined>;
  rangeQuery(lo: K, hi: K): Promise<Array<[K, V]>>;
  flush(): void;
  validate(): true | string;
}

export interface ExternalPriorityQueue<T> {
  readonly size: number;
  push(value: T): void;
  pop(): T | undefined;
  peek(): T | undefined;
  validate(): true | string;
}

export interface ExternalIntervalIndex<T> {
  readonly size: number;
  insert(lo: number, hi: number, value: T): void;
  delete(lo: number, hi: number, value?: T): boolean;
  stab(point: number): T[];
  validate(): true | string;
}

export function externalSort<T>(values: Iterable<T>, compare: Comparator<T>, options: ExternalOptions): Iterable<T>;
```

External structures are not `Container`s: enumerating them is itself an
external operation. Each exposes `size` and `validate()`.

### Semantics

- A `BlockStore` is in-memory by default (`MemoryBlockStore`) and counts
  transfers; other stores (file-backed, IndexedDB) implement the same
  interface. Bounds are in transfers against that store.
- Buffer-tree operations are batched: updates are buffered and `query` results
  are delivered when the buffer that holds them is emptied, which is why query
  methods return a promise. `flush()` empties every buffer.
- `ExternalPriorityQueue.pop` is synchronous and amortizes buffer emptying over
  operations.
- `validate()` flushes, then checks tree invariants and that buffered
  operations were applied in order.

## Implementations and complexity

Bounds are block transfers.

| Structure | Update | Query | Range of k | Space (blocks) |
|-----------|--------|-------|------------|----------------|
| `BufferTree` | O((1/B) log_{M/B}(n/B)) amortized | O((1/B) log_{M/B}(n/B)) amortized, batched | O((1/B) log_{M/B}(n/B) + k/B) amortized | O(n/B) |
| `ExternalPriorityQueue` | `push` O((1/B) log_{M/B}(n/B)) amortized | `pop` O((1/B) log_{M/B}(n/B)) amortized | — | O(n/B) |
| `ExternalIntervalTree` | O(log_B n) amortized | `stab` O(log_B n + k/B) | — | O(n/B) |
| `ExternalPrioritySearchTree` | O(log_B n) amortized | three-sided O(log_B n + k/B) | — | O(n/B) |
| `externalSort` | — | — | O((n/B) log_{M/B}(n/B)) total | O(n/B) |
| B-tree (Part 14) over a `BlockStore` | O(log_B n) | O(log_B n) | O(log_B n + k/B) | O(n/B) |

Definitions: `n` elements, `k` reported elements, `B` block size, `M` memory
size in elements, with `M ≥ 2B`. The buffer-tree bounds are optimal for batched
workloads and match sorting; the B-tree bounds are optimal for online queries.

### Notes

- **Buffer tree:** an `(M/B)`-ary tree whose nodes carry buffers of `M`
  pending operations; a full buffer is pushed one level down in O(M/B)
  transfers, so each operation pays O(1/B) per level.
- **External priority queue:** a buffer tree with lazy deletion of the minimum;
  it achieves the sorting bound.
- **External interval tree:** a weight-balanced base tree of fan-out
  `Θ(√B)` with slab lists in blocked arrays (Arge and Vitter); updates stay
  logarithmic through global rebuilding.
- **External priority search tree:** the three-sided-query analogue with child
  caches (Arge, Samoladas, and Vitter).
- **External sort:** multiway merge sort with `M/B`-way merges and
  double-buffered runs.
- The in-memory block store makes every bound measurable in tests by reading
  `reads` and `writes`.

## Example

```js
import { MemoryBlockStore, BufferTree } from 'ds-app/external-memory';

const store = new MemoryBlockStore({ blockSize: 64, memorySize: 4096 });
const tree = new BufferTree((a, b) => a - b, { store });
for (let i = 0; i < 100000; i++) tree.insert(i, i * 2);

const value = await tree.query(500);  // 1000, once the batch flushes
store.reads;                          // far fewer than 100000
tree.validate();                      // true
```

## Conformance checklist

- Results match in-memory references after every `flush()`.
- Transfer counts scale as documented when `B` and `M` are varied.
- Buffered operations on the same key are applied in insertion order.
- External sort matches `Array.prototype.sort` on inputs larger than `M`.
- `validate()` detects an out-of-order buffer and an underfull node.
