# Part 38 — Online Dictionary Structures

**Module:** `ds-app/online-dictionaries` · **Source:** `src/online-dictionaries/` · **Status:** planned

## Scope

Ordered dictionaries over variable-length string keys whose per-operation cost
is linear in the key length plus logarithmic in the number of keys, with
online insertion and deletion: balanced trees augmented with
longest-common-prefix information and the string B-tree. Tries (Part 22) cost
`O(L)` per operation but `O(σ)` space per node; these structures give
`O(L + log n)` with `O(n)` nodes and comparison-based ordering.

## Common API

```ts
import type { OrderedMap } from 'ds-app/core';

export interface StringDictionary<V = string> extends OrderedMap<string, V> {
  longestPrefix(key: string): [string, V] | undefined;
  prefixRange(prefix: string): IterableIterator<[string, V]>;
  lcp(a: string, b: string): number;
}

export interface StringDictionaryOptions {
  collation?: 'codeunit' | 'codepoint';
}
```

Shared members come from
[`OrderedMap`](./00-common-contract.md#ordered-map--ordered-set) with the key
type fixed to `string` and lexicographic order by code unit (or code point).

### Semantics

- Keys are compared lexicographically; the comparator is fixed and `compare`
  is exposed for conformance.
- `prefixRange(p)` iterates the keys with prefix `p` in order; the upper bound
  is computed correctly for any prefix, including one ending in the maximum
  code unit.
- `lcp(a, b)` returns the longest common prefix length of two stored keys in
  `O(log n)` using the augmented tree, not by scanning the strings; a missing
  key throws `RangeError`.
- `at`/`indexOf` are supported through subtree sizes.
- `validate()` checks key order, stored LCP values against direct computation,
  and balance.

## Implementations and complexity

| Operation | `LcpTree` (balanced tree + LCP) | `StringBTree` (Part 34 block store) |
|-----------|---------------------------------|-------------------------------------|
| `get` / `has` | O(L + log n) | O(log_B n + L/B) transfers |
| `set` / `delete` | O(L + log n) | O(log_B n + L/B) transfers |
| `predecessor` / `successor` | O(L + log n) | O(log_B n + L/B) transfers |
| `prefixRange` | O(L + log n + total output length) | O(log_B n + (L + output)/B) transfers |
| `longestPrefix` | O(L + log n) | O(log_B n + L/B) transfers |
| `lcp` of stored keys | O(log n) | O(log_B n) transfers |
| Space | O(n) nodes plus key storage | O(n/B) blocks plus key storage |

Definitions: `n` keys, `L` query key length, `B` block size. A plain balanced
tree costs `O(L log n)` because every comparison may scan the whole key; the
LCP augmentation ensures each character of the query is compared a constant
number of times per search.

### Notes

- **LCP tree:** a red-black tree (Part 9) where each node stores the LCP of
  its key with its in-order predecessor and successor; the search carries the
  current match length and skips already-matched characters, the same
  technique that suffix-array search uses with LCP information.
- **String B-tree:** Ferragina and Grossi's structure stores a Patricia trie
  (Part 22) in each node over that node's keys, so a node is traversed in
  `O(1)` transfers plus one key access; it is the external-memory analogue.
- Both structures compose Part 9 or Part 14 with Part 22 rather than
  introducing new balancing rules.

## Example

```js
import { LcpTree } from 'ds-app/online-dictionaries';

const dict = new LcpTree();
dict.set('interval', 1).set('internal', 2).set('internet', 3).set('trie', 4);

[...dict.prefixRange('inter')].map(([k]) => k); // ['internal', 'internet', 'interval']
dict.longestPrefix('internetworking');           // ['internet', 3]
dict.lcp('internal', 'internet');                // 6
dict.validate();                                 // true
```

## Conformance checklist

- Passes the ordered-map conformance suite with string keys.
- Character comparisons are counted to confirm `O(L + log n)` on long keys
  with long shared prefixes.
- `prefixRange` and `longestPrefix` match a filtered scan, including the empty
  prefix and prefixes ending in a surrogate half.
- String B-tree transfer counts are checked against the documented bound.
- `validate()` detects a wrong stored LCP.
