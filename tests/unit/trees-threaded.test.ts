import test from "node:test";
import assert from "node:assert/strict";
import {
  BinarySearchTree,
  ThreadedBinaryTree,
} from "../../src/index.ts";
import type { TreeNode } from "../../src/trees/types.ts";

function makeThreaded(keys: number[]): ThreadedBinaryTree<number, string> {
  const tree = new ThreadedBinaryTree<number, string>((a, b) => a - b);
  for (const key of keys) {
    tree.set(key, `v${key}`);
  }
  return tree;
}

function inorderKeys(tree: ThreadedBinaryTree<number, string>): number[] {
  return [...tree.keys()];
}

function successorChain(tree: ThreadedBinaryTree<number, string>): number[] {
  const values: number[] = [];
  let node: TreeNode<[number, string]> | null = tree.minNode();
  while (node !== null) {
    values.push(node.value[0]);
    node = tree.successorNode(node);
    if (values.length > tree.size) {
      throw new Error("successor chain cycle");
    }
  }
  return values;
}

function predecessorChain(tree: ThreadedBinaryTree<number, string>): number[] {
  const values: number[] = [];
  let node: TreeNode<[number, string]> | null = tree.maxNode();
  while (node !== null) {
    values.push(node.value[0]);
    node = tree.predecessorNode(node);
    if (values.length > tree.size) {
      throw new Error("predecessor chain cycle");
    }
  }
  return values;
}

test("ThreadedBinaryTree threads match inorder order", () => {
  const keys = [50, 20, 80, 10, 30, 70, 90, 25, 35, 65, 85];
  const tree = makeThreaded(keys);
  const expected = [...keys].sort((a, b) => a - b);
  assert.deepEqual(inorderKeys(tree), expected);
  assert.deepEqual(successorChain(tree), expected);
  assert.deepEqual(predecessorChain(tree), [...expected].reverse());
  assert.equal(tree.predecessorNode(tree.minNode()!), null);
  assert.equal(tree.successorNode(tree.maxNode()!), null);
  assert.equal(tree.validate(), true);
});

test("ThreadedBinaryTree maintains threads through deletion", () => {
  const tree = makeThreaded([50, 20, 80, 10, 30, 70, 90, 25, 35, 65, 85]);
  for (const key of [10, 90, 50, 80, 20, 65]) {
    assert.equal(tree.delete(key), true);
    assert.equal(tree.validate(), true);
    const expected = inorderKeys(tree);
    assert.deepEqual(successorChain(tree), expected);
    assert.deepEqual(predecessorChain(tree), [...expected].reverse());
  }
  assert.deepEqual(inorderKeys(tree), [25, 30, 35, 70, 85]);
});

test("ThreadedBinaryTree matches plain BST under random operations", () => {
  const threaded = new ThreadedBinaryTree<number, string>((a, b) => a - b);
  const plain = new BinarySearchTree<number, string>((a, b) => a - b);
  let state = 19;
  const random = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };

  for (let step = 0; step < 600; step++) {
    const key = Math.floor(random() * 50);
    if (random() < 0.65) {
      threaded.set(key, `v${step}`);
      plain.set(key, `v${step}`);
    } else {
      assert.equal(threaded.delete(key), plain.delete(key));
    }
    assert.equal(threaded.validate(), true);
    assert.deepEqual(threaded.toArray(), plain.toArray());
  }
});

test("ThreadedBinaryTree rejects nodes from another tree", () => {
  const first = makeThreaded([1, 2, 3]);
  const second = makeThreaded([4, 5, 6]);
  assert.throws(() => first.successorNode(second.root!), TypeError);
  assert.throws(() => first.predecessorNode(second.root!), TypeError);
});
