import {
  BinarySearchTree,
  FingerTreap,
  LevelLinkedTree,
} from "../src/index.ts";
import type { FingerSearchMap } from "../src/finger-search-trees/index.ts";
import type { Comparator } from "../src/core/index.ts";

interface CountedComparator {
  compare: Comparator<number>;
  calls: number;
}

function countingComparator(): CountedComparator {
  const counter: CountedComparator = {
    calls: 0,
    compare: (a, b) => {
      counter.calls++;
      return a - b;
    },
  };
  return counter;
}

function milliseconds(run: () => void): number {
  const start = performance.now();
  run();
  return performance.now() - start;
}

function shuffledValues(count: number, seed: number): number[] {
  const values: number[] = new Array(count);
  let state = seed >>> 0;
  for (let index = 0; index < count; index++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    values[index] = state;
  }
  return values;
}

interface Implementation {
  name: string;
  create(compare: Comparator<number>): FingerSearchMap<number, number>;
}

const implementations: Implementation[] = [
  {
    name: "LevelLinkedTree",
    create: (compare) => new LevelLinkedTree<number, number>(compare),
  },
  {
    name: "FingerTreap",
    create: (compare) => new FingerTreap<number, number>(compare, { rng: 0x5eed }),
  },
];

const count = 60_000;
const shuffled = shuffledValues(count, 0x9e3779b9);
const sorted = shuffled.slice().sort((a, b) => a - b);
const middle = count >> 1;
const fingerKey = sorted[middle] as number;

const buildRows: Array<Record<string, string | number>> = [];
const searchRows: Array<Record<string, string | number>> = [];
const localRows: Array<Record<string, string | number>> = [];
const rangeRows: Array<Record<string, string | number>> = [];

for (const implementation of implementations) {
  const counter = countingComparator();
  const tree = implementation.create(counter.compare);
  const insertMs = milliseconds(() => {
    for (const key of shuffled) {
      tree.set(key, key);
    }
  });
  if (tree.validate() !== true) {
    throw new Error(`${implementation.name} failed validation after insert`);
  }

  counter.calls = 0;
  const fullRounds = 20_000;
  const fullMs = milliseconds(() => {
    for (let index = 0; index < fullRounds; index++) {
      tree.get(sorted[(index * 7919) % count] as number);
    }
  });
  const fullCalls = counter.calls / fullRounds;

  const finger = tree.fingerAt(fingerKey);
  if (finger === undefined) {
    throw new Error(`${implementation.name} lost the finger key`);
  }

  buildRows.push({
    implementation: implementation.name,
    "insert 60k ms": insertMs.toFixed(1),
    "full get us": ((fullMs * 1000) / fullRounds).toFixed(3),
    "full comparisons": fullCalls.toFixed(2),
  });

  const distances = [1, 2, 8, 32, 128, 512, 2_048, 8_192];
  for (const distance of distances) {
    if (middle + distance >= count) {
      continue;
    }
    const rounds = 5_000;
    counter.calls = 0;
    const searchMs = milliseconds(() => {
      for (let index = 0; index < rounds; index++) {
        const target = middle + (index % 2 === 0 ? distance : -distance);
        tree.findFrom(finger, sorted[target] as number);
      }
    });
    searchRows.push({
      implementation: implementation.name,
      d: distance,
      "findFrom us": ((searchMs * 1000) / rounds).toFixed(3),
      comparisons: (counter.calls / rounds).toFixed(2),
    });
  }

  for (const distance of [0, 1, 8, 64, 512]) {
    const rounds = 5_000;
    const localMs = milliseconds(() => {
      const start = middle - distance;
      const end = middle + distance;
      for (let index = 0; index < rounds; index++) {
        const target = start + ((index * 2654435761) % Math.max(1, end - start + 1));
        tree.findFrom(finger, sorted[target] as number);
      }
    });
    localRows.push({
      implementation: implementation.name,
      "window d": distance,
      "findFrom us": ((localMs * 1000) / rounds).toFixed(3),
    });
  }

  const after = tree.insertAfter(finger, fingerKey + 0.5, -1);
  if (tree.get(fingerKey + 0.5) !== -1) {
    throw new Error(`${implementation.name} failed finger insert`);
  }
  if (!tree.deleteAt(after)) {
    throw new Error(`${implementation.name} failed finger delete`);
  }
  if (tree.validate() !== true) {
    throw new Error(`${implementation.name} failed validation after finger updates`);
  }
}

console.log(
  `Finger search trees vs full lookup, shuffled insert, n = ${count}`,
);
console.table(buildRows);
console.log("findFrom cost as the finger distance d grows");
console.table(searchRows);
console.log("findFrom over a moving window around the finger");
console.table(localRows);

for (const implementation of implementations) {
  const tree = implementation.create((a, b) => a - b);
  for (const key of shuffled) {
    tree.set(key, key);
  }
  const cut = tree.fingerAt(sorted[middle] as number);
  if (cut === undefined) {
    throw new Error("split cut finger missing");
  }
  let left: FingerSearchMap<number, number> | undefined;
  let right: FingerSearchMap<number, number> | undefined;
  const splitMs = milliseconds(() => {
    [left, right] = tree.splitAt(cut);
  });
  if (left === undefined || right === undefined) {
    throw new Error("split returned no maps");
  }
  if (left.validate() !== true || right.validate() !== true) {
    throw new Error("split produced an invalid map");
  }

  const leftHalf = implementation.create((a, b) => a - b);
  const rightHalf = implementation.create((a, b) => a - b);
  for (let index = 0; index < middle; index++) {
    leftHalf.set(sorted[index] as number, index);
  }
  for (let index = middle; index < count; index++) {
    rightHalf.set(sorted[index] as number, index);
  }
  const joinMs = milliseconds(() => {
    leftHalf.join(rightHalf);
  });
  rangeRows.push({
    implementation: implementation.name,
    "split 60k ms": splitMs.toFixed(1),
    "join 30k+30k ms": joinMs.toFixed(1),
  });
}

console.log("Finger join/split");
console.table(rangeRows);

const baseline = new BinarySearchTree<number, number>((a, b) => a - b);
const baselineMs = milliseconds(() => {
  for (const key of shuffled) {
    baseline.set(key, key);
  }
});
console.log(
  `Unbalanced BST reference insert: ${baselineMs.toFixed(1)} ms for ${count} entries`,
);
