# A2 — Multi-Dimensional Packet Classification

**Module:** `ds-app/applications/packet-classification` · **Status:** planned ·
**Builds on:** Part 22 (tries), Part 8 (hash tables), Part 24 (bit sets), Part 17 (intervals)

## Use case

Firewalls, access-control lists, quality-of-service queues, and software
switches decide what to do with a packet by matching several header fields at
once: source and destination address, source and destination port, and
protocol. A rule set has thousands to hundreds of thousands of rules, each
with a priority, and the classifier must find the highest-priority rule that
matches every field of a packet at line rate.

## Problem

Each rule specifies, per field, a prefix (addresses), a range (ports), or an
exact value or wildcard (protocol). Given a packet, return the matching rule
of highest priority. Longest-prefix matching (A1) is the one-dimensional case;
in `d` dimensions no structure achieves both fast lookup and small memory in
the worst case, so the structures below are heuristics tuned to the shape of
real rule sets.

## How it is solved

1. **Hierarchical tries.** A trie on the first field; each node that ends a
   prefix points to a trie on the second field holding the rules with that
   prefix, and so on. A lookup must try the second-field trie of every
   first-field ancestor, so it backtracks and costs `O(W^d)`. Set-pruning
   tries copy each rule into the tries of all its ancestors to remove the
   backtracking, at the cost of `O(N^d)` memory in the worst case. The
   grid-of-tries fixes the two-dimensional case with switch pointers that jump
   from a failed second-field search directly into the next ancestor's trie,
   giving `O(2W)` lookups with `O(N·W)` memory.
2. **Tuple space search.** Ranges are expanded to prefixes, and rules are
   grouped by their tuple of prefix lengths. Each tuple owns a hash table
   (Part 8) keyed by the masked fields, so a lookup probes one hash table per
   distinct tuple rather than one per rule. Real rule sets have few distinct
   tuples. Pruning with per-field tries narrows the tuples to probe. Updates
   are a single hash insert or delete, which makes this the structure used
   when rules change often.
3. **Decision trees (HiCuts, HyperCuts).** The `d`-dimensional space is cut
   recursively into equal intervals along one dimension (HiCuts) or several at
   once (HyperCuts); rules that overlap a child are copied into it. The number
   of cuts at each node is chosen by a space-factor heuristic, and recursion
   stops when a node holds at most `binth` rules, which are then scanned
   linearly. HyperCuts adds region compaction and pushes rules shared by all
   children up to the parent to limit replication. Lookups are a short walk
   plus a small linear scan; memory depends heavily on rule overlap.
4. **Bit-vector scheme.** Per field, the rule boundaries split the axis into
   intervals and each interval stores an `N`-bit vector of the rules that
   cover it (Part 24 `BitSet`). A lookup finds the interval in each field by
   binary search and ANDs the `d` vectors; the first set bit is the answer.
   Cost is `O(d·log N + d·N/w)` word operations, which wins for moderate `N`.

All structures share the same rule parser and the same range-to-prefix
expansion, and Part 17's interval index answers the per-field interval
lookups in the bit-vector scheme.

## Structures used

| Part | Structure | Role |
|------|-----------|------|
| 22 | `StandardTrie`, `PatriciaTrie` | Per-field tries, hierarchical and set-pruning tries |
| 8 | `HashMap` | One table per tuple in tuple space search |
| 24 | `BitSet` | Bit-vector scheme |
| 17 | `IntervalTree` | Mapping a field value to its interval |
| 6 | `BinaryHeap` | Choosing cuts by space-factor score |

## Complexity summary

| Structure | Lookup | Update | Memory |
|-----------|--------|--------|--------|
| Hierarchical trie | O(W^d) | O(d·W) | O(N·d·W) |
| Set-pruning trie | O(d·W) | rebuild | O(N^d) worst |
| Grid-of-tries (2D) | O(W) | rebuild | O(N·W) |
| Tuple space | O(tuples) hash probes | O(1) | O(N) |
| HiCuts / HyperCuts | depth + binth scan | partial rebuild | rule-set dependent |
| Bit vector | O(d·log N + d·N/w) | rebuild vectors | O(d·N²/w) bits |

## Example

```js
import { Classifier } from 'ds-app/applications/packet-classification';

const c = new Classifier({ structure: 'hypercuts', binth: 8 });
c.addRule({ priority: 10, src: '10.0.0.0/8', dst: '0.0.0.0/0', sport: [0, 65535], dport: [80, 80], proto: 6, action: 'allow' });
c.addRule({ priority: 1, src: '0.0.0.0/0', dst: '0.0.0.0/0', sport: [0, 65535], dport: [0, 65535], proto: '*', action: 'deny' });
c.build();
c.classify({ src: '10.1.2.3', dst: '198.51.100.7', sport: 40000, dport: 80, proto: 6 }).action; // 'allow'
```

## Validation and benchmark data

- Every structure is differential-tested against a linear scan over all rules
  on random packets and on ClassBench-generated rule sets (access-control,
  firewall, and IP-chain seeds).
- Benchmarks report classifications per second, memory per rule, and build
  time for rule sets from 1k to 100k rules, plus update throughput for tuple
  space search.
