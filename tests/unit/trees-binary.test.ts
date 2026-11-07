import test from "node:test";
import assert from "node:assert/strict";
import {
  BinaryTree,
  ConcurrentModificationError,
  makeNode,
} from "../../src/index.ts";

test("BinaryTree traversals match a complete tree", () => {
  const tree = BinaryTree.fromComplete([1, 2, 3, 4, 5, 6, 7]);
  assert.equal(tree.size, 7);
  assert.equal(tree.height, 2);
  assert.equal(tree.isEmpty(), false);
  assert.deepEqual([...tree.preorder()], [1, 2, 4, 5, 3, 6, 7]);
  assert.deepEqual([...tree.inorder()], [4, 2, 5, 1, 6, 3, 7]);
  assert.deepEqual([...tree.postorder()], [4, 5, 2, 6, 7, 3, 1]);
  assert.deepEqual([...tree.levelOrder()], [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual([...tree.eulerTour()], [1, 2, 4, 2, 5, 2, 1, 3, 6, 3, 7, 3, 1]);
  assert.deepEqual(tree.toArray(), [1, 2, 4, 5, 3, 6, 7]);
  assert.deepEqual([...tree], [1, 2, 4, 5, 3, 6, 7]);
  assert.equal(tree.validate(), true);
});

test("BinaryTree handles empty and single-node trees", () => {
  const empty = new BinaryTree<number>();
  assert.equal(empty.size, 0);
  assert.equal(empty.height, -1);
  assert.equal(empty.isEmpty(), true);
  assert.deepEqual([...empty.preorder()], []);
  assert.deepEqual([...empty.inorder()], []);
  assert.deepEqual([...empty.postorder()], []);
  assert.deepEqual([...empty.levelOrder()], []);
  assert.deepEqual([...empty.eulerTour()], []);
  assert.equal(empty.validate(), true);

  const single = BinaryTree.fromComplete([1]);
  assert.equal(single.size, 1);
  assert.equal(single.height, 0);
  assert.deepEqual([...single.preorder()], [1]);
  assert.deepEqual([...single.eulerTour()], [1]);
  assert.equal(single.validate(), true);
});

test("BinaryTree supports sparse complete input", () => {
  const tree = BinaryTree.fromComplete([1, null, 2, 3]);
  assert.equal(tree.size, 3);
  assert.equal(tree.height, 2);
  assert.deepEqual([...tree.preorder()], [1, 2, 3]);
  assert.deepEqual([...tree.inorder()], [1, 3, 2]);
  assert.deepEqual([...tree.postorder()], [3, 2, 1]);
  assert.equal(tree.validate(), true);
});

test("BinaryTree validate detects broken parent links", () => {
  const tree = BinaryTree.fromComplete([1, 2, 3]);
  tree.root!.left!.parent = null;
  assert.notEqual(tree.validate(), true);
});

test("BinaryTree iterators are invalidated by clear", () => {
  const tree = BinaryTree.fromComplete([1, 2, 3]);
  const iterator = tree.preorder();
  assert.deepEqual(iterator.next(), { done: false, value: 1 });
  tree.clear();
  assert.throws(() => iterator.next(), ConcurrentModificationError);
  assert.equal(tree.size, 0);
  assert.equal(tree.validate(), true);
});

test("BinaryTree traversals handle deep degenerate trees", () => {
  const root = makeNode(0);
  let current = root;
  const depth = 20000;
  for (let i = 1; i <= depth; i++) {
    const child = makeNode(i, current);
    current.right = child;
    current = child;
  }
  const tree = new BinaryTree(root);
  assert.equal(tree.size, depth + 1);
  assert.equal(tree.height, depth);
  assert.equal([...tree.preorder()].length, depth + 1);
  assert.equal([...tree.inorder()][0], 0);
  assert.equal([...tree.postorder()][0], depth);
  assert.equal([...tree.levelOrder()].length, depth + 1);
  assert.equal(tree.validate(), true);
});
