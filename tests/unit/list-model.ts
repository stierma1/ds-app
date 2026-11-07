import assert from "node:assert/strict";
import type { ListLike } from "../../src/lists/types.ts";

function randomGenerator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function assertListContract(list: ListLike<number>, seed = 1, steps = 500): void {
  const model: number[] = [];
  const random = randomGenerator(seed);
  let nextValue = 100;

  const validate = (): void => {
    assert.equal(list.validate(), true);
    assert.equal(list.size, model.length);
    assert.equal(list.isEmpty(), model.length === 0);
    assert.deepEqual(list.toArray(), model);
  };

  validate();

  for (let step = 0; step < steps; step++) {
    const operation = Math.floor(random() * 9);
    const value = nextValue++;
    if (operation === 0) {
      list.push(value);
      model.push(value);
    } else if (operation === 1) {
      assert.equal(list.pop(), model.pop());
    } else if (operation === 2) {
      list.unshift(value);
      model.unshift(value);
    } else if (operation === 3) {
      assert.equal(list.shift(), model.shift());
    } else if (operation === 4) {
      const index = Math.floor(random() * (model.length + 1));
      list.insert(index, value);
      model.splice(index, 0, value);
    } else if (operation === 5) {
      const index = Math.floor(random() * (model.length + 2)) - 1;
      const removed =
        index >= 0 && index < model.length ? model.splice(index, 1)[0] : undefined;
      assert.equal(list.remove(index), removed);
    } else if (operation === 6) {
      if (model.length > 0) {
        const index = Math.floor(random() * model.length);
        assert.equal(list.set(index, value), model[index]);
        model[index] = value;
      }
    } else if (operation === 7) {
      const index = Math.floor(random() * (model.length + 2)) - 1;
      assert.equal(list.get(index), model[index]);
    } else {
      if (model.length > 0) {
        const target = model[Math.floor(random() * model.length)];
        assert.equal(list.indexOf(target), model.indexOf(target));
        assert.equal(list.lastIndexOf(target), model.lastIndexOf(target));
      }
    }
    validate();
  }

  assert.equal(list.first(), model[0]);
  assert.equal(list.last(), model[model.length - 1]);
  assert.deepEqual(list.slice(), model.slice());
  assert.equal(list.slice(1, -1).join(","), model.slice(1, -1).join(","));

  const iterator = list[Symbol.iterator]();
  for (const expected of model) {
    assert.deepEqual(iterator.next(), { done: false, value: expected });
  }
  assert.deepEqual(iterator.next(), { done: true, value: undefined });

  list.clear();
  model.length = 0;
  validate();
}
