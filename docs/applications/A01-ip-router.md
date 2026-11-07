# A1 — IP Router Tables

**Module:** `ds-app/applications/ip-router` · **Status:** planned ·
**Builds on:** Part 22 (tries), Part 26 (rank/select), Part 8 (hash tables)

## Use case

Every packet that enters a router must be forwarded to one next hop, chosen by
the longest routing prefix that matches its destination address. A core router
holds close to a million IPv4 prefixes and a growing IPv6 table, forwards tens
of millions of packets per second, and absorbs thousands of route updates per
second from BGP. The same primitive appears in firewalls, software switches,
and any service that maps addresses to policies by CIDR block.

## Problem

Given a set of prefixes `P = {(bits, length, nextHop)}` over a `W`-bit address
space (`W = 32` or `128`), answer `lookup(address)`: the entry whose prefix is
the longest prefix of `address`. Support `insert(prefix, nextHop)` and
`delete(prefix)` without stopping lookups. Lookup cost is measured in memory
accesses, because each access is a cache miss at this table size.

## How it is solved

Every structure here is a trie over address bits, specialized to trade memory
for fewer accesses per lookup.

1. **Binary trie.** One node per bit. A lookup walks at most `W` nodes and
   remembers the last node that carries a prefix. Updates are local and O(W).
   This is the reference implementation and the master copy that the compact
   structures are rebuilt from.
2. **Path-compressed trie (Patricia).** Chains of single-child nodes are
   collapsed into one node that stores how many bits to skip. The node count
   drops to at most `2|P| − 1` and lookups touch far fewer nodes, at the cost
   of one final comparison against the stored prefix to confirm the skipped
   bits. This is the structure in BSD's routing table.
3. **Multibit trie with controlled prefix expansion.** Each node consumes a
   stride of `k` bits and has `2^k` entries, so a lookup makes at most `W/k`
   accesses. Prefixes whose length is not a multiple of `k` are expanded into
   all the longer prefixes they cover. Leaf pushing moves prefix information
   down so every entry holds either a next hop or a child pointer, halving the
   entry size. A dynamic program chooses variable strides that minimize memory
   for a given access bound. Updates patch the expanded entries from the
   binary master trie.
4. **LC-trie (level compression).** Wherever a subtrie is complete to depth
   `k` (or nearly so, under a fill factor), it is replaced by a single
   `2^k`-way branch; path compression handles the sparse parts. Lookup depth
   is typically four or five nodes for real tables. Updates rebuild the
   affected subtrie.
5. **Lulea-style compressed trie.** Three levels with strides 16, 8, and 8.
   Instead of storing `2^16` pointers, each level stores a bitmap marking
   where the next-hop changes plus a small array of code words; Part 26's
   rank (popcount) turns a bit position into an array index. A full table
   fits in a few hundred kilobytes, which is cache-resident, and a lookup is
   a handful of memory accesses. The price is that updates rebuild a level.

Lookups never block on updates: compact structures are rebuilt in the
background from the binary trie and swapped in atomically.

An opt-in alternative, binary search on prefix lengths, keeps one hash table
(Part 8) per prefix length and binary-searches the lengths with marker
entries, giving `O(log W)` hash probes; it is included because it is the
natural design for IPv6.

## Structures used

| Part | Structure | Role |
|------|-----------|------|
| 22 | `PatriciaTrie`, `StandardTrie` | Master table and path-compressed lookup |
| 22 | multibit, LC, and Lulea tries (defined here) | Compact lookup structures |
| 26 | `RankSelectBitVector` | Popcount indexing for Lulea bitmaps |
| 8 | `HashMap` | Binary search on prefix lengths |

## Complexity summary

| Structure | Lookup (accesses) | Update | Memory |
|-----------|-------------------|--------|--------|
| Binary trie | O(W) | O(W) | O(N·W) nodes worst |
| Patricia | O(W), few nodes in practice | O(W) | O(N) nodes |
| Multibit, stride k | O(W/k) | O(2^k) per affected node | O(N·2^k·W/k) worst |
| LC-trie | O(log-depth), 4-5 typical | rebuild subtrie | O(N) |
| Lulea | constant levels | rebuild level | smallest |

`N` prefixes, `W` address bits.

## Example

```js
import { RoutingTable } from 'ds-app/applications/ip-router';

const table = new RoutingTable({ family: 'ipv4', structure: 'lc-trie' });
table.insert('10.0.0.0/8', 'hopA');
table.insert('10.1.0.0/16', 'hopB');
table.lookup('10.1.2.3');   // 'hopB', the longest match
table.lookup('10.2.0.1');   // 'hopA'
table.lookup('192.0.2.1');  // undefined, no default route
```

## Validation and benchmark data

- Every structure is differential-tested against the binary trie on random
  prefix sets and on a public routing-table snapshot (RouteViews RIB).
- Benchmarks replay a trace of destination addresses and report lookups per
  second and memory per prefix for each structure, plus update throughput
  under a BGP churn trace.
