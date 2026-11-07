# A15 — Caching and Discrete-Event Simulation

**Module:** `ds-app/applications/caching-simulation` · **Status:** planned ·
**Builds on:** Part 8 (hash tables), Part 1 (lists), Part 6 (timer queues), Part 12 (seeded PRNG)

## Use case

Two everyday systems problems that are pure data-structure composition.
Caches decide which items to keep in limited memory so that most requests
hit; every database buffer pool, CDN, and application memoizer runs one.
Discrete-event simulation advances a model (a queueing network, a protocol,
a factory) from event to event in time order; the event list is its
bottleneck, and the same structure manages timeouts in network stacks and
runtimes.

## Problem

Caching: for a stream of key requests and a capacity `C`, serve each request
in O(1) and choose the eviction victim so that the hit rate is high across
workloads that are recency-biased, frequency-biased, or scan-heavy.
Simulation: schedule future events, cancel some of them, and repeatedly
extract the earliest, with event counts in the millions and highly skewed
time distributions.

## How it is solved

### Caches

1. **LRU.** A Part 8 hash map from key to a node in a Part 1 doubly linked
   list ordered by recency. A hit unlinks the node and moves it to the front;
   an insert at capacity evicts the tail. All operations are O(1). It is the
   default but is defeated by a scan longer than the cache.
2. **LFU.** A hash map from key to node, where nodes live in per-frequency
   lists kept in a list of frequencies; incrementing a key moves its node to
   the next frequency's list, creating it if needed, and eviction takes the
   least recent node of the lowest frequency. O(1) per operation. It resists
   scans but adapts slowly when popularity shifts, so an aging step decays
   counts periodically.
3. **ARC.** Two LRU lists, `T1` for items seen once and `T2` for items seen
   at least twice, plus two ghost lists `B1` and `B2` holding only the keys
   recently evicted from each. A hit in a ghost list reveals which side would
   have benefited from more space and moves the target size `p` toward it,
   so the cache adapts between recency and frequency without tuning.
4. **CLOCK.** A ring buffer (Part 1 `ArrayDeque`) with one reference bit per
   slot and a hand; a hit sets the bit, and eviction advances the hand,
   clearing set bits until it finds a clear one. It approximates LRU without
   moving list nodes on every hit, which is why operating systems use it for
   page replacement. CLOCK-Pro adds the frequency awareness of ARC.
5. **Trace replay.** All policies share a harness that replays a request
   trace and reports hit rate per capacity, which is how a policy is chosen
   for a workload.

### Discrete-event simulation

6. **Event list.** Events are (time, payload) pairs in a Part 6 `TimerQueue`.
   The calendar queue buckets events by time modulo a year and resizes its
   buckets from the observed density, giving O(1) amortized schedule and
   extract for the smoothly distributed event times that queueing models
   produce. The hierarchical timing wheel serves timeout-heavy workloads
   where most events are cancelled before they fire: scheduling and
   cancelling are O(1) and only events that survive are cascaded between
   wheels. A binary heap is kept as the reference.
7. **Simulation kernel.** A loop extracts the next event, advances the clock,
   runs the handler, which schedules further events; Part 12's seeded PRNG
   drives stochastic arrivals and service times so runs are reproducible.
   Processes with waits are modeled as generators resumed by events.
   Statistics (queue length over time, utilization, waiting time) are
   collected by time-weighted accumulators.

## Structures used

| Part | Structure | Role |
|------|-----------|------|
| 8 | `HashMap` | Key lookup in every cache |
| 1 | `DoublyLinkedList`, `ArrayDeque` | Recency lists, CLOCK ring |
| 6 | `CalendarQueue`, `TimingWheel`, `BinaryHeap` | Event list |
| 12 | seeded PRNG | Reproducible stochastic simulation |

## Complexity summary

| Component | Cost |
|-----------|------|
| LRU / LFU / ARC / CLOCK | O(1) per request |
| Calendar queue | O(1) amortized schedule and extract |
| Timing wheel | O(1) schedule and cancel; O(levels) per cascade |
| Simulation step | O(event list operation + handler) |

## Example

```js
import { LRUCache, ARCCache, Simulation } from 'ds-app/applications/caching-simulation';

const cache = new ARCCache({ capacity: 1000 });
cache.get('k') ?? cache.set('k', compute('k'));
cache.stats().hitRate;

const sim = new Simulation({ eventList: 'calendar-queue', seed: 7 });
sim.schedule(0, () => arrival(sim));           // M/M/1 queue model
sim.run({ until: 1e6 });
sim.stats('queueLength').mean;                 // compare with ρ / (1 − ρ)
```

## Validation and benchmark data

- Caches are checked against a reference implementation on synthetic and
  recorded traces; hit rates for ARC and LRU reproduce published curves on
  the standard ARC traces.
- Event lists deliver events in time order against a heap reference; the
  M/M/1 and M/M/c models reproduce analytic queue lengths within confidence
  intervals.
- Benchmarks report requests per second per cache policy and events per
  second per event list under smooth, bursty, and cancellation-heavy
  schedules.
