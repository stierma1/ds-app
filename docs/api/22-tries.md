# Part 22 — Tries

**Module:** `ds-app/tries` · **Source:** `src/tries/` · **Status:** planned

## Scope

String-keyed dictionaries and multi-pattern matchers: standard tries,
compressed/radix tries, Patricia tries, ternary search tries, double-array
tries, Aho-Corasick automata, and longest-prefix matching.

## Common API

```ts
import type { Container } from 'ds-app/core';

export interface Trie<V> extends Container<[string, V]> {
  set(key: string, value: V): this;
  get(key: string): V | undefined;
  has(key: string): boolean;
  delete(key: string): boolean;
  keys(prefix?: string): IterableIterator<string>;
  values(prefix?: string): IterableIterator<V>;
  entries(prefix?: string): IterableIterator<[string, V]>;
  longestPrefix(key: string): [string, V] | undefined;
  startsWith(prefix: string): boolean;
}

export interface MultiPatternIndex<V> {
  add(pattern: string, value: V): this;
  build(): void;
  search(text: string): Array<{ start: number; end: number; value: V }>;
}

export interface TrieOptions {
  alphabet?: 'binary' | 'ascii' | 'unicode';
  caseSensitive?: boolean;
}
```

Shared members come from [`Container`](./00-common-contract.md#container).
Trie keys are strings; `keys(prefix)` yields keys with the given prefix in
lexicographic order. `longestPrefix` finds the longest stored key that is a
prefix of the query string, which is the primitive used by IP routing.

### Semantics

- The empty string is a valid key only if the implementation documents it; the
  default stores it at the root.
- `delete` returns `true` only if a key was removed and prunes nodes that become
  redundant.
- `startsWith` is `O(L)` and does not allocate the matching keys.
- `MultiPatternIndex` must be built after all patterns are added; `search`
  reports overlapping matches, sorted by start position then by pattern length.
- `validate()` checks edge labels, terminal flags, node counts, and (for
  Aho-Corasick) failure links.

## Implementations and complexity

| Implementation | `get` / `set` / `delete` | `keys(prefix)` | `longestPrefix` | Space |
|----------------|--------------------------|----------------|-----------------|-------|
| `StandardTrie` | O(L) | O(L + k) | O(L) | O(total characters · σ) worst |
| `CompressedTrie` | O(L) | O(L + k) | O(L) | O(nodes) |
| `PatriciaTrie` | O(L) | O(L + k) | O(L) | O(nodes) |
| `TernarySearchTrie` | O(L + log n) avg, O(L·σ) worst | O(L + k) | O(L + log n) avg, O(L·σ) worst | O(nodes) |
| `DoubleArrayTrie` | O(L) get, O(L + σ) set/delete | O(L + k) | O(L) | O(nodes + transitions) |
| `AhoCorasick` | — | — | — | O(total pattern length) |

Multi-pattern search:

| Operation | Aho-Corasick |
|-----------|--------------|
| `build` | O(total pattern length · σ), O(total length) with hash transitions |
| `search(text)` | O(\|text\| + matches) |
| `space` | O(total pattern length) |

Definitions: `L` = key length, `k` = reported keys, `σ` = alphabet size, `n` =
number of keys. `keys(prefix)` costs `O(L)` to reach the prefix node plus
`O(k)` to enumerate the subtree; the reported bound `O(L + k)` assumes
lexicographic traversal.

### Notes

- **Standard trie:** one edge per character. Simple and predictable; wasted
  space for long chains.
- **Compressed/radix trie:** collapses single-child chains into edge labels;
  node count is `O(n)` for `n` keys.
- **Patricia trie:** binary radix trie that stores only branching bits; used for
  routing tables and IP prefix matching.
- **Ternary search trie:** each node has left/equal/right children, trading
  alphabet-wide branching for binary-search-like behavior at each position.
- **Double-array trie:** encodes transitions in two integer arrays (`base` and
  `check`) for compact, cache-friendly lookup; insert/delete maintain a free
  list.
- **Aho-Corasick:** builds a trie of patterns and failure links; `search` walks
  the text once and reports all matches, including overlaps.
- **Longest-prefix match:** used by IP router tables; `longestPrefix` walks the
  key and remembers the last terminal node.

## Example

```js
import { StandardTrie, AhoCorasick } from 'ds-app/tries';

const trie = new StandardTrie();
trie.set('car', 1).set('cart', 2).set('cat', 3);

trie.get('cart');              // 2
[...trie.keys('car')];         // ['car', 'cart']
trie.longestPrefix('cartoon'); // ['cart', 2]
trie.validate();               // true

const ac = new AhoCorasick();
ac.add('he', 'he').add('she', 'she').add('hers', 'hers');
ac.build();
ac.search('ushers');           // matches at 1 ('she'), 2 ('he'), 2 ('hers')
```

## Conformance checklist

- Every trie matches a reference `Map` on randomized string keys.
- Shared prefixes, empty strings, and Unicode keys are covered.
- `longestPrefix` is differential-tested against a linear scan of all prefixes.
- Compressed and standard tries return identical key sets and prefixes.
- Aho-Corasick matches a brute-force multi-pattern scan, including overlaps.
- `validate()` detects a missing terminal flag, a broken edge label, and a bad
  failure link.
