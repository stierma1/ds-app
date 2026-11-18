import {
  assertDefined,
  assertInteger,
  ContainerBase,
  resolveComparator,
  resolveRandomSource,
} from "../core/index.ts";
import type {
  Comparator,
  RandomSource,
  RangeOptions,
} from "../core/index.ts";
import { readRandomizedEntries, serializeRandomizedEntries } from "./serialization.ts";
import { readRangeOptions } from "./tree-base.ts";
import type { RandomizedMap, RandomOptions } from "./types.ts";

/** Maximum level count; with p = 1/2 this supports about 2^32 nodes before levels saturate. */
const MAX_LEVEL = 32;
const LEVEL_PROBABILITY = 0.5;

/**
 * Skip-list node. `forward[i]` is the next node at level i; `span[i]` is the number of bottom-level
 * nodes crossed by that link, which makes rank/select possible without scanning.
 */
class SkipNode<K, V> {
  key: K;
  value: V;
  forward: Array<SkipNode<K, V> | null>;
  span: number[];

  constructor(key: K, value: V, level: number) {
    this.key = key;
    this.value = value;
    this.forward = new Array<SkipNode<K, V> | null>(level + 1).fill(null);
    this.span = new Array<number>(level + 1).fill(0);
  }
}

/**
 * Skip list: a hierarchy of linked lists with geometrically distributed levels. Every node is
 * present on level 0; a node is promoted to level i+1 with probability 1/2, so search, insert, and
 * delete are O(log n) expected and O(n) worst case. The span stored on every forward pointer keeps
 * `at` and `indexOf` at O(log n) expected.
 *
 * Insertion/update and deletion consume the constructor's `rng`; the same seed and operation
 * sequence produce the same levels and therefore the same internal shape. Levels and spans are not
 * serialized.
 *
 * `validate()` checks key order on every level, level membership, every span against bottom-level
 * ranks, the tail pointer, and the node count. It does not require any balance beyond structural
 * consistency.
 */
export class SkipList<K, V = K>
  extends ContainerBase<[K, V]>
  implements RandomizedMap<K, V>
{
  readonly compare: Comparator<K>;
  readonly rng: RandomSource;
  private readonly _head: SkipNode<K, V>;
  private _tail: SkipNode<K, V> | null = null;
  private _level = 0;

  /** O(1); `compare` defaults to natural order and `rng` defaults to a CSPRNG seed. */
  constructor(compare?: Comparator<K>, options?: RandomOptions) {
    super();
    this.compare = resolveComparator(compare);
    this.rng = resolveRandomSource(options?.rng);
    this._head = new SkipNode<K, V>(
      undefined as unknown as K,
      undefined as unknown as V,
      MAX_LEVEL - 1,
    );
  }

  /** O(1): highest active level index; 0 when the list is empty. */
  get level(): number {
    return this._level;
  }

  /** O(1): number of active levels; 0 when empty. */
  get height(): number {
    return this._size === 0 ? 0 : this._level + 1;
  }

  /** O(log n) expected: replaces an existing value or inserts a new key at a random level. */
  set(key: K, value: V): this {
    assertDefined(key, "key");
    assertDefined(value, "value");
    const update = new Array<SkipNode<K, V>>(MAX_LEVEL).fill(this._head);
    const rank = new Array<number>(MAX_LEVEL).fill(0);
    let node = this._head;
    for (let level = this._level; level >= 0; level--) {
      rank[level] = level === this._level ? -1 : (rank[level + 1] as number);
      let next = node.forward[level];
      while (
        next !== null &&
        this.compare((next as SkipNode<K, V>).key, key) < 0
      ) {
        rank[level] = (rank[level] as number) + (node.span[level] as number);
        node = next as SkipNode<K, V>;
        next = node.forward[level];
      }
      update[level] = node;
    }

    const next = node.forward[0];
    if (next !== null && this.compare(next.key, key) === 0) {
      next.value = value;
      this.touch();
      return this;
    }

    let newLevel = 0;
    while (
      newLevel < MAX_LEVEL - 1 &&
      this.nextRandom() < LEVEL_PROBABILITY
    ) {
      newLevel++;
    }

    const previousLevel = this._level;
    if (newLevel > previousLevel) {
      for (let level = previousLevel + 1; level <= newLevel; level++) {
        update[level] = this._head;
        rank[level] = -1;
      }
    }

    const insertIndex = (rank[0] as number) + 1;
    const fresh = new SkipNode<K, V>(key, value, newLevel);
    for (let level = 0; level <= newLevel; level++) {
      const previous = update[level] as SkipNode<K, V>;
      const follow = previous.forward[level];
      const distance = insertIndex - (rank[level] as number);
      fresh.forward[level] = follow;
      if (follow === null) {
        fresh.span[level] = 0;
      } else {
        fresh.span[level] = (previous.span[level] as number) - distance + 1;
      }
      previous.span[level] = distance;
      previous.forward[level] = fresh;
    }
    for (let level = newLevel + 1; level <= previousLevel; level++) {
      const previous = update[level] as SkipNode<K, V>;
      if (previous.forward[level] !== null) {
        previous.span[level] = (previous.span[level] as number) + 1;
      }
    }
    if (newLevel > previousLevel) {
      this._level = newLevel;
    }

    this._size++;
    if (this._tail === null || this.compare(fresh.key, this._tail.key) > 0) {
      this._tail = fresh;
    }
    this.touch();
    return this;
  }

  /** O(log n) expected: the value for `key`, or undefined when absent. */
  get(key: K): V | undefined {
    assertDefined(key, "key");
    let node = this._head;
    for (let level = this._level; level >= 0; level--) {
      let next = node.forward[level];
      while (next !== null && this.compare(next.key, key) < 0) {
        node = next;
        next = node.forward[level];
      }
    }
    const next = node.forward[0];
    return next !== null && this.compare(next.key, key) === 0
      ? next.value
      : undefined;
  }

  /** O(log n) expected: membership test. */
  has(key: K): boolean {
    assertDefined(key, "key");
    let node = this._head;
    for (let level = this._level; level >= 0; level--) {
      let next = node.forward[level];
      while (next !== null && this.compare(next.key, key) < 0) {
        node = next;
        next = node.forward[level];
      }
    }
    const next = node.forward[0];
    return next !== null && this.compare(next.key, key) === 0;
  }

  /** O(log n) expected: unlinks the key from every level that contains it. */
  delete(key: K): boolean {
    assertDefined(key, "key");
    const update = new Array<SkipNode<K, V>>(MAX_LEVEL).fill(this._head);
    let node = this._head;
    for (let level = this._level; level >= 0; level--) {
      let next = node.forward[level];
      while (next !== null && this.compare(next.key, key) < 0) {
        node = next;
        next = node.forward[level];
      }
      update[level] = node;
    }

    const target = (update[0] as SkipNode<K, V>).forward[0];
    if (target === null || this.compare(target.key, key) !== 0) {
      return false;
    }
    for (let level = 0; level <= this._level; level++) {
      const previous = update[level] as SkipNode<K, V>;
      if (previous.forward[level] === target) {
        const follow = target.forward[level];
        previous.forward[level] = follow;
        previous.span[level] =
          follow === null
            ? 0
            : (previous.span[level] as number) +
              (target.span[level] as number) -
              1;
      } else if (previous.forward[level] !== null) {
        previous.span[level] = (previous.span[level] as number) - 1;
      }
    }

    this._size--;
    if (this._tail === target) {
      this._tail =
        (update[0] as SkipNode<K, V>) === this._head
          ? null
          : (update[0] as SkipNode<K, V>);
    }
    while (this._level > 0 && this._head.forward[this._level] === null) {
      this._level--;
    }
    this.touch();
    return true;
  }

  /** O(1): the smallest entry. */
  min(): [K, V] | undefined {
    const node = this._head.forward[0];
    return node === null ? undefined : [node.key, node.value];
  }

  /** O(1): the largest entry, tracked as a bottom-level tail pointer. */
  max(): [K, V] | undefined {
    return this._tail === null
      ? undefined
      : [this._tail.key, this._tail.value];
  }

  /** O(log n) expected: largest entry strictly less than `key`. */
  predecessor(key: K): [K, V] | undefined {
    assertDefined(key, "key");
    const node = this.predecessorNode(key);
    return node === this._head || node === null
      ? undefined
      : [node.key, node.value];
  }

  /** O(log n) expected: smallest entry strictly greater than `key`. */
  successor(key: K): [K, V] | undefined {
    assertDefined(key, "key");
    let node = this._head;
    for (let level = this._level; level >= 0; level--) {
      let next = node.forward[level];
      while (next !== null && this.compare(next.key, key) <= 0) {
        node = next;
        next = node.forward[level];
      }
    }
    const next = node.forward[0];
    return next === null ? undefined : [next.key, next.value];
  }

  /** O(log n) expected: select by rank using the level spans. */
  at(index: number): [K, V] | undefined {
    assertInteger(index);
    if (index < 0 || index >= this._size) {
      return undefined;
    }
    let node = this._head;
    let remaining = index + 1;
    for (let level = this._level; level >= 0; level--) {
      let next = node.forward[level];
      while (
        next !== null &&
        (node.span[level] as number) <= remaining
      ) {
        remaining -= node.span[level] as number;
        node = next;
        next = node.forward[level];
      }
    }
    return [node.key, node.value];
  }

  /** O(log n) expected: rank through the level spans; -1 when absent. */
  indexOf(key: K): number {
    assertDefined(key, "key");
    let node = this._head;
    let index = -1;
    for (let level = this._level; level >= 0; level--) {
      let next = node.forward[level];
      while (next !== null && this.compare(next.key, key) < 0) {
        index += node.span[level] as number;
        node = next;
        next = node.forward[level];
      }
    }
    const next = node.forward[0];
    return next !== null && this.compare(next.key, key) === 0
      ? index + (node.span[0] as number)
      : -1;
  }

  /**
   * O(log n + k) expected: finds the lower bound on level 0, then materializes k bottom-level
   * entries. Mutating the list invalidates the snapshot iterator.
   */
  range(lo?: K, hi?: K, options?: RangeOptions<K>): IterableIterator<[K, V]> {
    const { loInclusive, hiInclusive } = readRangeOptions(options);
    const entries: Array<[K, V]> = [];
    if (lo !== undefined && hi !== undefined && this.compare(lo, hi) > 0) {
      return this.snapshotIterator(entries);
    }

    let node = this._head;
    if (lo !== undefined) {
      for (let level = this._level; level >= 0; level--) {
        let next = node.forward[level];
        while (next !== null && this.compare(next.key, lo) < 0) {
          node = next;
          next = node.forward[level];
        }
      }
    }
    let current = node.forward[0];
    if (
      current !== null &&
      lo !== undefined &&
      !loInclusive &&
      this.compare(current.key, lo) === 0
    ) {
      current = current.forward[0];
    }
    while (current !== null) {
      if (hi !== undefined) {
        const comparison = this.compare(current.key, hi);
        if (comparison > 0 || (comparison === 0 && !hiInclusive)) {
          break;
        }
      }
      entries.push([current.key, current.value]);
      current = current.forward[0];
    }
    return this.snapshotIterator(entries);
  }

  /** O(n): bottom-level snapshot of the keys. */
  keys(): IterableIterator<K> {
    return this.snapshotIterator(this.toArray().map((entry) => entry[0]));
  }

  /** O(n): bottom-level snapshot of the values. */
  values(): IterableIterator<V> {
    return this.snapshotIterator(this.toArray().map((entry) => entry[1]));
  }

  /** O(n): bottom-level snapshot iterator. */
  entries(): IterableIterator<[K, V]> {
    return this.snapshotIterator(this.toArray());
  }

  /** O(n): bottom-level walk into one fresh array. */
  override toArray(): Array<[K, V]> {
    const entries: Array<[K, V]> = [];
    let node = this._head.forward[0];
    while (node !== null) {
      entries.push([node.key, node.value]);
      node = node.forward[0];
    }
    return entries;
  }

  /** Same as entries(): materialized O(n) bottom-level snapshot. */
  override [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }

  /** O(1): clears every level and invalidates live snapshot iterators. */
  override clear(): void {
    for (let level = 0; level < MAX_LEVEL; level++) {
      this._head.forward[level] = null;
      this._head.span[level] = 0;
    }
    this._tail = null;
    this._level = 0;
    this._size = 0;
    this.touch();
  }

  /** O(n): sorted entry list; levels, spans, and RNG state are not serialized. */
  serialize(): string {
    return serializeRandomizedEntries("SkipList", this.toArray());
  }

  /** O(n log n) expected: rebuilds by inserting the sorted entries with fresh levels. */
  static deserialize<K, V>(
    json: unknown,
    compare?: Comparator<K>,
    options?: RandomOptions,
  ): SkipList<K, V> {
    const entries = readRandomizedEntries<K, V>(json, "SkipList");
    const list = new SkipList<K, V>(compare, options);
    for (const [key, value] of entries) {
      list.set(key, value);
    }
    return list;
  }

  /**
   * O(n + MAX_LEVEL): checks bottom-level order and count, then every level's order, membership,
   * spans, and null-pointer spans, plus the tail pointer and active level count.
   */
  override validate(): true | string {
    if (this._size === 0) {
      for (let level = 0; level < MAX_LEVEL; level++) {
        if (this._head.forward[level] !== null) {
          return "empty skip list still has bottom-level nodes";
        }
        if (this._head.span[level] !== 0) {
          return "empty skip list has a non-zero span";
        }
      }
      if (this._tail !== null) {
        return "empty skip list still has a tail";
      }
      if (this._level !== 0) {
        return "empty skip list has an active level";
      }
      return true;
    }
    if (this._tail === null) {
      return "non-empty skip list has no tail";
    }

    const indices = new Map<SkipNode<K, V>, number>();
    let node = this._head.forward[0];
    let index = 0;
    let previous: SkipNode<K, V> | null = null;
    while (node !== null) {
      if (node.key === undefined || node.value === undefined) {
        return `node at index ${index} has an undefined key or value`;
      }
      if (previous !== null && this.compare(previous.key, node.key) >= 0) {
        return "skip list ordering is violated";
      }
      indices.set(node, index);
      if (node.forward.length !== node.span.length) {
        return `node at index ${index} has mismatched forward/span levels`;
      }
      if (node.forward[0] !== null && node.span[0] !== 1) {
        return `node at index ${index} has a non-unit bottom-level span`;
      }
      previous = node;
      node = node.forward[0];
      index++;
      if (index > this._size) {
        return "skip list contains more nodes than size";
      }
    }
    if (index !== this._size) {
      return `size ${this._size} does not match node count ${index}`;
    }
    if (previous !== this._tail) {
      return "tail pointer does not point at the last bottom-level node";
    }
    if (this._level < 0 || this._level >= MAX_LEVEL) {
      return "active level is out of range";
    }
    if (this._level > 0 && this._head.forward[this._level] === null) {
      return "active level has no nodes";
    }
    for (let level = this._level + 1; level < MAX_LEVEL; level++) {
      if (this._head.forward[level] !== null) {
        return `inactive level ${level} still has nodes`;
      }
      if (this._head.span[level] !== 0) {
        return `inactive level ${level} has a non-zero span`;
      }
    }

    for (let level = 0; level <= this._level; level++) {
      let current = this._head;
      const seen = new Set<SkipNode<K, V>>();
      while (current.forward[level] !== null) {
        const next = current.forward[level] as SkipNode<K, V>;
        if (seen.has(next)) {
          return `cycle detected on level ${level}`;
        }
        seen.add(next);
        if (next.forward.length !== next.span.length) {
          return `node on level ${level} has mismatched forward/span levels`;
        }
        if (next.forward.length <= level) {
          return `node on level ${level} has no pointer at that level`;
        }
        const nextIndex = indices.get(next);
        if (nextIndex === undefined) {
          return `level ${level} contains a node missing from level 0`;
        }
        const currentIndex =
          current === this._head ? -1 : (indices.get(current) as number);
        const distance = nextIndex - currentIndex;
        if (current.span[level] !== distance) {
          return `span mismatch on level ${level} at index ${currentIndex}`;
        }
        if (!Number.isInteger(current.span[level]) || current.span[level] <= 0) {
          return `non-positive span on level ${level}`;
        }
        current = next;
      }
      if (current.span[level] !== 0) {
        return `null-pointer span on level ${level} is not zero`;
      }
    }
    return true;
  }

  /** O(log n) expected: greatest node with key < `key`, or the head when none exists. */
  private predecessorNode(key: K): SkipNode<K, V> {
    let node = this._head;
    for (let level = this._level; level >= 0; level--) {
      let next = node.forward[level];
      while (next !== null && this.compare(next.key, key) < 0) {
        node = next;
        next = node.forward[level];
      }
    }
    return node;
  }

  /** O(1): one validated draw from the configured random source. */
  private nextRandom(): number {
    const value = this.rng.next();
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TypeError("rng.next() must return a finite number");
    }
    return value;
  }
}
