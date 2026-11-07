# Part 31 — Kinetic Data Structures

**Module:** `ds-app/kinetic` · **Source:** `src/kinetic/` · **Status:** planned

## Scope

Structures over continuously moving points that maintain a combinatorial
attribute (sorted order, maximum, convex hull) by processing certificate
failures as events: the kinetic sorted list, kinetic tournament, kinetic heap,
and kinetic convex hull. Motion is given as polynomial trajectories; the
structure advances time and stays correct between events.

## Common API

```ts
export type Trajectory = readonly number[];   // polynomial coefficients, low degree first

export interface KineticOptions {
  dimensions: number;
  degree?: number;        // maximum trajectory degree, default 1
  epsilon?: number;       // root-finding tolerance
}

export interface KineticStructure<T> {
  readonly now: number;
  readonly size: number;
  readonly pendingEvents: number;
  readonly processedEvents: number;
  insert(value: T, trajectory: Trajectory[]): number;
  delete(id: number): boolean;
  setTrajectory(id: number, trajectory: Trajectory[]): void;
  positionAt(id: number, t: number): number[];
  advance(t: number): number;
  nextEventTime(): number;
  validate(): true | string;
}

export interface KineticSortedList<T> extends KineticStructure<T> {
  order(): number[];
}

export interface KineticMaximum<T> extends KineticStructure<T> {
  max(): number | undefined;
}

export interface KineticConvexHull<T> extends KineticStructure<T> {
  hull(): number[];
}
```

Kinetic structures are handle-based and not `Container`s; `insert` returns an
id and `size` counts live objects. `advance(t)` processes every event with time
in `(now, t]` and returns how many it processed.

### Semantics

- Each object has one trajectory per dimension; `setTrajectory` (a flight-plan
  update) applies at the current time and reschedules the affected
  certificates.
- Time never moves backwards; `advance(t)` with `t < now` throws `RangeError`.
- Queries (`order`, `max`, `hull`) are answered for `now` and are exact
  between events.
- Simultaneous events are processed in a deterministic order (by id).
- `validate()` recomputes every certificate at `now` and checks the event queue
  against them.

## Implementations and complexity

| Structure | Events (linear motion) | Per event | Query | Space |
|-----------|------------------------|-----------|-------|-------|
| `KineticSortedList` | O(n²) | O(log n) | `order` O(n) | O(n) |
| `KineticTournament` | O(n log n) | O(log² n) | `max` O(1) | O(n) |
| `KineticHeap` | O(n log n) | O(log n) | `max` O(1) | O(n) |
| `KineticConvexHull` (2D) | O(n^{2+ε}) | O(log² n) | `hull` O(h) | O(n log n) |

Definitions: `n` moving objects, `h` hull size, `ε > 0` arbitrary. Event counts
assume linear motion; for degree-`s` polynomial motion they are bounded by
Davenport-Schinzel sequences `λ_s(n)` in place of `n`. Certificates are stored
in a binary heap keyed by failure time, so each certificate change is
O(log n).

### Notes

- A kinetic structure is judged by four measures: **responsiveness** (cost per
  event), **efficiency** (events processed versus changes in the attribute),
  **locality** (certificates per object), and **compactness** (total
  certificates). The table gives responsiveness and efficiency.
- **Kinetic sorted list:** one certificate per adjacent pair; an event swaps
  two neighbors and reschedules at most three certificates.
- **Kinetic tournament:** a balanced bracket of pairwise comparisons; an event
  re-plays one root-to-leaf path.
- **Kinetic heap:** a heap-ordered tree whose certificates are parent-child
  comparisons; its event count matches the tournament for linear motion.
- **Kinetic convex hull:** the structure of Basch, Guibas, and Hershberger,
  built on kinetic tournaments over the dual envelope.
- Event times are roots of polynomial differences; the solver uses closed forms
  for degree 1 and 2 and bracketed Newton iteration above that.

## Example

```js
import { KineticSortedList } from 'ds-app/kinetic';

const list = new KineticSortedList({ dimensions: 1 });
const a = list.insert('a', [[0, 1]]);   // x = 0 + 1·t
const b = list.insert('b', [[5, -1]]);  // x = 5 - 1·t

list.order();         // [a, b]
list.nextEventTime(); // 2.5
list.advance(3);      // 1 event processed
list.order();         // [b, a]
list.validate();      // true
```

## Conformance checklist

- The maintained attribute matches a from-scratch computation at every event
  time and at random times between events.
- Event counts for random linear motion stay within the documented bounds.
- Flight-plan updates reschedule certificates correctly.
- Simultaneous and degenerate events (equal positions, tangent trajectories)
  are handled without duplicate processing.
- `validate()` detects a stale certificate and a missing event.
