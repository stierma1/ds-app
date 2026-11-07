import {
  assertDefined,
  assertInteger,
  ContainerBase,
  parseSerialized,
  readArray,
  readValue,
  resolveComparator,
  serializeRecord,
} from "../core/index.ts";
import type { Comparator, RangeOptions } from "../core/index.ts";
import type {
  BinarySearchTree as BinarySearchTreeContract,
  TreeNode,
  TreeLike,
} from "./types.ts";

export class BSTNode<K, V> implements TreeNode<[K, V]> {
  value: [K, V];
  left: BSTNode<K, V> | null = null;
  right: BSTNode<K, V> | null = null;
  parent: BSTNode<K, V> | null;
  size = 1;

  constructor(value: [K, V], parent: BSTNode<K, V> | null) {
    this.value = value;
    this.parent = parent;
  }

  get key(): K {
    return this.value[0];
  }

  get data(): V {
    return this.value[1];
  }
}

interface SearchState<K, V> {
  parent: BSTNode<K, V> | null;
  node: BSTNode<K, V> | null;
  predecessor: BSTNode<K, V> | null;
  successor: BSTNode<K, V> | null;
}

export class BinarySearchTree<K, V = K>
  extends ContainerBase<[K, V]>
  implements BinarySearchTreeContract<K, V>, TreeLike<[K, V]>
{
  private _root: BSTNode<K, V> | null = null;
  readonly compare: Comparator<K>;

  constructor(compare?: Comparator<K>) {
    super();
    this.compare = resolveComparator(compare);
  }

  get root(): BSTNode<K, V> | null {
    return this._root;
  }

  get height(): number {
    if (this._root === null) {
      return -1;
    }
    let height = 0;
    let level: BSTNode<K, V>[] = [this._root];
    while (level.length > 0) {
      const next: BSTNode<K, V>[] = [];
      for (const node of level) {
        if (node.left !== null) next.push(node.left);
        if (node.right !== null) next.push(node.right);
      }
      if (next.length > 0) {
        height++;
      }
      level = next;
    }
    return height;
  }

  set(key: K, value: V): this {
    assertDefined(key, "key");
    assertDefined(value, "value");
    const search = this.search(key);
    if (search.node !== null) {
      search.node.value = [search.node.key, value];
      this.touch();
      return this;
    }
    const node = this.createNode([key, value], search.parent);
    if (search.parent === null) {
      this._root = node;
    } else if (this.compare(key, search.parent.key) < 0) {
      search.parent.left = node;
    } else {
      search.parent.right = node;
    }
    for (let current = node.parent; current !== null; current = current.parent) {
      current.size++;
    }
    this._size++;
    this.onInserted(node, search.predecessor, search.successor);
    this.touch();
    return this;
  }

  get(key: K): V | undefined {
    const node = this.search(key).node;
    return node === null ? undefined : node.value[1];
  }

  has(key: K): boolean {
    return this.search(key).node !== null;
  }

  delete(key: K): boolean {
    const found = this.search(key).node;
    if (found === null) {
      return false;
    }
    if (found.left !== null && found.right !== null) {
      const physical = this.minimumNode(found.right);
      const predecessor = this._predecessorNode(physical);
      const successor = this._successorNode(physical);
      const parent = physical.parent;
      found.value = physical.value;
      this.removePhysical(physical);
      for (let node = parent; node !== null; node = node.parent) {
        node.size--;
      }
      this.onRemoved(physical, predecessor, successor, found);
    } else {
      const predecessor = this._predecessorNode(found);
      const successor = this._successorNode(found);
      const parent = found.parent;
      this.removePhysical(found);
      for (let node = parent; node !== null; node = node.parent) {
        node.size--;
      }
      this.onRemoved(found, predecessor, successor, null);
    }
    this._size--;
    this.touch();
    return true;
  }

  min(): [K, V] | undefined {
    const node = this.minNode();
    return node === null ? undefined : node.value;
  }

  max(): [K, V] | undefined {
    const node = this.maxNode();
    return node === null ? undefined : node.value;
  }

  minNode(): BSTNode<K, V> | null {
    return this._root === null ? null : this.minimumNode(this._root);
  }

  maxNode(): BSTNode<K, V> | null {
    return this._root === null ? null : this.maximumNode(this._root);
  }

  predecessor(key: K): [K, V] | undefined {
    let node = this._root;
    let best: BSTNode<K, V> | null = null;
    while (node !== null) {
      if (this.compare(node.key, key) < 0) {
        best = node;
        node = node.right;
      } else {
        node = node.left;
      }
    }
    return best === null ? undefined : best.value;
  }

  successor(key: K): [K, V] | undefined {
    let node = this._root;
    let best: BSTNode<K, V> | null = null;
    while (node !== null) {
      if (this.compare(node.key, key) > 0) {
        best = node;
        node = node.left;
      } else {
        node = node.right;
      }
    }
    return best === null ? undefined : best.value;
  }

  predecessorNode(node: TreeNode<[K, V]>): TreeNode<[K, V]> | null {
    return this._predecessorNode(this.assertOwned(node));
  }

  successorNode(node: TreeNode<[K, V]>): TreeNode<[K, V]> | null {
    return this._successorNode(this.assertOwned(node));
  }

  at(index: number): [K, V] | undefined {
    assertInteger(index);
    if (index < 0 || index >= this._size) {
      return undefined;
    }
    let node = this._root;
    let remaining = index;
    while (node !== null) {
      const leftSize = node.left === null ? 0 : node.left.size;
      if (remaining < leftSize) {
        node = node.left;
      } else if (remaining === leftSize) {
        return node.value;
      } else {
        remaining -= leftSize + 1;
        node = node.right;
      }
    }
    return undefined;
  }

  indexOf(key: K): number {
    let node = this._root;
    let rank = 0;
    while (node !== null) {
      const comparison = this.compare(key, node.key);
      if (comparison === 0) {
        return rank + (node.left === null ? 0 : node.left.size);
      }
      if (comparison < 0) {
        node = node.left;
      } else {
        rank += (node.left === null ? 0 : node.left.size) + 1;
        node = node.right;
      }
    }
    return -1;
  }

  range(lo?: K, hi?: K, options?: RangeOptions<K>): IterableIterator<[K, V]> {
    const loInclusive = options?.lo === undefined || options.lo === "inclusive";
    const hiInclusive = options?.hi === undefined || options.hi === "inclusive";
    if (options?.lo !== undefined && options.lo !== "inclusive" && options.lo !== "exclusive") {
      throw new TypeError("lo must be 'inclusive' or 'exclusive'");
    }
    if (options?.hi !== undefined && options.hi !== "inclusive" && options.hi !== "exclusive") {
      throw new TypeError("hi must be 'inclusive' or 'exclusive'");
    }
    const entries: Array<[K, V]> = [];
    if (lo !== undefined && hi !== undefined && this.compare(lo, hi) > 0) {
      return this.snapshotIterator(entries);
    }
    let node: BSTNode<K, V> | null =
      lo === undefined ? this.minNode() : this.lowerBoundNode(lo, loInclusive);
    while (node !== null) {
      if (hi !== undefined) {
        const comparison = this.compare(node.key, hi);
        if (comparison > 0 || (comparison === 0 && !hiInclusive)) {
          break;
        }
      }
      entries.push(node.value);
      node = this._successorNode(node);
    }
    return this.snapshotIterator(entries);
  }

  keys(): IterableIterator<K> {
    return this.snapshotIterator(this.toArray().map((entry) => entry[0]));
  }

  values(): IterableIterator<V> {
    return this.snapshotIterator(this.toArray().map((entry) => entry[1]));
  }

  entries(): IterableIterator<[K, V]> {
    return this.snapshotIterator(this.toArray());
  }

  preorder(): IterableIterator<[K, V]> {
    const values: Array<[K, V]> = [];
    const stack: BSTNode<K, V>[] = this._root === null ? [] : [this._root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      values.push(node.value);
      if (node.right !== null) stack.push(node.right);
      if (node.left !== null) stack.push(node.left);
    }
    return this.snapshotIterator(values);
  }

  inorder(): IterableIterator<[K, V]> {
    return this.entries();
  }

  postorder(): IterableIterator<[K, V]> {
    const values: Array<[K, V]> = [];
    const stack: BSTNode<K, V>[] = this._root === null ? [] : [this._root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      values.push(node.value);
      if (node.left !== null) stack.push(node.left);
      if (node.right !== null) stack.push(node.right);
    }
    values.reverse();
    return this.snapshotIterator(values);
  }

  levelOrder(): IterableIterator<[K, V]> {
    const values: Array<[K, V]> = [];
    const queue: BSTNode<K, V>[] = this._root === null ? [] : [this._root];
    let index = 0;
    while (index < queue.length) {
      const node = queue[index++];
      values.push(node.value);
      if (node.left !== null) queue.push(node.left);
      if (node.right !== null) queue.push(node.right);
    }
    return this.snapshotIterator(values);
  }

  eulerTour(): IterableIterator<[K, V]> {
    const values: Array<[K, V]> = [];
    if (this._root === null) {
      return this.snapshotIterator(values);
    }
    interface Frame {
      node: BSTNode<K, V>;
      entered: boolean;
      childIndex: number;
    }
    const stack: Frame[] = [{ node: this._root, entered: false, childIndex: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (!frame.entered) {
        frame.entered = true;
        values.push(frame.node.value);
        continue;
      }
      const children = [frame.node.left, frame.node.right].filter(
        (child): child is BSTNode<K, V> => child !== null,
      );
      if (frame.childIndex < children.length) {
        const child = children[frame.childIndex++];
        stack.push({ node: child, entered: false, childIndex: 0 });
      } else {
        stack.pop();
        if (stack.length > 0) {
          values.push(stack[stack.length - 1].node.value);
        }
      }
    }
    return this.snapshotIterator(values);
  }

  serialize(): string {
    return serializeBstEntries("BinarySearchTree", this.toArray());
  }

  static deserialize<K, V>(
    json: unknown,
    compare?: Comparator<K>,
  ): BinarySearchTree<K, V> {
    const entries = readBstEntries<K, V>(json, "BinarySearchTree");
    const tree = new BinarySearchTree<K, V>(compare);
    insertBalanced(tree, entries);
    return tree;
  }

  clear(): void {
    this._root = null;
    this._size = 0;
    this.touch();
  }

  toArray(): Array<[K, V]> {
    const values: Array<[K, V]> = [];
    const stack: BSTNode<K, V>[] = [];
    let node = this._root;
    while (node !== null || stack.length > 0) {
      while (node !== null) {
        stack.push(node);
        node = node.left;
      }
      node = stack.pop()!;
      values.push(node.value);
      node = node.right;
    }
    return values;
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }

  validate(): true | string {
    if (this._root === null) {
      return this._size === 0 ? true : "non-empty size with empty root";
    }
    if (this._root.parent !== null) {
      return "root has a parent";
    }
    const stack: BSTNode<K, V>[] = [];
    let node: BSTNode<K, V> | null = this._root;
    let previous: BSTNode<K, V> | null = null;
    let count = 0;
    const seen = new Set<BSTNode<K, V>>();
    while (node !== null || stack.length > 0) {
      while (node !== null) {
        if (seen.has(node)) {
          return "cycle detected in left links";
        }
        seen.add(node);
        stack.push(node);
        node = node.left;
      }
      node = stack.pop()!;
      count++;
      if (count > this._size) {
        return "tree contains more nodes than size";
      }
      if (node.value === undefined || node.value[0] === undefined || node.value[1] === undefined) {
        return `node at index ${count - 1} has an undefined key or value`;
      }
      if (node.left !== null && node.left.parent !== node) {
        return `left child of node at index ${count - 1} has an incorrect parent link`;
      }
      if (node.right !== null && node.right.parent !== node) {
        return `right child of node at index ${count - 1} has an incorrect parent link`;
      }
      const expectedSize =
        1 + (node.left === null ? 0 : node.left.size) + (node.right === null ? 0 : node.right.size);
      if (node.size !== expectedSize) {
        return `subtree size at index ${count - 1} is ${node.size}, expected ${expectedSize}`;
      }
      if (previous !== null && this.compare(previous.key, node.key) >= 0) {
        return "binary search tree ordering is violated";
      }
      previous = node;
      node = node.right;
    }
    if (count !== this._size) {
      return `size ${this._size} does not match node count ${count}`;
    }
    return true;
  }

  protected createNode(value: [K, V], parent: BSTNode<K, V> | null): BSTNode<K, V> {
    return new BSTNode(value, parent);
  }

  protected onInserted(
    _node: BSTNode<K, V>,
    _predecessor: BSTNode<K, V> | null,
    _successor: BSTNode<K, V> | null,
  ): void {}

  protected onRemoved(
    _node: BSTNode<K, V>,
    _predecessor: BSTNode<K, V> | null,
    _successor: BSTNode<K, V> | null,
    _replacement: BSTNode<K, V> | null,
  ): void {}

  protected assertOwned(node: TreeNode<[K, V]>): BSTNode<K, V> {
    if (!(node instanceof BSTNode)) {
      throw new TypeError("Node does not belong to this tree");
    }
    let root: BSTNode<K, V> | null = node;
    while (root.parent !== null) {
      root = root.parent;
    }
    if (root !== this._root) {
      throw new TypeError("Node does not belong to this tree");
    }
    return node;
  }

  private search(key: K): SearchState<K, V> {
    let parent: BSTNode<K, V> | null = null;
    let node = this._root;
    let predecessor: BSTNode<K, V> | null = null;
    let successor: BSTNode<K, V> | null = null;
    while (node !== null) {
      const comparison = this.compare(key, node.key);
      if (comparison === 0) {
        return { parent, node, predecessor, successor };
      }
      parent = node;
      if (comparison < 0) {
        successor = node;
        node = node.left;
      } else {
        predecessor = node;
        node = node.right;
      }
    }
    return { parent, node: null, predecessor, successor };
  }

  private minimumNode(node: BSTNode<K, V>): BSTNode<K, V> {
    let current = node;
    while (current.left !== null) {
      current = current.left;
    }
    return current;
  }

  private maximumNode(node: BSTNode<K, V>): BSTNode<K, V> {
    let current = node;
    while (current.right !== null) {
      current = current.right;
    }
    return current;
  }

  protected _predecessorNode(node: BSTNode<K, V>): BSTNode<K, V> | null {
    if (node.left !== null) {
      return this.maximumNode(node.left);
    }
    let current = node;
    let parent = current.parent;
    while (parent !== null && current === parent.left) {
      current = parent;
      parent = parent.parent;
    }
    return parent;
  }

  protected _successorNode(node: BSTNode<K, V>): BSTNode<K, V> | null {
    if (node.right !== null) {
      return this.minimumNode(node.right);
    }
    let current = node;
    let parent = current.parent;
    while (parent !== null && current === parent.right) {
      current = parent;
      parent = parent.parent;
    }
    return parent;
  }

  private removePhysical(node: BSTNode<K, V>): void {
    const child = node.left !== null ? node.left : node.right;
    if (node.parent === null) {
      this._root = child;
    } else if (node === node.parent.left) {
      node.parent.left = child;
    } else {
      node.parent.right = child;
    }
    if (child !== null) {
      child.parent = node.parent;
    }
    node.left = null;
    node.right = null;
    node.parent = null;
  }

  private lowerBoundNode(key: K, inclusive: boolean): BSTNode<K, V> | null {
    let node = this._root;
    let best: BSTNode<K, V> | null = null;
    while (node !== null) {
      const comparison = this.compare(node.key, key);
      if (comparison > 0 || (inclusive && comparison === 0)) {
        best = node;
        node = node.left;
      } else {
        node = node.right;
      }
    }
    return best;
  }
}

export function serializeBstEntries(
  type: string,
  entries: Array<[unknown, unknown]>,
): string {
  for (const entry of entries) {
    if (entry[0] === undefined || entry[1] === undefined) {
      throw new TypeError("Cannot serialize an undefined key or value");
    }
  }
  return serializeRecord(type, { entries });
}

export function readBstEntries<K, V>(
  json: unknown,
  type: string,
): Array<[K, V]> {
  const record = parseSerialized(json, type);
  const raw = readArray(record, "entries");
  const entries: Array<[K, V]> = [];
  for (let index = 0; index < raw.length; index++) {
    const entry = raw[index];
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new TypeError(`entries[${index}] must be a [key, value] pair`);
    }
    const key = readValue<K>(entry[0], `entries[${index}][0]`);
    const value = readValue<V>(entry[1], `entries[${index}][1]`);
    entries.push([key, value]);
  }
  return entries;
}

export function insertBalanced<K, V>(
  tree: BinarySearchTree<K, V>,
  entries: Array<[K, V]>,
): void {
  const ranges: Array<[number, number]> = [];
  if (entries.length > 0) {
    ranges.push([0, entries.length - 1]);
  }
  while (ranges.length > 0) {
    const [low, high] = ranges.pop()!;
    if (low > high) {
      continue;
    }
    const middle = (low + high) >>> 1;
    const entry = entries[middle];
    tree.set(entry[0], entry[1]);
    ranges.push([middle + 1, high]);
    ranges.push([low, middle - 1]);
  }
}
