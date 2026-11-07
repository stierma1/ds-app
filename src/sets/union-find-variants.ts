import { assertDefined } from "../core/index.ts";
import type { DisjointSet } from "./types.ts";
import { deserializeSets, serializeSets } from "./serialization.ts";

function checkTreeSizes<E>(
  parent: Map<E, E>,
  sizes: Map<E, number>,
  setCount: number,
): true | string {
  const rootCounts = new Map<E, number>();
  for (const value of parent.keys()) {
    if (value === undefined) {
      return "forest contains an undefined value";
    }
    if (!parent.has(parent.get(value)!)) {
      return "parent pointer is missing from the forest";
    }
    let current = value;
    let steps = 0;
    while (!Object.is(current, parent.get(current)!)) {
      current = parent.get(current)!;
      steps++;
      if (steps > parent.size) {
        return "cycle detected in parent pointers";
      }
    }
    rootCounts.set(current, (rootCounts.get(current) ?? 0) + 1);
  }
  if (rootCounts.size !== setCount) {
    return `setCount ${setCount} does not match root count ${rootCounts.size}`;
  }
  for (const [root, count] of rootCounts) {
    if (sizes.get(root) !== count) {
      return "set size does not match member count";
    }
  }
  return true;
}

function collectGroups<E>(parent: Map<E, E>): E[][] {
  const groups = new Map<E, E[]>();
  for (const value of parent.keys()) {
    let root = value;
    while (!Object.is(root, parent.get(root)!)) {
      root = parent.get(root)!;
    }
    const group = groups.get(root);
    if (group === undefined) {
      groups.set(root, [value]);
    } else {
      group.push(value);
    }
  }
  return [...groups.values()];
}

/**
 * Eager disjoint set: a Map from each value to its root label plus a Map from root to the Set of
 * its members.
 *
 * Fast: O(1) find/connected/sizeOf with no path walking at all. Slow: union relabels every member
 * of `b`'s set into `a`'s set (always `b`'s, regardless of which is smaller), so a union is O(|set
 * of b|), O(n) worst case, and a sequence of n unions can cost O(n^2). Choose it when finds vastly
 * outnumber unions; otherwise use UnionFind.
 */
export class QuickFind<E> implements DisjointSet<E> {
  private _parent = new Map<E, E>();
  private _groups = new Map<E, Set<E>>();

  /** O(1). */
  get setCount(): number {
    return this._groups.size;
  }

  /** O(1). */
  get size(): number {
    return this._parent.size;
  }

  /** O(1) expected: two Map inserts and a one-element Set. */
  makeSet(value: E): void {
    assertDefined(value, "value");
    if (this._parent.has(value)) {
      return;
    }
    this._parent.set(value, value);
    this._groups.set(value, new Set([value]));
  }

  /** O(1): a single Map lookup. Throws RangeError for unknown values. */
  find(value: E): E {
    const root = this._parent.get(value);
    if (root === undefined) {
      throw new RangeError("value is not present in the forest");
    }
    return root;
  }

  /**
   * O(|B|) where B is `b`'s current set: every member is relabeled and copied into `a`'s set. Not
   * weighted, so passing the larger set as `b` costs the most.
   */
  union(a: E, b: E): boolean {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (Object.is(rootA, rootB)) {
      return false;
    }
    const groupA = this._groups.get(rootA)!;
    const groupB = this._groups.get(rootB)!;
    for (const value of groupB) {
      this._parent.set(value, rootA);
      groupA.add(value);
    }
    this._groups.delete(rootB);
    return true;
  }

  /** O(1): two Map lookups. */
  connected(a: E, b: E): boolean {
    return Object.is(this.find(a), this.find(b));
  }

  /** O(1): the Set size of the root's group. */
  sizeOf(value: E): number {
    return this._groups.get(this.find(value))!.size;
  }

  /** O(1): live iterator over the Map's keys in insertion order; not a snapshot. */
  values(): IterableIterator<E> {
    return this._parent.keys();
  }

  /** O(n): copies every member Set into a fresh array. */
  groups(): E[][] {
    return [...this._groups.values()].map((group) => [...group]);
  }

  /** O(n): clears both Maps. */
  clear(): void {
    this._parent.clear();
    this._groups.clear();
  }

  /** O(n). */
  validate(): true | string {
    const seenRoots = new Set<E>();
    for (const [root, group] of this._groups) {
      if (!Object.is(this._parent.get(root), root)) {
        return "group root is not its own parent";
      }
      seenRoots.add(root);
      for (const value of group) {
        if (!Object.is(this._parent.get(value), root)) {
          return "a member does not point at its group root";
        }
      }
    }
    for (const [value, root] of this._parent) {
      const group = this._groups.get(root);
      if (group === undefined || !group.has(value)) {
        return "a value is missing from its group";
      }
    }
    return true;
  }

  /** O(n). */
  serialize(): string {
    return serializeSets("QuickFind", this.groups());
  }

  /** O(n): each union merges a singleton into its group, so the O(|B|) cost is O(1) per element. */
  static deserialize<E>(json: unknown): QuickFind<E> {
    const groups = deserializeSets(json, "QuickFind");
    const forest = new QuickFind<E>();
    restoreGroups(forest, groups);
    if (forest.validate() !== true) {
      throw new TypeError(`Invalid QuickFind payload: ${forest.validate()}`);
    }
    return forest;
  }
}

/**
 * Minimal disjoint-set forest: a parent Map with no balancing and no path compression.
 *
 * union is two finds plus one pointer write (always `b`'s root under `a`'s), so trees can degrade
 * into chains: find/union/connected/sizeOf are O(h) in the tree height, O(n) worst case. Cheapest
 * per-operation constants in the family with the worst asymptotics; prefer WeightedUnionFind or
 * UnionFind unless the union sequence is known to be benign.
 */
export class QuickUnion<E> implements DisjointSet<E> {
  private _parent = new Map<E, E>();
  private _sizes = new Map<E, number>();
  private _setCount = 0;

  /** O(1). */
  get setCount(): number {
    return this._setCount;
  }

  /** O(1). */
  get size(): number {
    return this._parent.size;
  }

  /** O(1) expected: two Map inserts. */
  makeSet(value: E): void {
    assertDefined(value, "value");
    if (this._parent.has(value)) {
      return;
    }
    this._parent.set(value, value);
    this._sizes.set(value, 1);
    this._setCount++;
  }

  /**
   * O(h), h = height of the value's tree, O(n) worst case; walks parent pointers without
   * compressing. Throws RangeError for unknown values.
   */
  find(value: E): E {
    const parent = this._parent.get(value);
    if (parent === undefined) {
      throw new RangeError("value is not present in the forest");
    }
    let root = value;
    while (!Object.is(root, this._parent.get(root)!)) {
      root = this._parent.get(root)!;
    }
    return root;
  }

  /**
   * O(h): two finds plus an O(1) relink of `b`'s root under `a`'s root. No size check, so
   * repeatedly unioning a fresh value with a growing tree as `a` builds a chain.
   */
  union(a: E, b: E): boolean {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (Object.is(rootA, rootB)) {
      return false;
    }
    this._parent.set(rootB, rootA);
    this._sizes.set(rootA, this._sizes.get(rootA)! + this._sizes.get(rootB)!);
    this._sizes.delete(rootB);
    this._setCount--;
    return true;
  }

  /** O(h): two uncompressed finds. */
  connected(a: E, b: E): boolean {
    return Object.is(this.find(a), this.find(b));
  }

  /** O(h): one find plus a Map lookup. */
  sizeOf(value: E): number {
    return this._sizes.get(this.find(value))!;
  }

  /** O(1): live iterator over the Map's keys in insertion order; not a snapshot. */
  values(): IterableIterator<E> {
    return this._parent.keys();
  }

  /** O(n h): walks every element to its root without compressing. */
  groups(): E[][] {
    return collectGroups(this._parent);
  }

  /** O(n): clears both Maps. */
  clear(): void {
    this._parent.clear();
    this._sizes.clear();
    this._setCount = 0;
  }

  /** O(n h): walks every parent chain. */
  validate(): true | string {
    return checkTreeSizes(this._parent, this._sizes, this._setCount);
  }

  /** O(n h): serializes the output of groups(). */
  serialize(): string {
    return serializeSets("QuickUnion", this.groups());
  }

  /**
   * O(n): each union attaches a singleton root under the group's first element, so the rebuilt
   * trees have height 1.
   */
  static deserialize<E>(json: unknown): QuickUnion<E> {
    const groups = deserializeSets(json, "QuickUnion");
    const forest = new QuickUnion<E>();
    restoreGroups(forest, groups);
    if (forest.validate() !== true) {
      throw new TypeError(`Invalid QuickUnion payload: ${forest.validate()}`);
    }
    return forest;
  }
}

/**
 * Disjoint-set forest with union by size (the smaller tree is attached under the larger) and no
 * path compression.
 *
 * Tree height is bounded by log2(n), so find/union/connected/sizeOf are O(log n) worst case,
 * deterministically; find never mutates, which makes it safe to call while iterating values() or
 * from read-only contexts. UnionFind adds path compression on top for O(alpha(n)) amortized at the
 * cost of mutating finds; QuickUnion omits the size check and degrades to O(n).
 */
export class WeightedUnionFind<E> implements DisjointSet<E> {
  private _parent = new Map<E, E>();
  private _sizes = new Map<E, number>();
  private _setCount = 0;

  /** O(1). */
  get setCount(): number {
    return this._setCount;
  }

  /** O(1). */
  get size(): number {
    return this._parent.size;
  }

  /** O(1) expected: two Map inserts. */
  makeSet(value: E): void {
    assertDefined(value, "value");
    if (this._parent.has(value)) {
      return;
    }
    this._parent.set(value, value);
    this._sizes.set(value, 1);
    this._setCount++;
  }

  /**
   * O(log n) worst case: walks at most log2(n) parent pointers; read-only (no compression). Throws
   * RangeError for unknown values.
   */
  find(value: E): E {
    const parent = this._parent.get(value);
    if (parent === undefined) {
      throw new RangeError("value is not present in the forest");
    }
    let root = value;
    while (!Object.is(root, this._parent.get(root)!)) {
      root = this._parent.get(root)!;
    }
    return root;
  }

  /**
   * O(log n): two finds plus an O(1) relink that attaches the smaller tree under the larger (ties
   * favor `a`'s root).
   */
  union(a: E, b: E): boolean {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (Object.is(rootA, rootB)) {
      return false;
    }
    const sizeA = this._sizes.get(rootA)!;
    const sizeB = this._sizes.get(rootB)!;
    const newRoot = sizeA >= sizeB ? rootA : rootB;
    const child = sizeA >= sizeB ? rootB : rootA;
    this._parent.set(child, newRoot);
    this._sizes.set(newRoot, sizeA + sizeB);
    this._sizes.delete(child);
    this._setCount--;
    return true;
  }

  /** O(log n): two finds. */
  connected(a: E, b: E): boolean {
    return Object.is(this.find(a), this.find(b));
  }

  /** O(log n): one find plus a Map lookup. */
  sizeOf(value: E): number {
    return this._sizes.get(this.find(value))!;
  }

  /** O(1): live iterator over the Map's keys in insertion order; not a snapshot. */
  values(): IterableIterator<E> {
    return this._parent.keys();
  }

  /** O(n log n): walks every element to its root. */
  groups(): E[][] {
    return collectGroups(this._parent);
  }

  /** O(n): clears both Maps. */
  clear(): void {
    this._parent.clear();
    this._sizes.clear();
    this._setCount = 0;
  }

  /** O(n log n): walks every parent chain. */
  validate(): true | string {
    return checkTreeSizes(this._parent, this._sizes, this._setCount);
  }

  /** O(n log n): serializes the output of groups(). */
  serialize(): string {
    return serializeSets("WeightedUnionFind", this.groups());
  }

  /**
   * O(n): each union attaches a singleton under the group's growing root, so the rebuilt trees have
   * height 1.
   */
  static deserialize<E>(json: unknown): WeightedUnionFind<E> {
    const groups = deserializeSets(json, "WeightedUnionFind");
    const forest = new WeightedUnionFind<E>();
    restoreGroups(forest, groups);
    if (forest.validate() !== true) {
      throw new TypeError(`Invalid WeightedUnionFind payload: ${forest.validate()}`);
    }
    return forest;
  }
}

function restoreGroups<E>(
  forest: { makeSet(value: E): void; union(a: E, b: E): boolean },
  groups: unknown[][],
): void {
  for (const group of groups) {
    for (const value of group) {
      forest.makeSet(value as E);
    }
    if (group.length > 0) {
      const first = group[0] as E;
      for (let index = 1; index < group.length; index++) {
        forest.union(first, group[index] as E);
      }
    }
  }
}
