import test from "node:test";
import assert from "node:assert/strict";
import {
  ArrayDeque,
  ArrayQueue,
  ArrayStack,
  LinkedQueue,
} from "../../src/index.ts";

test("ArrayDeque wraps around and grows", () => {
  const deque = new ArrayDeque<number>();
  for (let i = 0; i < 100; i++) {
    deque.pushBack(i);
    deque.pushFront(-i);
  }
  assert.equal(deque.size, 200);
  assert.equal(deque.front(), -99);
  assert.equal(deque.back(), 99);
  for (let i = 0; i < 50; i++) {
    assert.equal(deque.popFront(), -99 + i);
    assert.equal(deque.popBack(), 99 - i);
  }
  assert.equal(deque.size, 100);
  assert.equal(deque.validate(), true);
});

test("ArrayDeque shrinks without losing order", () => {
  const deque = new ArrayDeque<number>();
  for (let i = 0; i < 64; i++) {
    deque.pushBack(i);
  }
  for (let i = 0; i < 60; i++) {
    assert.equal(deque.popFront(), i);
  }
  assert.deepEqual(deque.toArray(), [60, 61, 62, 63]);
  for (let i = 1; i <= 3; i++) {
    deque.pushFront(-i);
  }
  assert.deepEqual(deque.toArray(), [-3, -2, -1, 60, 61, 62, 63]);
  assert.equal(deque.validate(), true);
});

test("ArrayDeque supports indexed and positional operations", () => {
  const deque = new ArrayDeque<string>();
  deque.pushBack("b");
  deque.pushFront("a");
  deque.insert(2, "c");
  assert.deepEqual(deque.toArray(), ["a", "b", "c"]);
  assert.equal(deque.get(1), "b");
  assert.equal(deque.set(1, "B"), "b");
  assert.equal(deque.remove(1), "B");
  assert.deepEqual(deque.toArray(), ["a", "c"]);
  assert.equal(deque.get(-1), undefined);
  assert.equal(deque.remove(10), undefined);
  assert.throws(() => deque.insert(3, "x"), RangeError);
  assert.throws(() => deque.get(0.5), TypeError);
  deque.reverse();
  assert.deepEqual(deque.toArray(), ["c", "a"]);
  deque.sort();
  assert.deepEqual(deque.toArray(), ["a", "c"]);
  assert.equal(deque.validate(), true);
});

test("ArrayDeque empty operations and validation", () => {
  const deque = new ArrayDeque<number>();
  assert.equal(deque.popBack(), undefined);
  assert.equal(deque.popFront(), undefined);
  assert.equal(deque.front(), undefined);
  assert.equal(deque.back(), undefined);
  assert.equal(deque.isEmpty(), true);
  assert.equal(deque.validate(), true);
  deque.pushBack(1);
  assert.equal(deque.validate(), true);
  deque.clear();
  assert.equal(deque.size, 0);
  assert.equal(deque.validate(), true);
});

test("ArrayStack behaves as LIFO", () => {
  const stack = new ArrayStack<number>();
  stack.push(1);
  stack.push(2);
  assert.equal(stack.peek(), 2);
  assert.equal(stack.pop(), 2);
  assert.equal(stack.pop(), 1);
  assert.equal(stack.pop(), undefined);
  assert.equal(stack.size, 0);
  assert.deepEqual(stack.toArray(), []);
  assert.equal(stack.validate(), true);
});

test("ArrayQueue behaves as FIFO across wrap-around", () => {
  const queue = new ArrayQueue<number>();
  for (let i = 0; i < 40; i++) {
    queue.enqueue(i);
  }
  for (let i = 0; i < 20; i++) {
    assert.equal(queue.dequeue(), i);
  }
  for (let i = 40; i < 60; i++) {
    queue.enqueue(i);
  }
  assert.equal(queue.peek(), 20);
  assert.deepEqual(queue.toArray().slice(0, 3), [20, 21, 22]);
  assert.equal(queue.size, 40);
  assert.equal(queue.validate(), true);
  queue.clear();
  assert.equal(queue.dequeue(), undefined);
});

test("LinkedQueue behaves as FIFO", () => {
  const queue = new LinkedQueue<number>();
  assert.equal(queue.dequeue(), undefined);
  assert.equal(queue.peek(), undefined);
  for (let i = 0; i < 10; i++) {
    queue.enqueue(i);
  }
  assert.equal(queue.peek(), 0);
  assert.deepEqual(queue.toArray(), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (let i = 0; i < 10; i++) {
    assert.equal(queue.dequeue(), i);
    assert.equal(queue.validate(), true);
  }
  assert.equal(queue.isEmpty(), true);
  assert.throws(() => queue.enqueue(undefined as never), TypeError);
});
