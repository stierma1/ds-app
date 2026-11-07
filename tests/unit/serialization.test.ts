import test from "node:test";
import assert from "node:assert/strict";
import {
  ArrayDeque,
  ArrayQueue,
  ArrayStack,
  ArrayList,
  BinarySearchTree,
  BinaryTree,
  CircularList,
  CursorList,
  DoublyLinkedList,
  GeneralizedList,
  GeneralTree,
  LinkedQueue,
  OrderMaintenanceList,
  OrthogonalList,
  SinglyLinkedList,
  SortedLinkedList,
  SortedList,
  ThreadedBinaryTree,
  XorLinkedList,
  buildLca,
  deserializeLca,
} from "../../src/index.ts";
import type { TreeNode } from "../../src/trees/types.ts";

interface ListCheck {
  toArray(): unknown[];
  validate(): true | string;
  serialize(): string;
}

const listFactories: Array<
  [string, () => ListCheck, (json: unknown) => ListCheck]
> = [
  [
    "ArrayList",
    () => {
      const list = new ArrayList<number>();
      [3, 1, 2].forEach((value) => list.push(value));
      return list;
    },
    (json) => ArrayList.deserialize<number>(json),
  ],
  [
    "SinglyLinkedList",
    () => {
      const list = new SinglyLinkedList<number>();
      [3, 1, 2].forEach((value) => list.push(value));
      return list;
    },
    (json) => SinglyLinkedList.deserialize<number>(json),
  ],
  [
    "DoublyLinkedList",
    () => {
      const list = new DoublyLinkedList<number>();
      [3, 1, 2].forEach((value) => list.push(value));
      return list;
    },
    (json) => DoublyLinkedList.deserialize<number>(json),
  ],
  [
    "CircularList",
    () => {
      const list = new CircularList<number>();
      [3, 1, 2].forEach((value) => list.push(value));
      return list;
    },
    (json) => CircularList.deserialize<number>(json),
  ],
  [
    "CursorList",
    () => {
      const list = new CursorList<number>();
      [3, 1, 2].forEach((value) => list.push(value));
      return list;
    },
    (json) => CursorList.deserialize<number>(json),
  ],
  [
    "XorLinkedList",
    () => {
      const list = new XorLinkedList<number>();
      [3, 1, 2].forEach((value) => list.push(value));
      return list;
    },
    (json) => XorLinkedList.deserialize<number>(json),
  ],
  [
    "ArrayDeque",
    () => {
      const deque = new ArrayDeque<number>();
      [3, 1, 2].forEach((value) => deque.pushBack(value));
      return deque;
    },
    (json) => ArrayDeque.deserialize<number>(json),
  ],
  [
    "SortedList",
    () => {
      const list = new SortedList<number>();
      [3, 1, 2].forEach((value) => list.add(value));
      return list;
    },
    (json) => SortedList.deserialize<number>(json),
  ],
  [
    "SortedLinkedList",
    () => {
      const list = new SortedLinkedList<number>();
      [3, 1, 2].forEach((value) => list.add(value));
      return list;
    },
    (json) => SortedLinkedList.deserialize<number>(json),
  ],
  [
    "ArrayStack",
    () => {
      const stack = new ArrayStack<number>();
      [3, 1, 2].forEach((value) => stack.push(value));
      return stack;
    },
    (json) => ArrayStack.deserialize<number>(json),
  ],
  [
    "ArrayQueue",
    () => {
      const queue = new ArrayQueue<number>();
      [3, 1, 2].forEach((value) => queue.enqueue(value));
      return queue;
    },
    (json) => ArrayQueue.deserialize<number>(json),
  ],
  [
    "LinkedQueue",
    () => {
      const queue = new LinkedQueue<number>();
      [3, 1, 2].forEach((value) => queue.enqueue(value));
      return queue;
    },
    (json) => LinkedQueue.deserialize<number>(json),
  ],
  [
    "OrderMaintenanceList",
    () => {
      const list = new OrderMaintenanceList<number>();
      const first = list.insertAfter(null, 3);
      const second = list.insertAfter(first, 1);
      list.insertAfter(second, 2);
      return list;
    },
    (json) => OrderMaintenanceList.deserialize<number>(json),
  ],
];

for (const [name, create, deserialize] of listFactories) {
  test(`${name} serializes and deserializes through a JSON object`, () => {
    const original = create();
    const json = original.serialize();
    assert.equal(typeof json, "string");
    const parsed = JSON.parse(json);
    const restored = deserialize(parsed);
    assert.deepEqual(restored.toArray(), original.toArray());
    assert.equal(restored.validate(), true);
    const restoredFromString = deserialize(json);
    assert.deepEqual(restoredFromString.toArray(), original.toArray());
  });
}

test("empty containers round-trip", () => {
  assert.deepEqual(ArrayList.deserialize<number>(new ArrayList<number>().serialize()).toArray(), []);
  assert.deepEqual(CursorList.deserialize<number>(new CursorList<number>().serialize()).toArray(), []);
  assert.deepEqual(ArrayDeque.deserialize<number>(new ArrayDeque<number>().serialize()).toArray(), []);
  assert.deepEqual(
    BinaryTree.deserialize<number>(new BinaryTree<number>().serialize()).toArray(),
    [],
  );
  assert.deepEqual(
    BinarySearchTree.deserialize<number, string>(
      new BinarySearchTree<number, string>((a, b) => a - b).serialize(),
    ).toArray(),
    [],
  );
  assert.deepEqual(
    GeneralTree.deserialize<number>(new GeneralTree<number>().serialize()).toArray(),
    [],
  );
});

test("sorted structures deserialize with a custom comparator", () => {
  const descending = (a: number, b: number): number => b - a;
  const sorted = new SortedList<number>(descending);
  [5, 1, 3, 2, 4].forEach((value) => sorted.add(value));
  const restoredSorted = SortedList.deserialize<number>(sorted.serialize(), descending);
  assert.deepEqual(restoredSorted.toArray(), [5, 4, 3, 2, 1]);
  assert.equal(restoredSorted.validate(), true);

  const bst = new BinarySearchTree<number, string>(descending);
  [5, 1, 3, 2, 4].forEach((value) => bst.set(value, `v${value}`));
  const restoredBst = BinarySearchTree.deserialize<number, string>(
    bst.serialize(),
    descending,
  );
  assert.deepEqual(restoredBst.toArray(), bst.toArray());
  assert.equal(restoredBst.validate(), true);
});

test("sparse matrix variants round-trip", () => {
  const orthogonal = new OrthogonalList(3, 4);
  orthogonal.set(0, 1, 2);
  orthogonal.set(2, 3, 7);
  const restoredOrthogonal = OrthogonalList.deserialize(orthogonal.serialize());
  assert.ok(restoredOrthogonal instanceof OrthogonalList);
  assert.equal(restoredOrthogonal.rows, 3);
  assert.equal(restoredOrthogonal.cols, 4);
  assert.deepEqual(restoredOrthogonal.entries(), orthogonal.entries());
  assert.equal(restoredOrthogonal.validate(), true);

  const generalized = new GeneralizedList(2, 2);
  generalized.set(1, 0, 9);
  const restoredGeneralized = GeneralizedList.deserialize(generalized.serialize());
  assert.ok(restoredGeneralized instanceof GeneralizedList);
  assert.deepEqual(restoredGeneralized.entries(), generalized.entries());
  assert.equal(restoredGeneralized.validate(), true);
});

test("BinaryTree round-trips shape and ordering", () => {
  const tree = BinaryTree.fromComplete([1, 2, 3, 4, 5, 6, 7]);
  const restored = BinaryTree.deserialize<number>(tree.serialize());
  assert.equal(restored.size, 7);
  assert.equal(restored.height, 2);
  assert.deepEqual([...restored.preorder()], [...tree.preorder()]);
  assert.deepEqual([...restored.inorder()], [...tree.inorder()]);
  assert.deepEqual([...restored.postorder()], [...tree.postorder()]);
  assert.deepEqual([...restored.levelOrder()], [...tree.levelOrder()]);
  assert.deepEqual([...restored.eulerTour()], [...tree.eulerTour()]);
  assert.equal(restored.validate(), true);
});

test("BinaryTree serialization handles deep trees", () => {
  const tree = BinaryTree.fromComplete([0]);
  let current = tree.root!;
  for (let value = 1; value < 3000; value++) {
    const child: TreeNode<number> = {
      value,
      left: null,
      right: null,
      parent: current,
    };
    current.right = child;
    current = child;
  }
  const restored = BinaryTree.deserialize<number>(tree.serialize());
  assert.equal(restored.size, 3000);
  assert.equal(restored.height, 2999);
  assert.equal([...restored.preorder()][0], 0);
  assert.equal([...restored.postorder()][0], 2999);
  assert.equal(restored.validate(), true);
});

test("BinarySearchTree round-trips and rebuilds a balanced tree", () => {
  const tree = new BinarySearchTree<number, string>((a, b) => a - b);
  for (let key = 1; key <= 100; key++) {
    tree.set(key, `v${key}`);
  }
  assert.equal(tree.height, 99);
  const restored = BinarySearchTree.deserialize<number, string>(tree.serialize());
  assert.deepEqual(restored.toArray(), tree.toArray());
  assert.ok(restored.height < 10);
  assert.equal(restored.validate(), true);
  for (let index = 0; index < 100; index++) {
    assert.deepEqual(restored.at(index), tree.at(index));
  }
});

test("ThreadedBinaryTree round-trips and rebuilds threads", () => {
  const tree = new ThreadedBinaryTree<number, string>((a, b) => a - b);
  [50, 20, 80, 10, 30, 70, 90].forEach((key) => tree.set(key, `v${key}`));
  const restored = ThreadedBinaryTree.deserialize<number, string>(tree.serialize());
  assert.deepEqual(restored.toArray(), tree.toArray());
  assert.equal(restored.validate(), true);
  const seen: number[] = [];
  let node: TreeNode<[number, string]> | null = restored.minNode();
  while (node !== null) {
    seen.push(node.value[0]);
    node = restored.successorNode(node);
  }
  assert.deepEqual(seen, [10, 20, 30, 50, 70, 80, 90]);
});

test("GeneralTree round-trips child order", () => {
  const tree = new GeneralTree<number>();
  const root = tree.addChild(null, 1);
  const two = tree.addChild(root, 2);
  tree.addChild(root, 3);
  const four = tree.addChild(root, 4);
  tree.addChild(two, 5);
  tree.addChild(two, 6);
  tree.addChild(four, 7);
  const restored = GeneralTree.deserialize<number>(tree.serialize());
  assert.equal(restored.size, 7);
  assert.equal(restored.height, 2);
  assert.deepEqual([...restored.preorder()], [1, 2, 5, 6, 3, 4, 7]);
  assert.deepEqual([...restored.postorder()], [5, 6, 2, 3, 7, 4, 1]);
  assert.deepEqual([...restored.levelOrder()], [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(restored.validate(), true);
});

test("LowestCommonAncestor round-trips its snapshot", () => {
  const tree = BinaryTree.fromComplete([1, 2, 3, 4, 5, 6, 7]);
  const lca = buildLca(tree);
  const restored = deserializeLca<number>(lca.serialize());
  assert.equal(restored.size, lca.size);
  assert.equal(restored.validate(), true);
  const find = (value: number): TreeNode<number> => {
    const node = restored.nodes.find((candidate) => candidate.value === value);
    if (node === undefined) {
      throw new Error(`missing node ${value}`);
    }
    return node;
  };
  assert.equal(restored.lca(find(4), find(7)).value, 1);
  assert.equal(restored.lca(find(2), find(5)).value, 2);
  assert.equal(restored.depth(find(7)), 2);
  assert.equal(restored.distance(find(4), find(7)), 4);
  assert.equal(restored.isAncestor(find(1), find(7)), true);

  const empty = buildLca(new BinaryTree<number>());
  const restoredEmpty = deserializeLca<number>(empty.serialize());
  assert.equal(restoredEmpty.size, 0);
  assert.equal(restoredEmpty.validate(), true);
});

test("deserialization rejects malformed payloads", () => {
  assert.throws(() => ArrayList.deserialize("not json"), TypeError);
  assert.throws(
    () => ArrayList.deserialize({ type: "ArrayList", version: 2, values: [] }),
    TypeError,
  );
  assert.throws(
    () => ArrayList.deserialize({ type: "ArrayList", version: 1, values: [undefined] }),
    TypeError,
  );
  assert.throws(() => ArrayList.deserialize({ type: "DoublyLinkedList", version: 1, values: [] }), TypeError);
  assert.throws(
    () => BinaryTree.deserialize({ type: "BinaryTree", version: 1, nodes: [{ value: 1, parent: 0, side: null }] }),
    TypeError,
  );
  assert.throws(
    () => BinarySearchTree.deserialize({ type: "BinarySearchTree", version: 1, entries: [[1]] }),
    TypeError,
  );
  assert.throws(
    () => OrthogonalList.deserialize({ type: "OrthogonalList", version: 1, entries: [[0, 0]] }),
    TypeError,
  );
  assert.throws(
    () =>
      deserializeLca({
        type: "LowestCommonAncestor",
        version: 1,
        method: "euler-rmq",
        values: [1],
        parent: [0],
        children: [[]],
      }),
    TypeError,
  );
});

test("serialization rejects undefined tree values", () => {
  const tree = BinaryTree.fromComplete([1]);
  tree.root!.value = undefined as never;
  assert.throws(() => tree.serialize(), TypeError);
});
