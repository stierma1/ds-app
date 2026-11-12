import { assertDefined } from "../core/index.ts";
import type { Comparator } from "../core/index.ts";
import { LeftistHeapBase } from "./base.ts";
import { parseLeftist } from "./serialization.ts";
import type {
  DoubleEndedLeftistTree as DoubleEndedLeftistTreeContract,
  LeftistHeap as LeftistHeapContract,
} from "./types.ts";

/**
 * Node of one of the two internal height-biased leftist trees. `twin` is the node holding the same
 * element in the other tree, and `parent` makes removal of an arbitrary node possible.
 */
interface TwinNode<T> {
  value: T;
  left: TwinNode<T> | null;
  right: TwinNode<T> | null;
  parent: TwinNode<T> | null;
  rank: number;
  twin: TwinNode<T>;
}

/**
 * Height-biased leftist tree with parent pointers, ordered by `order` (root = smallest). Supports
 * meld and removal of an arbitrary node, both O(log n) worst case.
 */
class ParentLeftistTree<T> {
  root: TwinNode<T> | null = null;

  readonly order: Comparator<T>;

  constructor(order: Comparator<T>) {
    this.order = order;
  }

  /** O(log n): melds along the right spines and fixes ranks and parent links on that path. */
  meld(a: TwinNode<T> | null, b: TwinNode<T> | null): TwinNode<T> | null {
    if (a === null) {
      return b;
    }
    if (b === null) {
      return a;
    }
    if (this.order(a.value, b.value) > 0) {
      const swap = a;
      a = b;
      b = swap;
    }
    const right = this.meld(a.right, b) as TwinNode<T>;
    right.parent = a;
    a.right = right;
    if ((a.left?.rank ?? 0) < right.rank) {
      a.right = a.left;
      a.left = right;
    }
    a.rank = (a.right?.rank ?? 0) + 1;
    return a;
  }

  /** O(log n): melds `tree` into this one. */
  absorb(tree: TwinNode<T> | null): void {
    this.root = this.meld(this.root, tree);
    if (this.root !== null) {
      this.root.parent = null;
    }
  }

  /**
   * O(log n) worst case: unlinks `node`, puts the meld of its children in its place, and repairs
   * ranks upwards. The repair stops at the first ancestor whose rank is unchanged; along the
   * repaired path the ranks (old ones when they grow, new ones when they shrink) rise by one per
   * level, and a node of rank r roots at least 2^r - 1 nodes, so the path has O(log n) nodes.
   */
  remove(node: TwinNode<T>): void {
    const replacement = this.meld(node.left, node.right);
    const parent = node.parent;
    if (replacement !== null) {
      replacement.parent = parent;
    }
    if (parent === null) {
      this.root = replacement;
    } else {
      if (parent.left === node) {
        parent.left = replacement;
      } else {
        parent.right = replacement;
      }
      let current: TwinNode<T> | null = parent;
      while (current !== null) {
        if ((current.left?.rank ?? 0) < (current.right?.rank ?? 0)) {
          const swap = current.left;
          current.left = current.right;
          current.right = swap;
        }
        const rank = (current.right?.rank ?? 0) + 1;
        if (rank === current.rank) {
          break;
        }
        current.rank = rank;
        current = current.parent;
      }
    }
    node.left = null;
    node.right = null;
    node.parent = null;
  }

  /** O(n): pairwise bottom-up meld of singleton nodes. */
  build(nodes: TwinNode<T>[]): void {
    let layer = nodes;
    while (layer.length > 1) {
      const next: TwinNode<T>[] = [];
      for (let index = 0; index + 1 < layer.length; index += 2) {
        next.push(this.meld(layer[index], layer[index + 1]) as TwinNode<T>);
      }
      if ((layer.length & 1) === 1) {
        next.push(layer[layer.length - 1]);
      }
      layer = next;
    }
    this.root = layer[0] ?? null;
    if (this.root !== null) {
      this.root.parent = null;
    }
  }

  /** O(n): pre-order walk. */
  nodes(): TwinNode<T>[] {
    const out: TwinNode<T>[] = [];
    const stack: TwinNode<T>[] = this.root === null ? [] : [this.root];
    while (stack.length > 0) {
      const node = stack.pop() as TwinNode<T>;
      out.push(node);
      if (node.right !== null) {
        stack.push(node.right);
      }
      if (node.left !== null) {
        stack.push(node.left);
      }
    }
    return out;
  }

  /** O(n): heap order, ranks, the leftist invariant, parent links, and acyclicity. */
  validate(): { nodes: Set<TwinNode<T>> } | string {
    const seen = new Set<TwinNode<T>>();
    if (this.root === null) {
      return { nodes: seen };
    }
    if (this.root.parent !== null) {
      return "root has a parent link";
    }
    const stack: TwinNode<T>[] = [this.root];
    while (stack.length > 0) {
      const node = stack.pop() as TwinNode<T>;
      if (seen.has(node)) {
        return "cycle or shared node detected";
      }
      seen.add(node);
      if (node.value === undefined) {
        return "node value is undefined";
      }
      const leftRank = node.left?.rank ?? 0;
      const rightRank = node.right?.rank ?? 0;
      if (!Number.isInteger(node.rank) || node.rank < 1) {
        return "node rank is not a positive integer";
      }
      if (leftRank < rightRank) {
        return "leftist rank invariant violated";
      }
      if (node.rank !== rightRank + 1) {
        return "node rank does not match its null-path length";
      }
      for (const child of [node.left, node.right]) {
        if (child === null) {
          continue;
        }
        if (child.parent !== node) {
          return "child has a wrong parent link";
        }
        if (this.order(node.value, child.value) > 0) {
          return "heap order violated";
        }
        stack.push(child);
      }
    }
    return { nodes: seen };
  }
}

/**
 * Double-ended leftist tree. A min-leftist tree and a max-leftist tree hold the same elements; each
 * element is a pair of twin nodes, one per tree. Removing an element from one side also removes
 * its twin from the other tree eagerly (parent pointers make that an O(log n) arbitrary deletion),
 * so neither tree ever holds a stale entry: space is O(n), `peekMin`/`peekMax` read a root in O(1)
 * worst case, and push, both pops, and the meld of two double-ended trees are O(log n) worst case.
 *
 * `popMin` and `popMax` each remove exactly one element; with one element left both remove it.
 * Iteration is a pre-order walk of the min tree: heap order, not sorted order.
 *
 * Node: {value, left, right, parent, rank, twin}
 */
export class DoubleEndedLeftistTree<T>
  extends LeftistHeapBase<T>
  implements DoubleEndedLeftistTreeContract<T>
{
  private _min: ParentLeftistTree<T>;
  private _max: ParentLeftistTree<T>;

  constructor(compare?: Comparator<T>) {
    super(compare);
    const order = this.compare;
    this._min = new ParentLeftistTree<T>(order);
    this._max = new ParentLeftistTree<T>((a, b) => order(b, a));
  }

  /** O(log n): insert twin nodes into the min tree and the max tree. */
  push(value: T): void {
    this.assertLive();
    this.requireValue(value);
    const [minNode, maxNode] = this.createPair(value);
    this._min.absorb(minNode);
    this._max.absorb(maxNode);
    this._size++;
    this.touch();
  }

  /** O(log n): remove the minimum. */
  pop(): T | undefined {
    return this.popMin();
  }

  /** O(log n): remove the min-tree root and its twin in the max tree. */
  override popMin(): T | undefined {
    this.assertLive();
    return this.removeTop(this._min, this._max);
  }

  /** O(log n): remove the max-tree root and its twin in the min tree. */
  popMax(): T | undefined {
    this.assertLive();
    return this.removeTop(this._max, this._min);
  }

  /** O(1): the minimum element, or undefined when empty. */
  peek(): T | undefined {
    return this.peekMin();
  }

  /** O(1) worst case: the min-tree root. */
  override peekMin(): T | undefined {
    this.assertLive();
    return this._min.root?.value;
  }

  /** O(1) worst case: the max-tree root. */
  peekMax(): T | undefined {
    this.assertLive();
    return this._max.root?.value;
  }

  /** O(n): builds both internal trees bottom-up from the same twin pairs. */
  override build(values: Iterable<T>): void {
    this.assertLive();
    const items = [...values];
    for (const value of items) {
      assertDefined(value);
    }
    const pairs = items.map((value) => this.createPair(value));
    this._min.build(pairs.map((pair) => pair[0]));
    this._max.build(pairs.map((pair) => pair[1]));
    this._size = items.length;
    this.touch();
  }

  /** O(1): null-path length of the min-tree root, 0 when empty. */
  override get rank(): number {
    this.assertLive();
    return this._min.root?.rank ?? 0;
  }

  /**
   * O(log n) destructive merge of two double-ended trees sharing one comparator: melds both
   * internal trees. `other` is consumed. A different comparator throws TypeError; any other
   * implementation throws UnsupportedError (melding it would require copying), and neither heap
   * is changed.
   */
  merge(other: LeftistHeapContract<T>): DoubleEndedLeftistTree<T> {
    this.acceptMerge(other, DoubleEndedLeftistTree);
    const source = other as DoubleEndedLeftistTree<T>;
    const otherMin = source._min.root;
    const otherMax = source._max.root;
    const otherSize = source._size;
    source.markConsumed();
    this._min.absorb(otherMin);
    this._max.absorb(otherMax);
    this._size += otherSize;
    this.touch();
    return this;
  }

  /** O(n): validates both internal trees, the twin links, and size. */
  validate(): true | string {
    this.assertLive();
    const minStatus = this._min.validate();
    if (typeof minStatus === "string") {
      return `min heap invalid: ${minStatus}`;
    }
    const maxStatus = this._max.validate();
    if (typeof maxStatus === "string") {
      return `max heap invalid: ${maxStatus}`;
    }
    const minNodes = minStatus.nodes;
    const maxNodes = maxStatus.nodes;
    for (const node of minNodes) {
      if (!maxNodes.has(node.twin) || node.twin.twin !== node) {
        return "live entry missing from the max heap";
      }
      if (!Object.is(node.value, node.twin.value)) {
        return "twin nodes hold different values";
      }
    }
    for (const node of maxNodes) {
      if (!minNodes.has(node.twin) || node.twin.twin !== node) {
        return "live entry missing from the min heap";
      }
    }
    if (minNodes.size !== this._size || maxNodes.size !== this._size) {
      return `size ${this._size} does not match node counts ${minNodes.size}/${maxNodes.size}`;
    }
    return true;
  }

  /** O(n): rebuilds through build() and validates the payload. */
  static deserialize<T>(
    json: unknown,
    compare?: Comparator<T>,
  ): DoubleEndedLeftistTree<T> {
    const { values } = parseLeftist(json, "DoubleEndedLeftistTree");
    const tree = new DoubleEndedLeftistTree<T>(compare);
    tree.build(values as T[]);
    if (tree.validate() !== true) {
      throw new TypeError(`Invalid DoubleEndedLeftistTree payload: ${tree.validate()}`);
    }
    return tree;
  }

  protected override get serializationType(): string {
    return "DoubleEndedLeftistTree";
  }

  /** O(n): pre-order walk of the min tree. */
  protected collectItems(): T[] {
    return this._min.nodes().map((node) => node.value);
  }

  protected releaseStorage(): void {
    this._min.root = null;
    this._max.root = null;
  }

  /** O(log n): pops the root of `from` and deletes its twin from `other`. */
  private removeTop(from: ParentLeftistTree<T>, other: ParentLeftistTree<T>): T | undefined {
    const node = from.root;
    if (node === null) {
      return undefined;
    }
    from.remove(node);
    other.remove(node.twin);
    this._size--;
    this.touch();
    return node.value;
  }

  private createPair(value: T): [TwinNode<T>, TwinNode<T>] {
    // The twin link is filled in right after both nodes exist.
    const minNode = { value, left: null, right: null, parent: null, rank: 1 } as TwinNode<T>;
    const maxNode: TwinNode<T> = {
      value,
      left: null,
      right: null,
      parent: null,
      rank: 1,
      twin: minNode,
    };
    minNode.twin = maxNode;
    return [minNode, maxNode];
  }
}
