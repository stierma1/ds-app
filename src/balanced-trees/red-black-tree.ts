import {
  assertDefined,
  assertInteger,
  ContainerBase,
  ConsumedError,
  resolveComparator,
  UnsupportedError,
} from "../core/index.ts";
import type { Comparator, RangeOptions } from "../core/index.ts";
import { readAvlEntries, serializeAvlEntries } from "./serialization.ts";
import type { BalancedTree } from "./types.ts";

const RED = true;
const BLACK = false;

/**
 * Red-black node. Colors are booleans for compactness; `height` is measured in edges (a leaf has
 * height 0 and the null child -1), `size` is the subtree node count, and `blackHeight` counts the
 * black nodes on any path from this node to a null child, including the node itself when black.
 */
class RedBlackNode<K, V> {
  key: K;
  value: V;
  left: RedBlackNode<K, V> | null = null;
  right: RedBlackNode<K, V> | null = null;
  parent: RedBlackNode<K, V> | null;
  color: boolean = RED;
  height = 0;
  size = 1;
  blackHeight = 0;

  constructor(key: K, value: V, parent: RedBlackNode<K, V> | null) {
    this.key = key;
    this.value = value;
    this.parent = parent;
  }
}

/** Mutable holder that lets rotation and fixup helpers replace the subtree root. */
interface RootState<K, V> {
  root: RedBlackNode<K, V> | null;
}

/** O(1): height in edges, with the null tree at -1. */
function heightOf<K, V>(node: RedBlackNode<K, V> | null): number {
  return node === null ? -1 : node.height;
}

/** O(1): subtree node count, with the null tree at 0. */
function sizeOf<K, V>(node: RedBlackNode<K, V> | null): number {
  return node === null ? 0 : node.size;
}

/** O(1): black-height, with null leaves contributing 0. */
function blackHeightOf<K, V>(node: RedBlackNode<K, V> | null): number {
  return node === null ? 0 : node.blackHeight;
}

/** O(1): null children are black. */
function colorOf<K, V>(node: RedBlackNode<K, V> | null): boolean {
  return node === null ? BLACK : node.color;
}

/** O(1): recomputes the cached height, size, and black-height from the children. */
function updateNode<K, V>(node: RedBlackNode<K, V>): void {
  node.height = 1 + Math.max(heightOf(node.left), heightOf(node.right));
  node.size = 1 + sizeOf(node.left) + sizeOf(node.right);
  node.blackHeight =
    (node.color === BLACK ? 1 : 0) + blackHeightOf(node.left);
}

/** O(1): promotes `x.right`, fixing parent links and the tracked subtree root. */
function rotateLeft<K, V>(
  state: RootState<K, V>,
  x: RedBlackNode<K, V>,
): RedBlackNode<K, V> {
  const y = x.right as RedBlackNode<K, V>;
  x.right = y.left;
  if (y.left !== null) {
    y.left.parent = x;
  }
  y.parent = x.parent;
  if (x.parent === null) {
    state.root = y;
  } else if (x === x.parent.left) {
    x.parent.left = y;
  } else {
    x.parent.right = y;
  }
  y.left = x;
  x.parent = y;
  updateNode(x);
  updateNode(y);
  return y;
}

/** O(1): promotes `x.left`, fixing parent links and the tracked subtree root. */
function rotateRight<K, V>(
  state: RootState<K, V>,
  x: RedBlackNode<K, V>,
): RedBlackNode<K, V> {
  const y = x.left as RedBlackNode<K, V>;
  x.left = y.right;
  if (y.right !== null) {
    y.right.parent = x;
  }
  y.parent = x.parent;
  if (x.parent === null) {
    state.root = y;
  } else if (x === x.parent.left) {
    x.parent.left = y;
  } else {
    x.parent.right = y;
  }
  y.right = x;
  x.parent = y;
  updateNode(x);
  updateNode(y);
  return y;
}

/**
 * O(log n): restores red-black parent colors after a red node is linked under a possibly red
 * parent. The node may carry two black subtrees (as in `join`), so the loop only inspects the
 * parent/uncle colors and rotates; local caches are repaired by the rotations and the final
 * `refreshUp` performed by the caller.
 */
function insertFixup<K, V>(
  state: RootState<K, V>,
  node: RedBlackNode<K, V>,
): RedBlackNode<K, V> {
  let current = node;
  while (current.parent !== null && current.parent.color === RED) {
    const parent = current.parent;
    const grandparent = parent.parent;
    if (grandparent === null) {
      parent.color = BLACK;
      updateNode(parent);
      break;
    }
    if (parent === grandparent.left) {
      const uncle = grandparent.right;
      if (colorOf(uncle) === RED) {
        const redUncle = uncle as RedBlackNode<K, V>;
        parent.color = BLACK;
        redUncle.color = BLACK;
        grandparent.color = RED;
        updateNode(parent);
        updateNode(redUncle);
        updateNode(grandparent);
        current = grandparent;
      } else {
        if (current === parent.right) {
          current = parent;
          rotateLeft(state, current);
        }
        const blackParent = current.parent as RedBlackNode<K, V>;
        const redGrandparent = blackParent.parent as RedBlackNode<K, V>;
        blackParent.color = BLACK;
        redGrandparent.color = RED;
        updateNode(blackParent);
        updateNode(redGrandparent);
        rotateRight(state, redGrandparent);
      }
    } else {
      const uncle = grandparent.left;
      if (colorOf(uncle) === RED) {
        const redUncle = uncle as RedBlackNode<K, V>;
        parent.color = BLACK;
        redUncle.color = BLACK;
        grandparent.color = RED;
        updateNode(parent);
        updateNode(redUncle);
        updateNode(grandparent);
        current = grandparent;
      } else {
        if (current === parent.left) {
          current = parent;
          rotateRight(state, current);
        }
        const blackParent = current.parent as RedBlackNode<K, V>;
        const redGrandparent = blackParent.parent as RedBlackNode<K, V>;
        blackParent.color = BLACK;
        redGrandparent.color = RED;
        updateNode(blackParent);
        updateNode(redGrandparent);
        rotateLeft(state, redGrandparent);
      }
    }
  }
  if (state.root !== null) {
    state.root.color = BLACK;
  }
  return current;
}

/**
 * O(log n): climbs from `start` to the root, refreshing caches. Every structural or color change
 * made by the callers is below `start`, so this repairs the remaining ancestor chain.
 */
function refreshUp<K, V>(
  state: RootState<K, V>,
  start: RedBlackNode<K, V> | null,
): void {
  let current = start;
  while (current !== null) {
    updateNode(current);
    current = current.parent;
  }
  if (state.root !== null) {
    updateNode(state.root);
  }
}

/**
 * O(log n): restores the black-height/color invariants after a black node was unlinked. `isLeft`
 * records the side of the null-or-real replacement when `node` itself is null. Returns a node on
 * the repaired path so the caller can refresh caches up to the root.
 */
function deleteFixup<K, V>(
  state: RootState<K, V>,
  node: RedBlackNode<K, V> | null,
  parent: RedBlackNode<K, V> | null,
  isLeft: boolean,
): RedBlackNode<K, V> | null {
  let current = node;
  let currentParent = parent;
  let currentIsLeft = isLeft;
  let target: RedBlackNode<K, V> | null = current ?? currentParent;

  while (
    current !== state.root &&
    colorOf(current) === BLACK &&
    currentParent !== null
  ) {
    if (currentIsLeft) {
      let sibling = currentParent.right;
      if (colorOf(sibling) === RED) {
        const redSibling = sibling as RedBlackNode<K, V>;
        redSibling.color = BLACK;
        currentParent.color = RED;
        rotateLeft(state, currentParent);
        sibling = currentParent.right;
        target = sibling ?? currentParent;
      }
      if (sibling === null) {
        current = currentParent;
        currentParent = current.parent;
        currentIsLeft =
          currentParent !== null && current === currentParent.left;
        target = current;
        continue;
      }
      if (
        colorOf(sibling.left) === BLACK &&
        colorOf(sibling.right) === BLACK
      ) {
        sibling.color = RED;
        updateNode(sibling);
        updateNode(currentParent);
        current = currentParent;
        currentParent = current.parent;
        currentIsLeft =
          currentParent !== null && current === currentParent.left;
        target = current;
      } else {
        if (colorOf(sibling.right) === BLACK) {
          const leftChild = sibling.left as RedBlackNode<K, V>;
          leftChild.color = BLACK;
          sibling.color = RED;
          rotateRight(state, sibling);
          sibling = currentParent.right;
        }
        const finalSibling = sibling as RedBlackNode<K, V>;
        finalSibling.color = currentParent.color;
        currentParent.color = BLACK;
        if (finalSibling.right !== null) {
          finalSibling.right.color = BLACK;
          updateNode(finalSibling.right);
        }
        rotateLeft(state, currentParent);
        target = finalSibling;
        current = state.root;
        currentParent = null;
      }
    } else {
      let sibling = currentParent.left;
      if (colorOf(sibling) === RED) {
        const redSibling = sibling as RedBlackNode<K, V>;
        redSibling.color = BLACK;
        currentParent.color = RED;
        rotateRight(state, currentParent);
        sibling = currentParent.left;
        target = sibling ?? currentParent;
      }
      if (sibling === null) {
        current = currentParent;
        currentParent = current.parent;
        currentIsLeft =
          currentParent !== null && current === currentParent.left;
        target = current;
        continue;
      }
      if (
        colorOf(sibling.left) === BLACK &&
        colorOf(sibling.right) === BLACK
      ) {
        sibling.color = RED;
        updateNode(sibling);
        updateNode(currentParent);
        current = currentParent;
        currentParent = current.parent;
        currentIsLeft =
          currentParent !== null && current === currentParent.left;
        target = current;
      } else {
        if (colorOf(sibling.left) === BLACK) {
          const rightChild = sibling.right as RedBlackNode<K, V>;
          rightChild.color = BLACK;
          sibling.color = RED;
          rotateLeft(state, sibling);
          sibling = currentParent.left;
        }
        const finalSibling = sibling as RedBlackNode<K, V>;
        finalSibling.color = currentParent.color;
        currentParent.color = BLACK;
        if (finalSibling.left !== null) {
          finalSibling.left.color = BLACK;
          updateNode(finalSibling.left);
        }
        rotateRight(state, currentParent);
        target = finalSibling;
        current = state.root;
        currentParent = null;
      }
    }
  }

  if (current !== null) {
    current.color = BLACK;
    updateNode(current);
  }
  return target ?? current ?? currentParent;
}

/**
 * O(log n): inserts an isolated node into a detached subtree through the normal red-black
 * insertion path. Used by `join` when one side is empty.
 */
function insertSeparator<K, V>(
  state: RootState<K, V>,
  node: RedBlackNode<K, V>,
  compare: Comparator<K>,
): RedBlackNode<K, V> {
  if (state.root !== null && state.root.color === RED) {
    state.root.color = BLACK;
    updateNode(state.root);
  }
  node.left = null;
  node.right = null;
  node.parent = null;
  node.color = RED;
  updateNode(node);
  if (state.root === null) {
    node.color = BLACK;
    updateNode(node);
    return node;
  }
  let parent: RedBlackNode<K, V> | null = null;
  let current: RedBlackNode<K, V> | null = state.root;
  while (current !== null) {
    parent = current;
    current = compare(node.key, current.key) < 0 ? current.left : current.right;
  }
  node.parent = parent;
  if (compare(node.key, (parent as RedBlackNode<K, V>).key) < 0) {
    (parent as RedBlackNode<K, V>).left = node;
  } else {
    (parent as RedBlackNode<K, V>).right = node;
  }
  const top = insertFixup(state, node);
  if (state.root !== null) {
    state.root.color = BLACK;
  }
  refreshUp(state, top);
  return state.root;
}

/**
 * O(log n): returns the black node of maximum key with the requested black-height, or null.
 * Descends right-first so the first eligible black node has the largest key.
 */
function findMaxBlackAtBlackHeight<K, V>(
  node: RedBlackNode<K, V> | null,
  target: number,
): RedBlackNode<K, V> | null {
  if (node === null) {
    return null;
  }
  if (node.right !== null && blackHeightOf(node.right) >= target) {
    const found = findMaxBlackAtBlackHeight(node.right, target);
    if (found !== null) {
      return found;
    }
  }
  if (node.color === BLACK && node.blackHeight === target) {
    return node;
  }
  if (node.left !== null && blackHeightOf(node.left) >= target) {
    return findMaxBlackAtBlackHeight(node.left, target);
  }
  return null;
}

/**
 * O(log n): returns the black node of minimum key with the requested black-height, or null.
 * Descends left-first for the symmetric `join` case.
 */
function findMinBlackAtBlackHeight<K, V>(
  node: RedBlackNode<K, V> | null,
  target: number,
): RedBlackNode<K, V> | null {
  if (node === null) {
    return null;
  }
  if (node.left !== null && blackHeightOf(node.left) >= target) {
    const found = findMinBlackAtBlackHeight(node.left, target);
    if (found !== null) {
      return found;
    }
  }
  if (node.color === BLACK && node.blackHeight === target) {
    return node;
  }
  if (node.right !== null && blackHeightOf(node.right) >= target) {
    return findMinBlackAtBlackHeight(node.right, target);
  }
  return null;
}

/**
 * O(log n): joins two detached trees around the isolated `separator`, whose key lies strictly
 * between their key ranges. Replaces the correct black node on the taller tree's inner spine with
 * the separator and runs insertion fixup, as in CLRS problem 13-2.
 */
function joinNode<K, V>(
  left: RedBlackNode<K, V> | null,
  separator: RedBlackNode<K, V>,
  right: RedBlackNode<K, V> | null,
  compare: Comparator<K>,
): RedBlackNode<K, V> {
  if (left === null || right === null) {
    const state: RootState<K, V> = { root: left ?? right };
    return insertSeparator(state, separator, compare);
  }

  if (left.color === RED) {
    left.color = BLACK;
    updateNode(left);
  }
  if (right.color === RED) {
    right.color = BLACK;
    updateNode(right);
  }

  const leftTaller = blackHeightOf(left) >= blackHeightOf(right);
  const target = leftTaller ? blackHeightOf(right) : blackHeightOf(left);
  const anchor = leftTaller
    ? findMaxBlackAtBlackHeight(left, target)
    : findMinBlackAtBlackHeight(right, target);
  if (anchor === null) {
    throw new Error("red-black join could not find a matching black-height node");
  }
  const parent = anchor.parent;
  const anchorWasLeft = parent !== null && anchor === parent.left;

  separator.color = RED;
  separator.left = null;
  separator.right = null;
  if (leftTaller) {
    separator.left = anchor;
    separator.right = right;
    anchor.parent = separator;
    right.parent = separator;
  } else {
    separator.left = left;
    separator.right = anchor;
    left.parent = separator;
    anchor.parent = separator;
  }
  separator.parent = parent;
  if (parent === null) {
    // The separator becomes the root below; the state is created after linking.
  } else if (anchorWasLeft) {
    parent.left = separator;
  } else {
    parent.right = separator;
  }
  updateNode(separator);

  const state: RootState<K, V> = {
    root: parent === null ? separator : findRoot(parent),
  };
  const top = insertFixup(state, separator);
  if (state.root !== null) {
    state.root.color = BLACK;
  }
  refreshUp(state, top);
  return state.root as RedBlackNode<K, V>;
}

/** O(log n): follows parent links to the detached subtree root. */
function findRoot<K, V>(node: RedBlackNode<K, V>): RedBlackNode<K, V> {
  let current = node;
  while (current.parent !== null) {
    current = current.parent;
  }
  return current;
}

/**
 * O(log n): splits a detached tree into keys `< key` and `>= key`. Each level rejoins the retained
 * subtree with the separator node, so both halves are valid red-black trees.
 */
function splitRoots<K, V>(
  root: RedBlackNode<K, V> | null,
  key: K,
  compare: Comparator<K>,
): [RedBlackNode<K, V> | null, RedBlackNode<K, V> | null] {
  if (root === null) {
    return [null, null];
  }
  const left = root.left;
  const right = root.right;
  root.left = null;
  root.right = null;
  root.parent = null;
  if (left !== null) {
    left.parent = null;
  }
  if (right !== null) {
    right.parent = null;
  }
  if (compare(root.key, key) < 0) {
    const [less, greater] = splitRoots(right, key, compare);
    return [joinNode(left, root, less, compare), greater];
  }
  const [less, greater] = splitRoots(left, key, compare);
  return [less, joinNode(greater, root, right, compare)];
}

/**
 * O(n log n): inserts sorted entries median-first through the normal `set` path, which produces a
 * red-black tree while keeping every cache consistent. The explicit range stack avoids recursion.
 */
function insertBalanced<K, V>(
  tree: RedBlackTree<K, V>,
  entries: ReadonlyArray<readonly [K, V]>,
): void {
  const ranges: Array<[number, number]> = [];
  if (entries.length > 0) {
    ranges.push([0, entries.length - 1]);
  }
  while (ranges.length > 0) {
    const [low, high] = ranges.pop() as [number, number];
    if (low > high) {
      continue;
    }
    const middle = (low + high) >>> 1;
    const entry = entries[middle] as readonly [K, V];
    tree.set(entry[0], entry[1]);
    ranges.push([middle + 1, high]);
    ranges.push([low, middle - 1]);
  }
}

/**
 * Red-black tree: an ordered map with a worst-case O(log n) height. Every node caches its height,
 * subtree size, and black-height, so `get`/`set`/`delete` are O(log n), `height` is O(1), and the
 * order-statistic `at`/`indexOf` pair is O(log n). `min`/`max` walk a spine in O(log n); `range`
 * is O(log n + k) because it materializes the k reported entries before returning the snapshot
 * iterator.
 *
 * `join` and `split` are destructive: `join` consumes both inputs and returns a fresh tree;
 * `split` consumes its receiver and returns two fresh trees. Iteration is ascending by key and
 * follows the common snapshot/invalidation protocol: a mutation after the iterator is created
 * makes the next step throw `ConcurrentModificationError`.
 */
export class RedBlackTree<K, V = K>
  extends ContainerBase<[K, V]>
  implements BalancedTree<K, V>
{
  readonly compare: Comparator<K>;
  private _root: RedBlackNode<K, V> | null = null;
  private _consumed = false;

  /** O(1); `compare` defaults to the core natural-order comparator. */
  constructor(compare?: Comparator<K>) {
    super();
    this.compare = resolveComparator(compare);
  }

  /** O(1): height in edges; -1 for an empty tree and 0 for a single node. */
  get height(): number {
    this.assertLive();
    return this._root === null ? -1 : this._root.height;
  }

  /** O(1) after the live check: cached element count. */
  override get size(): number {
    this.assertLive();
    return this._size;
  }

  /** O(1) after the live check. */
  override isEmpty(): boolean {
    this.assertLive();
    return this._size === 0;
  }

  /**
   * O(log n): one descent to the key, replacing the value in place when it already exists, or
   * linking a red leaf and running insertion fixup.
   */
  set(key: K, value: V): this {
    this.assertLive();
    assertDefined(key, "key");
    assertDefined(value, "value");
    const state: RootState<K, V> = { root: this._root };
    let parent: RedBlackNode<K, V> | null = null;
    let current = state.root;
    while (current !== null) {
      const comparison = this.compare(key, current.key);
      if (comparison === 0) {
        current.value = value;
        this.touch();
        return this;
      }
      parent = current;
      current = comparison < 0 ? current.left : current.right;
    }
    const node = new RedBlackNode(key, value, parent);
    if (parent === null) {
      state.root = node;
    } else if (this.compare(key, parent.key) < 0) {
      parent.left = node;
    } else {
      parent.right = node;
    }
    const top = insertFixup(state, node);
    if (state.root !== null) {
      state.root.color = BLACK;
    }
    refreshUp(state, top);
    this._size++;
    this._root = state.root;
    this.touch();
    return this;
  }

  /** O(log n): one descent; returns undefined when the key is absent. */
  get(key: K): V | undefined {
    this.assertLive();
    const node = this.findNode(key);
    return node === null ? undefined : node.value;
  }

  /** O(log n): one descent. */
  has(key: K): boolean {
    this.assertLive();
    return this.findNode(key) !== null;
  }

  /**
   * O(log n): a two-child node takes over its successor's entry, the successor (which has at most
   * one child) is unlinked, and deletion fixup restores the black-height invariant.
   */
  delete(key: K): boolean {
    this.assertLive();
    const state: RootState<K, V> = { root: this._root };
    const found = this.findNode(key);
    if (found === null) {
      return false;
    }
    let physical = found;
    if (found.left !== null && found.right !== null) {
      physical = this.minimumNode(found.right);
      found.key = physical.key;
      found.value = physical.value;
    }
    const child = physical.left !== null ? physical.left : physical.right;
    const parent = physical.parent;
    const wasLeft = parent !== null && physical === parent.left;
    const wasBlack = physical.color === BLACK;

    if (parent === null) {
      state.root = child;
    } else if (wasLeft) {
      parent.left = child;
    } else {
      parent.right = child;
    }
    if (child !== null) {
      child.parent = parent;
    }
    physical.left = null;
    physical.right = null;
    physical.parent = null;

    this._size--;
    let refresh: RedBlackNode<K, V> | null = child ?? parent;
    if (wasBlack) {
      refresh = deleteFixup(state, child, parent, wasLeft);
    }
    if (state.root !== null) {
      state.root.color = BLACK;
    }
    refreshUp(state, refresh);
    this._root = state.root;
    this.touch();
    return true;
  }

  /** O(log n): left-spine walk. */
  min(): [K, V] | undefined {
    this.assertLive();
    const node = this.minNodeInternal();
    return node === null ? undefined : [node.key, node.value];
  }

  /** O(log n): right-spine walk. */
  max(): [K, V] | undefined {
    this.assertLive();
    const node = this.maxNodeInternal();
    return node === null ? undefined : [node.key, node.value];
  }

  /** O(log n): largest entry strictly less than `key`; works for absent keys too. */
  predecessor(key: K): [K, V] | undefined {
    this.assertLive();
    let node = this._root;
    let best: RedBlackNode<K, V> | null = null;
    while (node !== null) {
      if (this.compare(node.key, key) < 0) {
        best = node;
        node = node.right;
      } else {
        node = node.left;
      }
    }
    return best === null ? undefined : [best.key, best.value];
  }

  /** O(log n): smallest entry strictly greater than `key`; works for absent keys too. */
  successor(key: K): [K, V] | undefined {
    this.assertLive();
    let node = this._root;
    let best: RedBlackNode<K, V> | null = null;
    while (node !== null) {
      if (this.compare(node.key, key) > 0) {
        best = node;
        node = node.left;
      } else {
        node = node.right;
      }
    }
    return best === null ? undefined : [best.key, best.value];
  }

  /** O(log n): select by rank through cached subtree sizes. Out-of-range indices return undefined. */
  at(index: number): [K, V] | undefined {
    this.assertLive();
    assertInteger(index);
    if (index < 0 || index >= this._size) {
      return undefined;
    }
    let node = this._root;
    let remaining = index;
    while (node !== null) {
      const leftSize = sizeOf(node.left);
      if (remaining < leftSize) {
        node = node.left;
      } else if (remaining === leftSize) {
        return [node.key, node.value];
      } else {
        remaining -= leftSize + 1;
        node = node.right;
      }
    }
    return undefined;
  }

  /** O(log n): rank query through cached subtree sizes; -1 when the key is absent. */
  indexOf(key: K): number {
    this.assertLive();
    let node = this._root;
    let rank = 0;
    while (node !== null) {
      const comparison = this.compare(key, node.key);
      if (comparison === 0) {
        return rank + sizeOf(node.left);
      }
      if (comparison < 0) {
        node = node.left;
      } else {
        rank += sizeOf(node.left) + 1;
        node = node.right;
      }
    }
    return -1;
  }

  /**
   * O(log n + k): descends to the lower bound, then takes k in-order successor steps and
   * materializes the entries before returning the snapshot iterator.
   */
  range(lo?: K, hi?: K, options?: RangeOptions<K>): IterableIterator<[K, V]> {
    this.assertLive();
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
    let node = lo === undefined ? this.minNodeInternal() : this.lowerBoundNode(lo, loInclusive);
    while (node !== null) {
      if (hi !== undefined) {
        const comparison = this.compare(node.key, hi);
        if (comparison > 0 || (comparison === 0 && !hiInclusive)) {
          break;
        }
      }
      entries.push([node.key, node.value]);
      node = this.successorNodeInternal(node);
    }
    return this.snapshotIterator(entries);
  }

  /** O(n): in-order snapshot of the keys. */
  keys(): IterableIterator<K> {
    return this.snapshotIterator(this.toArray().map((entry) => entry[0]));
  }

  /** O(n): in-order snapshot of the values. */
  values(): IterableIterator<V> {
    return this.snapshotIterator(this.toArray().map((entry) => entry[1]));
  }

  /** O(n): in-order snapshot iterator. */
  entries(): IterableIterator<[K, V]> {
    return this.snapshotIterator(this.toArray());
  }

  /** O(n): iterative in-order walk into one fresh array. */
  override toArray(): Array<[K, V]> {
    this.assertLive();
    const entries: Array<[K, V]> = [];
    const stack: Array<RedBlackNode<K, V>> = [];
    let node = this._root;
    while (node !== null || stack.length > 0) {
      while (node !== null) {
        stack.push(node);
        node = node.left;
      }
      const current = stack.pop() as RedBlackNode<K, V>;
      entries.push([current.key, current.value]);
      node = current.right;
    }
    return entries;
  }

  /** Same as entries(): materialized O(n) in-order snapshot. */
  override [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }

  /** O(1): drops the root and invalidates every live snapshot iterator. */
  override clear(): void {
    this.assertLive();
    this._root = null;
    this._size = 0;
    this.touch();
  }

  /** O(n): dumps the sorted entry list; deserialization rebuilds a balanced tree. */
  serialize(): string {
    this.assertLive();
    return serializeAvlEntries("RedBlackTree", this.toArray());
  }

  /** O(n log n): parses the entry list and inserts it median-first, producing a balanced tree. */
  static deserialize<K, V>(
    json: unknown,
    compare?: Comparator<K>,
  ): RedBlackTree<K, V> {
    const entries = readAvlEntries<K, V>(json, "RedBlackTree");
    const tree = new RedBlackTree<K, V>(compare);
    insertBalanced(tree, entries);
    return tree;
  }

  /**
   * O(log n): requires every key in this tree to be smaller than every key in `other`. Both inputs
   * are consumed; the returned tree owns the union and uses this tree's comparator.
   */
  join(other: BalancedTree<K, V>): RedBlackTree<K, V> {
    this.assertLive();
    if (!(other instanceof RedBlackTree)) {
      throw new UnsupportedError("RedBlackTree can only join another RedBlackTree");
    }
    other.assertLive();
    if (other === this) {
      throw new TypeError("cannot join a tree with itself");
    }
    if (this._root !== null && other._root !== null) {
      const leftMax = this.maximumNode(this._root);
      const rightMin = this.minimumNode(other._root);
      if (this.compare(leftMax.key, rightMin.key) >= 0) {
        throw new TypeError(
          "join requires every key in the receiver to be smaller than every key in other",
        );
      }
    }

    const totalSize = this._size + other._size;
    let separator: RedBlackNode<K, V> | null = null;
    if (this._root !== null) {
      const maxNode = this.maximumNode(this._root);
      separator = new RedBlackNode(maxNode.key, maxNode.value, null);
      this.delete(maxNode.key);
    } else if (other._root !== null) {
      const minNode = this.minimumNode(other._root);
      separator = new RedBlackNode(minNode.key, minNode.value, null);
      other.delete(minNode.key);
    }

    const root =
      separator === null
        ? null
        : joinNode(this._root, separator, other._root, this.compare);
    this.markConsumed();
    other.markConsumed();
    return RedBlackTree.fromParts(root, totalSize, this.compare);
  }

  /**
   * O(log n): consumes the receiver and returns `[< key, >= key]` as fresh trees that share its
   * comparator and ownership of the original nodes.
   */
  split(key: K): [RedBlackTree<K, V>, RedBlackTree<K, V>] {
    this.assertLive();
    assertDefined(key, "key");
    const [leftRoot, rightRoot] = splitRoots(this._root, key, this.compare);
    const left = RedBlackTree.fromParts(leftRoot, sizeOf(leftRoot), this.compare);
    const right = RedBlackTree.fromParts(rightRoot, sizeOf(rightRoot), this.compare);
    this.markConsumed();
    return [left, right];
  }

  /**
   * O(n): iterative in-order validation of ordering, parent links, cached heights/sizes/black
   * heights, root color, red-red edges, and equal black-height on both sides of every node.
   */
  override validate(): true | string {
    this.assertLive();
    if (this._root === null) {
      return this._size === 0 ? true : "non-empty size with empty root";
    }
    if (this._root.parent !== null) {
      return "root has a parent";
    }
    if (this._root.color !== BLACK) {
      return "root is red";
    }
    const stack: Array<RedBlackNode<K, V>> = [];
    const seen = new Set<RedBlackNode<K, V>>();
    let node: RedBlackNode<K, V> | null = this._root;
    let previous: RedBlackNode<K, V> | null = null;
    let count = 0;
    while (node !== null || stack.length > 0) {
      while (node !== null) {
        if (seen.has(node)) {
          return "cycle detected in left links";
        }
        seen.add(node);
        stack.push(node);
        node = node.left;
      }
      const current = stack.pop() as RedBlackNode<K, V>;
      count++;
      if (count > this._size) {
        return "tree contains more nodes than size";
      }
      if (current.key === undefined || current.value === undefined) {
        return `node at index ${count - 1} has an undefined key or value`;
      }
      if (current.left !== null && current.left.parent !== current) {
        return `left child of node at index ${count - 1} has an incorrect parent link`;
      }
      if (current.right !== null && current.right.parent !== current) {
        return `right child of node at index ${count - 1} has an incorrect parent link`;
      }
      const leftHeight = heightOf(current.left);
      const rightHeight = heightOf(current.right);
      if (current.height !== 1 + Math.max(leftHeight, rightHeight)) {
        return `node at index ${count - 1} has a stale height`;
      }
      const expectedSize = 1 + sizeOf(current.left) + sizeOf(current.right);
      if (current.size !== expectedSize) {
        return `node at index ${count - 1} has a stale subtree size`;
      }
      if (current.color === RED) {
        if (colorOf(current.left) === RED || colorOf(current.right) === RED) {
          return `node at index ${count - 1} has a red child`;
        }
      }
      const leftBlackHeight = blackHeightOf(current.left);
      const rightBlackHeight = blackHeightOf(current.right);
      if (leftBlackHeight !== rightBlackHeight) {
        return `node at index ${count - 1} has unequal black heights`;
      }
      const expectedBlackHeight =
        leftBlackHeight + (current.color === BLACK ? 1 : 0);
      if (current.blackHeight !== expectedBlackHeight) {
        return `node at index ${count - 1} has a stale black height`;
      }
      if (previous !== null && this.compare(previous.key, current.key) >= 0) {
        return "binary search tree ordering is violated";
      }
      previous = current;
      node = current.right;
    }
    if (count !== this._size) {
      return `size ${this._size} does not match node count ${count}`;
    }
    return true;
  }

  /** O(1): creates a tree that adopts `root`; used by join and split. */
  private static fromParts<K, V>(
    root: RedBlackNode<K, V> | null,
    size: number,
    compare: Comparator<K>,
  ): RedBlackTree<K, V> {
    const tree = new RedBlackTree<K, V>(compare);
    tree._root = root;
    tree._size = size;
    if (root !== null) {
      root.parent = null;
      root.color = BLACK;
    }
    return tree;
  }

  /** O(1): rejects any use after join/split consumed this tree. */
  private assertLive(): void {
    if (this._consumed) {
      throw new ConsumedError();
    }
  }

  /** O(1): transfers ownership of every node and invalidates the receiver. */
  private markConsumed(): void {
    this._consumed = true;
    this._root = null;
    this._size = 0;
    this.touch();
  }

  /** O(log n): comparator descent returning the live node or null. */
  private findNode(key: K): RedBlackNode<K, V> | null {
    let node = this._root;
    while (node !== null) {
      const comparison = this.compare(key, node.key);
      if (comparison === 0) {
        return node;
      }
      node = comparison < 0 ? node.left : node.right;
    }
    return null;
  }

  /** O(log n): left-spine walk. */
  private minNodeInternal(): RedBlackNode<K, V> | null {
    return this._root === null ? null : this.minimumNode(this._root);
  }

  /** O(log n): right-spine walk. */
  private maxNodeInternal(): RedBlackNode<K, V> | null {
    return this._root === null ? null : this.maximumNode(this._root);
  }

  /** O(h): leftmost node of a subtree. */
  private minimumNode(node: RedBlackNode<K, V>): RedBlackNode<K, V> {
    let current = node;
    while (current.left !== null) {
      current = current.left;
    }
    return current;
  }

  /** O(h): rightmost node of a subtree. */
  private maximumNode(node: RedBlackNode<K, V>): RedBlackNode<K, V> {
    let current = node;
    while (current.right !== null) {
      current = current.right;
    }
    return current;
  }

  /** O(h) worst case; amortized O(1) across a full in-order sweep. */
  private successorNodeInternal(node: RedBlackNode<K, V>): RedBlackNode<K, V> | null {
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

  /** O(log n): first node whose key satisfies the lower bound. */
  private lowerBoundNode(key: K, inclusive: boolean): RedBlackNode<K, V> | null {
    let node = this._root;
    let best: RedBlackNode<K, V> | null = null;
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
