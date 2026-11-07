# Part 28 — Persistent Data Structures

**Module:** `ds-app/persistent` · **Source:** `src/persistent/` · **Status:** planned

## Scope

Structures whose old versions remain readable (partial persistence) or
updatable (full persistence) after changes: structurally shared lists and
deques, path-copied vectors and maps, and fat-node/node-copying versions of the
Part 9 trees. Every persistent operation returns a new structure and leaves the
receiver unchanged.

## Common API

```ts
import type { Comparator, Container } from 'ds-app/core';

export interface PersistentList<T> extends Container<T> {
  push(value: T): PersistentList<T>;
  pop(): PersistentList<T>;
  peek(): T | undefined;
}

export interface PersistentVector<T> extends Container<T> {
  get(index: number): T | undefined;
  set(index: number, value: T): PersistentVector<T>;
  push(value: T): PersistentVector<T>;
  pop(): PersistentVector<T>;
}

export interface PersistentDeque<T> extends Container<T> {
  pushFront(value: T): PersistentDeque<T>;
  pushBack(value: T): PersistentDeque<T>;
  popFront(): PersistentDeque<T>;
  popBack(): PersistentDeque<T>;
  front(): T | undefined;
  back(): T | undefined;
}

export interface PersistentMap<K, V = K> extends Container<[K, V]> {
  readonly compare: Comparator<K>;
  get(key: K): V | undefined;
  has(key: K): boolean;
  set(key: K, value: V): PersistentMap<K, V>;
  delete(key: K): PersistentMap<K, V>;
  min(): [K, V] | undefined;
  max(): [K, V] | undefined;
  range(lo?: K, hi?: K): IterableIterator<[K, V]>;
}

export type VersionId = number;

export interface VersionedMap<K, V = K> {
  readonly compare: Comparator<K>;
  readonly latest: VersionId;
  readonly versionCount: number;
  get(key: K, version?: VersionId): V | undefined;
  set(key: K, value: V, from?: VersionId): VersionId;
  delete(key: K, from?: VersionId): VersionId;
  size(version?: VersionId): number;
  entries(version?: VersionId): IterableIterator<[K, V]>;
  validate(): true | string;
}
```

`PersistentList`, `PersistentVector`, `PersistentDeque`, and `PersistentMap`
are immutable values that implement `Container` for reading. `VersionedMap`
is the fat-node/node-copying family: one object holds every version, addressed
by `VersionId`.

### Semantics

- Immutable structures never mutate: `set`, `push`, `pop`, and `delete` return
  a new structure that shares unchanged parts with the receiver. `clear()` from
  `Container` throws `UnsupportedError`; use an empty instance instead.
- Popping an empty persistent structure returns the same empty structure.
- `VersionedMap.set(key, value, from)` creates a new version derived from
  `from` (default `latest`) and returns its id. Partially persistent
  implementations accept only `from === latest` and throw `UnsupportedError`
  otherwise; fully persistent implementations accept any version.
- Versions are never deleted; `versionCount` only grows.
- `validate()` checks sharing invariants, per-version size, and (for versioned
  maps) the version list and fat-node timestamps.

## Implementations and complexity

| Structure | Technique | Update | Read | Extra space per update |
|-----------|-----------|--------|------|------------------------|
| `PersistentList` | shared cons cells | O(1) | `peek` O(1), `get(i)` O(i) | O(1) |
| `PersistentVector` | path copying in a 32-ary trie | O(log₃₂ n) | O(log₃₂ n) | O(log₃₂ n) nodes |
| `PersistentDeque` | real-time deque (Okasaki) | O(1) | O(1) | O(1) |
| `PersistentMap` | path-copied red-black tree or treap | O(log n) | O(log n) | O(log n) nodes |
| `PartiallyPersistentMap` | node copying with one spare pointer field (Driscoll, Sarnak, Sleator, Tarjan) | O(log n) amortized | O(log n) at any version | O(1) amortized |
| `FullyPersistentMap` | node copying plus a version list (Part 1 `OrderMaintenanceList`) | O(log n) amortized | O(log n) at any version | O(1) amortized |

Definitions: `n` elements in the version being updated. All bounds are worst
case unless marked amortized.

### Notes

- **Shared lists and deques:** the simplest persistence; Okasaki's real-time
  deque keeps front and rear streams balanced with scheduled rotations so every
  operation is O(1) worst case.
- **Path copying:** copies the O(log n) nodes on the root-to-leaf path; old
  versions stay reachable from their old roots and are garbage-collected when
  unreferenced.
- **Node copying:** each node has one spare modification slot stamped with a
  version; when it fills, the node is copied and the parent updated. This
  gives O(1) amortized space per update for partial persistence.
- **Full persistence:** versions form a tree; an order-maintenance list
  linearizes it so that version comparisons are O(1).
- Confluent persistence (merging versions) is out of scope.

## Example

```js
import { PersistentMap, PartiallyPersistentMap } from 'ds-app/persistent';

const v0 = PersistentMap.empty((a, b) => a - b);
const v1 = v0.set(1, 'one');
const v2 = v1.set(2, 'two');
v1.has(2); // false
v2.has(2); // true

const history = new PartiallyPersistentMap((a, b) => a.localeCompare(b));
const t1 = history.set('x', 1);
const t2 = history.set('x', 2);
history.get('x', t1); // 1
history.get('x', t2); // 2
history.validate();   // true
```

## Conformance checklist

- Every version is compared against a snapshot of a reference `Map` taken when
  that version was created, after random update sequences.
- Old versions remain readable and unchanged after later updates.
- Fully persistent maps are tested with updates branching from old versions.
- Space per update is measured to confirm the documented bound.
- `validate()` detects a stale fat-node timestamp and a broken version list.
