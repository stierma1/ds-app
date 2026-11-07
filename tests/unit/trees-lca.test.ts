import test from "node:test";
import assert from "node:assert/strict";
import {
  BinarySearchTree,
  BinaryTree,
  ConcurrentModificationError,
  GeneralTree,
  buildLca,
  makeNode,
} from "../../src/index.ts";
import type { TreeNode } from "../../src/trees/types.ts";

function findNode(root: TreeNode<number> | null, value: number): TreeNode<number> {
  const stack: TreeNode<number>[] = root === null ? [] : [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.value === value) {
      return node;
    }
    if (node.left !== null) stack.push(node.left);
    if (node.right !== null) stack.push(node.right);
  }
  throw new Error(`missing node ${value}`);
}

function findBstNode(
  root: TreeNode<[number, string]> | null,
  key: number,
): TreeNode<[number, string]> {
  const stack: Array<TreeNode<[number, string]>> = root === null ? [] : [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.value[0] === key) {
      return node;
    }
    if (node.left !== null) stack.push(node.left);
    if (node.right !== null) stack.push(node.right);
  }
  throw new Error(`missing BST node ${key}`);
}

function parentMap(root: TreeNode<number>): Map<TreeNode<number>, TreeNode<number> | null> {
  const parents = new Map<TreeNode<number>, TreeNode<number> | null>();
  const stack: Array<[TreeNode<number>, TreeNode<number> | null]> = [[root, null]];
  while (stack.length > 0) {
    const [node, parent] = stack.pop()!;
    parents.set(node, parent);
    if (node.left !== null) stack.push([node.left, node]);
    if (node.right !== null) stack.push([node.right, node]);
  }
  return parents;
}

function naiveLca(
  a: TreeNode<number>,
  b: TreeNode<number>,
  parents: Map<TreeNode<number>, TreeNode<number> | null>,
): TreeNode<number> {
  const ancestors = new Set<TreeNode<number>>();
  let node: TreeNode<number> | null = a;
  while (node !== null) {
    ancestors.add(node);
    node = parents.get(node) ?? null;
  }
  node = b;
  while (node !== null) {
    if (ancestors.has(node)) {
      return node;
    }
    node = parents.get(node) ?? null;
  }
  throw new Error("nodes are not connected");
}

test("buildLca agrees with a parent-walk reference on binary trees", () => {
  const tree = BinaryTree.fromComplete([1, 2, 3, 4, 5, 6, 7]);
  const parents = parentMap(tree.root!);
  const nodes = [1, 2, 3, 4, 5, 6, 7].map((value) => findNode(tree.root, value));
  for (const method of ["euler-rmq", "binary-lifting"] as const) {
    const lca = buildLca(tree, method);
    assert.equal(lca.size, 7);
    assert.equal(lca.validate(), true);
    for (const a of nodes) {
      for (const b of nodes) {
        assert.equal(lca.lca(a, b), naiveLca(a, b, parents));
        assert.equal(lca.depth(a), parentsDepth(a, parents));
      }
    }
    const four = findNode(tree.root, 4);
    const seven = findNode(tree.root, 7);
    const root = findNode(tree.root, 1);
    assert.equal(lca.distance(four, seven), 4);
    assert.equal(lca.isAncestor(root, seven), true);
    assert.equal(lca.isAncestor(four, seven), false);
    assert.equal(lca.isAncestor(four, four), true);
    assert.equal(lca.lca(four, four), four);
  }
});

function parentsDepth(
  node: TreeNode<number>,
  parents: Map<TreeNode<number>, TreeNode<number> | null>,
): number {
  let depth = 0;
  let current = parents.get(node) ?? null;
  while (current !== null) {
    depth++;
    current = parents.get(current) ?? null;
  }
  return depth;
}

test("buildLca works on general trees", () => {
  const tree = new GeneralTree<number>();
  const root = tree.addChild(null, 1);
  const two = tree.addChild(root, 2);
  const three = tree.addChild(root, 3);
  const five = tree.addChild(two, 5);
  const six = tree.addChild(two, 6);
  const seven = tree.addChild(three, 7);
  const eight = tree.addChild(seven, 8);
  for (const method of ["euler-rmq", "binary-lifting"] as const) {
    const lca = buildLca(tree, method);
    assert.equal(lca.size, 7);
    assert.equal(lca.validate(), true);
    assert.equal(lca.lca(five, six), two);
    assert.equal(lca.lca(five, eight), root);
    assert.equal(lca.lca(seven, eight), seven);
    assert.equal(lca.distance(five, eight), 5);
    assert.equal(lca.isAncestor(two, six), true);
    assert.equal(lca.isAncestor(six, two), false);
  }
});

test("buildLca invalidates after mutation", () => {
  const tree = new BinarySearchTree<number, string>((a, b) => a - b);
  for (const key of [5, 2, 8, 1, 3, 7, 9, 10]) {
    tree.set(key, `v${key}`);
  }
  const lca = buildLca(tree);
  const first = findBstNode(tree.root, 1);
  const fifth = findBstNode(tree.root, 5);
  assert.equal(lca.lca(first, fifth), fifth);
  tree.set(11, "v11");
  assert.throws(() => lca.lca(first, fifth), ConcurrentModificationError);
  assert.throws(() => lca.depth(first), ConcurrentModificationError);
  assert.throws(() => lca.isAncestor(fifth, first), ConcurrentModificationError);
});

test("buildLca rejects foreign nodes and empty trees", () => {
  const first = BinaryTree.fromComplete([1, 2, 3]);
  const second = BinaryTree.fromComplete([4, 5, 6]);
  const lca = buildLca(first);
  assert.throws(() => lca.lca(findNode(first.root, 1), findNode(second.root, 4)), TypeError);
  assert.throws(() => lca.depth(findNode(second.root, 5)), TypeError);

  const empty = new BinaryTree<number>();
  const emptyLca = buildLca(empty);
  assert.equal(emptyLca.size, 0);
  assert.equal(emptyLca.validate(), true);
  assert.throws(() => emptyLca.lca(makeNode(1), makeNode(2)), TypeError);
});

test("buildLca handles deep chains", () => {
  const root = makeNode(0);
  let current = root;
  const depth = 10000;
  for (let i = 1; i <= depth; i++) {
    const child = makeNode(i, current);
    current.right = child;
    current = child;
  }
  const tree = new BinaryTree(root);
  const deepest = current;
  const middle = findNode(root, Math.floor(depth / 2));
  for (const method of ["euler-rmq", "binary-lifting"] as const) {
    const lca = buildLca(tree, method);
    assert.equal(lca.lca(root, deepest), root);
    assert.equal(lca.lca(middle, deepest), middle);
    assert.equal(lca.distance(root, deepest), depth);
    assert.equal(lca.validate(), true);
  }
});
