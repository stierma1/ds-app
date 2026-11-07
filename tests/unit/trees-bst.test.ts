import test from "node:test";
import assert from "node:assert/strict";
import { BinarySearchTree, ConcurrentModificationError } from "../../src/index.ts";

function makeTree(): BinarySearchTree<number, string> {
  const tree = new BinarySearchTree<number, string>((a, b) => a - b);
  for (const key of [5, 2, 8, 1, 9, 3, 7]) {
    tree.set(key, `v${key}`);
  }
  return tree;
}

test("BinarySearchTree basics and ordering", () => {
  const tree = makeTree();
  assert.equal(tree.size, 7);
  assert.equal(tree.isEmpty(), false);
  assert.equal(tree.root!.value[0], 5);
  assert.equal(tree.height, 2);
  assert.deepEqual([...tree.keys()], [1, 2, 3, 5, 7, 8, 9]);
  assert.deepEqual([...tree.values()], ["v1", "v2", "v3", "v5", "v7", "v8", "v9"]);
  assert.deepEqual(tree.toArray(), [
    [1, "v1"],
    [2, "v2"],
    [3, "v3"],
    [5, "v5"],
    [7, "v7"],
    [8, "v8"],
    [9, "v9"],
  ]);
  assert.equal(tree.get(5), "v5");
  assert.equal(tree.get(4), undefined);
  assert.equal(tree.has(9), true);
  assert.equal(tree.has(4), false);
  assert.deepEqual(tree.min(), [1, "v1"]);
  assert.deepEqual(tree.max(), [9, "v9"]);
  assert.deepEqual(tree.predecessor(5), [3, "v3"]);
  assert.deepEqual(tree.successor(5), [7, "v7"]);
  assert.deepEqual(tree.predecessor(4), [3, "v3"]);
  assert.deepEqual(tree.successor(4), [5, "v5"]);
  assert.equal(tree.predecessor(1), undefined);
  assert.equal(tree.successor(9), undefined);
  assert.deepEqual(tree.minNode()!.value, [1, "v1"]);
  assert.deepEqual(tree.maxNode()!.value, [9, "v9"]);
  assert.equal(tree.validate(), true);
});

test("BinarySearchTree order statistics", () => {
  const tree = makeTree();
  assert.deepEqual(tree.at(0), [1, "v1"]);
  assert.deepEqual(tree.at(3), [5, "v5"]);
  assert.deepEqual(tree.at(6), [9, "v9"]);
  assert.equal(tree.at(-1), undefined);
  assert.equal(tree.at(7), undefined);
  assert.throws(() => tree.at(0.5), TypeError);
  assert.equal(tree.indexOf(1), 0);
  assert.equal(tree.indexOf(5), 3);
  assert.equal(tree.indexOf(9), 6);
  assert.equal(tree.indexOf(4), -1);
});

test("BinarySearchTree range bounds", () => {
  const tree = makeTree();
  assert.deepEqual([...tree.range()].map((entry) => entry[0]), [1, 2, 3, 5, 7, 8, 9]);
  assert.deepEqual([...tree.range(3, 7)].map((entry) => entry[0]), [3, 5, 7]);
  assert.deepEqual(
    [...tree.range(3, 7, { lo: "exclusive", hi: "exclusive" })].map((entry) => entry[0]),
    [5],
  );
  assert.deepEqual([...tree.range(undefined, 3)].map((entry) => entry[0]), [1, 2, 3]);
  assert.deepEqual([...tree.range(7, undefined)].map((entry) => entry[0]), [7, 8, 9]);
  assert.deepEqual([...tree.range(7, 3)], []);
  assert.throws(() => tree.range(1, 2, { lo: "bad" as never }), TypeError);
  assert.throws(() => tree.range(1, 2, { hi: "bad" as never }), TypeError);
});

test("BinarySearchTree traversals", () => {
  const tree = makeTree();
  assert.deepEqual([...tree.preorder()].map((entry) => entry[0]), [5, 2, 1, 3, 8, 7, 9]);
  assert.deepEqual([...tree.inorder()].map((entry) => entry[0]), [1, 2, 3, 5, 7, 8, 9]);
  assert.deepEqual([...tree.postorder()].map((entry) => entry[0]), [1, 3, 2, 7, 9, 8, 5]);
  assert.deepEqual([...tree.levelOrder()].map((entry) => entry[0]), [5, 2, 8, 1, 3, 7, 9]);
  assert.deepEqual([...tree.entries()].map((entry) => entry[0]), [1, 2, 3, 5, 7, 8, 9]);
  assert.equal([...tree.eulerTour()].length, 13);
  assert.equal(tree.validate(), true);
});

test("BinarySearchTree replaces values for equal keys", () => {
  const tree = makeTree();
  tree.set(5, "updated");
  assert.equal(tree.size, 7);
  assert.equal(tree.get(5), "updated");
  assert.deepEqual(tree.at(3), [5, "updated"]);
  assert.equal(tree.validate(), true);
});

test("BinarySearchTree node navigation", () => {
  const tree = makeTree();
  const root = tree.root!;
  assert.deepEqual(tree.predecessorNode(root)?.value, [3, "v3"]);
  assert.deepEqual(tree.successorNode(root)?.value, [7, "v7"]);
  assert.equal(tree.predecessorNode(tree.minNode()!), null);
  assert.equal(tree.successorNode(tree.maxNode()!), null);
  assert.equal(tree.validate(), true);
});

test("BinarySearchTree deletion covers every shape", () => {
  const tree = makeTree();
  assert.equal(tree.delete(1), true);
  assert.equal(tree.validate(), true);
  assert.equal(tree.delete(9), true);
  assert.equal(tree.validate(), true);
  assert.equal(tree.delete(7), true);
  assert.equal(tree.validate(), true);
  assert.equal(tree.delete(5), true);
  assert.equal(tree.validate(), true);
  assert.deepEqual([...tree.keys()], [2, 3, 8]);
  assert.equal(tree.delete(5), false);
  assert.equal(tree.size, 3);
  assert.equal(tree.validate(), true);
  tree.clear();
  assert.equal(tree.size, 0);
  assert.equal(tree.min(), undefined);
  assert.equal(tree.max(), undefined);
  assert.equal(tree.validate(), true);
});

test("BinarySearchTree iterators are invalidated by mutation", () => {
  const tree = makeTree();
  const iterator = tree.entries();
  assert.deepEqual(iterator.next(), { done: false, value: [1, "v1"] });
  tree.set(10, "v10");
  assert.throws(() => iterator.next(), ConcurrentModificationError);
});

test("BinarySearchTree differential test against sorted arrays", () => {
  const tree = new BinarySearchTree<number, string>((a, b) => a - b);
  const model = new Map<number, string>();
  let state = 7;
  const random = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const sortedKeys = (): number[] => [...model.keys()].sort((a, b) => a - b);

  for (let step = 0; step < 800; step++) {
    const key = Math.floor(random() * 40);
    const operation = Math.floor(random() * 8);
    if (operation <= 2) {
      const value = `v${step}`;
      tree.set(key, value);
      model.set(key, value);
    } else if (operation === 3) {
      assert.equal(tree.delete(key), model.delete(key));
    } else if (operation === 4) {
      assert.equal(tree.get(key), model.get(key));
      assert.equal(tree.has(key), model.has(key));
    } else if (operation === 5) {
      const keys = sortedKeys();
      const index = Math.floor(random() * (keys.length + 2)) - 1;
      const expected = index >= 0 && index < keys.length ? keys[index] : undefined;
      assert.equal(tree.at(index)?.[0], expected);
    } else if (operation === 6) {
      const keys = sortedKeys();
      assert.equal(tree.indexOf(key), keys.indexOf(key));
    } else {
      const keys = sortedKeys();
      const expectedMin =
        keys.length === 0 ? undefined : [keys[0], model.get(keys[0])];
      const expectedMax =
        keys.length === 0 ? undefined : [keys[keys.length - 1], model.get(keys[keys.length - 1])];
      assert.deepEqual(tree.min(), expectedMin);
      assert.deepEqual(tree.max(), expectedMax);
    }
    assert.equal(tree.validate(), true);
    assert.equal(tree.size, model.size);
    const keys = sortedKeys();
    assert.deepEqual([...tree.keys()], keys);
    assert.deepEqual(
      tree.toArray(),
      keys.map((item) => [item, model.get(item)]),
    );
  }
});
