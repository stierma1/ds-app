import test from "node:test";
import assert from "node:assert/strict";
import {
  ConcurrentModificationError,
  GeneralTree,
} from "../../src/index.ts";
import type { TreeNode } from "../../src/trees/types.ts";

function buildTree(): {
  tree: GeneralTree<number>;
  root: TreeNode<number>;
  nodes: Map<number, TreeNode<number>>;
} {
  const tree = new GeneralTree<number>();
  const nodes = new Map<number, TreeNode<number>>();
  const root = tree.addChild(null, 1);
  nodes.set(1, root);
  for (const value of [2, 3, 4]) {
    nodes.set(value, tree.addChild(root, value));
  }
  for (const value of [5, 6]) {
    nodes.set(value, tree.addChild(nodes.get(2)!, value));
  }
  nodes.set(7, tree.addChild(nodes.get(4)!, 7));
  return { tree, root, nodes };
}

test("GeneralTree child and sibling links", () => {
  const { tree, root, nodes } = buildTree();
  assert.equal(tree.size, 7);
  assert.equal(tree.height, 2);
  assert.equal(tree.parent(nodes.get(5)!), nodes.get(2));
  assert.equal(tree.parent(root), null);
  assert.deepEqual(
    [...tree.children(root)].map((node) => node.value),
    [2, 3, 4],
  );
  assert.deepEqual([...tree.children(nodes.get(2)!)].map((node) => node.value), [5, 6]);
  assert.equal(tree.degree(root), 3);
  assert.equal(tree.degree(nodes.get(2)!), 2);
  assert.equal(tree.degree(nodes.get(3)!), 0);
  assert.deepEqual([...tree.preorder()], [1, 2, 5, 6, 3, 4, 7]);
  assert.deepEqual([...tree.postorder()], [5, 6, 2, 3, 7, 4, 1]);
  assert.deepEqual([...tree.levelOrder()], [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(tree.toArray(), [1, 2, 5, 6, 3, 4, 7]);
  assert.deepEqual([...tree], [1, 2, 5, 6, 3, 4, 7]);
  assert.equal(tree.validate(), true);
});

test("GeneralTree removes subtrees and the root", () => {
  const { tree, root, nodes } = buildTree();
  assert.equal(tree.remove(nodes.get(2)!), true);
  assert.equal(tree.size, 4);
  assert.deepEqual([...tree.preorder()], [1, 3, 4, 7]);
  assert.equal(tree.validate(), true);
  assert.throws(() => tree.parent(nodes.get(5)!), TypeError);

  assert.equal(tree.remove(nodes.get(7)!), true);
  assert.deepEqual([...tree.preorder()], [1, 3, 4]);
  assert.equal(tree.validate(), true);

  assert.equal(tree.remove(root), true);
  assert.equal(tree.size, 0);
  assert.equal(tree.isEmpty(), true);
  assert.equal(tree.validate(), true);
});

test("GeneralTree argument validation", () => {
  const { tree, root } = buildTree();
  assert.throws(() => tree.addChild(null, 8), RangeError);
  assert.throws(() => tree.addChild(root, undefined as never), TypeError);
  const other = new GeneralTree<number>();
  const foreign = other.addChild(null, 99);
  assert.throws(() => tree.parent(foreign), TypeError);
  assert.throws(() => tree.children(foreign), TypeError);
  assert.throws(() => tree.remove(foreign), TypeError);
});

test("GeneralTree iterators are invalidated by mutation", () => {
  const { tree, nodes } = buildTree();
  const iterator = tree.preorder();
  assert.deepEqual(iterator.next(), { done: false, value: 1 });
  tree.remove(nodes.get(3)!);
  assert.throws(() => iterator.next(), ConcurrentModificationError);
  assert.equal(tree.validate(), true);
});

test("GeneralTree traverses a deep chain without recursion", () => {
  const tree = new GeneralTree<number>();
  let parent = tree.addChild(null, 0);
  const depth = 20000;
  for (let i = 1; i <= depth; i++) {
    parent = tree.addChild(parent, i);
  }
  assert.equal(tree.size, depth + 1);
  assert.equal(tree.height, depth);
  assert.equal([...tree.preorder()].length, depth + 1);
  assert.equal([...tree.postorder()][0], depth);
  assert.equal([...tree.levelOrder()][0], 0);
  assert.equal(tree.validate(), true);
});
