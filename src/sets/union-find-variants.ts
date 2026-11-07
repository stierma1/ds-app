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

export class QuickFind<E> implements DisjointSet<E> {
  private _parent = new Map<E, E>();
  private _groups = new Map<E, Set<E>>();

  get setCount(): number {
    return this._groups.size;
  }

  get size(): number {
    return this._parent.size;
  }

  makeSet(value: E): void {
    assertDefined(value, "value");
    if (this._parent.has(value)) {
      return;
    }
    this._parent.set(value, value);
    this._groups.set(value, new Set([value]));
  }

  find(value: E): E {
    const root = this._parent.get(value);
    if (root === undefined) {
      throw new RangeError("value is not present in the forest");
    }
    return root;
  }

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

  connected(a: E, b: E): boolean {
    return Object.is(this.find(a), this.find(b));
  }

  sizeOf(value: E): number {
    return this._groups.get(this.find(value))!.size;
  }

  values(): IterableIterator<E> {
    return this._parent.keys();
  }

  groups(): E[][] {
    return [...this._groups.values()].map((group) => [...group]);
  }

  clear(): void {
    this._parent.clear();
    this._groups.clear();
  }

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

  serialize(): string {
    return serializeSets("QuickFind", this.groups());
  }

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

export class QuickUnion<E> implements DisjointSet<E> {
  private _parent = new Map<E, E>();
  private _sizes = new Map<E, number>();
  private _setCount = 0;

  get setCount(): number {
    return this._setCount;
  }

  get size(): number {
    return this._parent.size;
  }

  makeSet(value: E): void {
    assertDefined(value, "value");
    if (this._parent.has(value)) {
      return;
    }
    this._parent.set(value, value);
    this._sizes.set(value, 1);
    this._setCount++;
  }

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

  connected(a: E, b: E): boolean {
    return Object.is(this.find(a), this.find(b));
  }

  sizeOf(value: E): number {
    return this._sizes.get(this.find(value))!;
  }

  values(): IterableIterator<E> {
    return this._parent.keys();
  }

  groups(): E[][] {
    return collectGroups(this._parent);
  }

  clear(): void {
    this._parent.clear();
    this._sizes.clear();
    this._setCount = 0;
  }

  validate(): true | string {
    return checkTreeSizes(this._parent, this._sizes, this._setCount);
  }

  serialize(): string {
    return serializeSets("QuickUnion", this.groups());
  }

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

export class WeightedUnionFind<E> implements DisjointSet<E> {
  private _parent = new Map<E, E>();
  private _sizes = new Map<E, number>();
  private _setCount = 0;

  get setCount(): number {
    return this._setCount;
  }

  get size(): number {
    return this._parent.size;
  }

  makeSet(value: E): void {
    assertDefined(value, "value");
    if (this._parent.has(value)) {
      return;
    }
    this._parent.set(value, value);
    this._sizes.set(value, 1);
    this._setCount++;
  }

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

  connected(a: E, b: E): boolean {
    return Object.is(this.find(a), this.find(b));
  }

  sizeOf(value: E): number {
    return this._sizes.get(this.find(value))!;
  }

  values(): IterableIterator<E> {
    return this._parent.keys();
  }

  groups(): E[][] {
    return collectGroups(this._parent);
  }

  clear(): void {
    this._parent.clear();
    this._sizes.clear();
    this._setCount = 0;
  }

  validate(): true | string {
    return checkTreeSizes(this._parent, this._sizes, this._setCount);
  }

  serialize(): string {
    return serializeSets("WeightedUnionFind", this.groups());
  }

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
