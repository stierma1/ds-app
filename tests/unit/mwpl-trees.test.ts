import test from "node:test";
import assert from "node:assert/strict";
import {
  AdaptiveHuffmanCode,
  HuffmanCode,
  HuTuckerCode,
  LengthLimitedHuffman,
} from "../../src/index.ts";

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function alphabetOf(count: number): string[] {
  return Array.from({ length: count }, (_, index) => String.fromCharCode(97 + index));
}

function weightedPathLength<S>(codes: ReadonlyMap<S, string>, frequencies: ReadonlyMap<S, number>): number {
  let total = 0;
  for (const [symbol, frequency] of frequencies) {
    total += frequency * (codes.get(symbol) as string).length;
  }
  return total;
}

function bruteHuffman(weights: readonly number[]): number {
  const count = weights.length;
  if (count === 1) {
    return weights[0] as number;
  }
  const maxLength = Math.max(1, count - 1);
  let best = Number.POSITIVE_INFINITY;
  const lengths = new Array<number>(count).fill(1);
  const visit = (index: number, kraft: number): void => {
    if (kraft < 0) {
      return;
    }
    if (index === count) {
      let cost = 0;
      for (let symbol = 0; symbol < count; symbol++) {
        cost += (weights[symbol] as number) * (lengths[symbol] as number);
      }
      best = Math.min(best, cost);
      return;
    }
    for (let length = 1; length <= maxLength; length++) {
      lengths[index] = length;
      visit(index + 1, kraft - 2 ** (maxLength - length));
    }
  };
  visit(0, 2 ** maxLength);
  return best;
}

function bruteLengthLimited(weights: readonly number[], maxLength: number): number {
  const count = weights.length;
  let best = Number.POSITIVE_INFINITY;
  const lengths = new Array<number>(count).fill(1);
  const visit = (index: number, kraft: number): void => {
    if (kraft < 0) {
      return;
    }
    if (index === count) {
      let cost = 0;
      for (let symbol = 0; symbol < count; symbol++) {
        cost += (weights[symbol] as number) * (lengths[symbol] as number);
      }
      best = Math.min(best, cost);
      return;
    }
    for (let length = 1; length <= maxLength; length++) {
      lengths[index] = length;
      visit(index + 1, kraft - 2 ** (maxLength - length));
    }
  };
  visit(0, 2 ** maxLength);
  return best;
}

function bruteAlphabetic(weights: readonly number[]): number {
  const count = weights.length;
  if (count === 1) {
    return weights[0] as number;
  }
  const prefix = [...weights];
  for (let index = 1; index < count; index++) {
    prefix[index] = (prefix[index] as number) + (prefix[index - 1] as number);
  }
  const range = (left: number, right: number): number =>
    (prefix[right] as number) - (left > 0 ? (prefix[left - 1] as number) : 0);
  const dp = Array.from({ length: count }, () => new Array<number>(count).fill(0));
  for (let width = 2; width <= count; width++) {
    for (let left = 0; left + width - 1 < count; left++) {
      const right = left + width - 1;
      let best = Number.POSITIVE_INFINITY;
      for (let split = left; split < right; split++) {
        best = Math.min(
          best,
          ((dp[left] as number[])[split] as number) +
            ((dp[split + 1] as number[])[right] as number),
        );
      }
      (dp[left] as number[])[right] = range(left, right) + best;
    }
  }
  return (dp[0] as number[])[count - 1] as number;
}

test("HuffmanCode matches the documented example", () => {
  const frequencies = new Map([
    ["a", 5],
    ["b", 2],
    ["c", 1],
    ["d", 1],
  ]);
  const code = HuffmanCode.fromFrequencies(frequencies);
  assert.deepEqual([...code.codes()], [
    ["a", "0"],
    ["b", "10"],
    ["c", "110"],
    ["d", "111"],
  ]);
  assert.equal(code.weightedPathLength, 15);
  const bits = code.encode(["a", "b", "c"]);
  assert.equal(bits, "010110");
  assert.deepEqual(code.decode(bits), ["a", "b", "c"]);
  assert.equal(code.validate(), true);
  assert.equal(code.isPrefixFree(), true);
  assert.deepEqual([...code.alphabet].sort(), ["a", "b", "c", "d"]);
});

test("HuffmanCode is optimal on random small alphabets and round-trips", () => {
  const random = seeded(0x1234);
  for (let trial = 0; trial < 300; trial++) {
    const count = 1 + Math.floor(random() * 5);
    const symbols = alphabetOf(count);
    const weights = symbols.map(() => 1 + Math.floor(random() * 12));
    const frequencies = new Map(symbols.map((symbol, index) => [symbol, weights[index] as number]));
    const code = HuffmanCode.fromFrequencies(frequencies);
    assert.equal(code.weightedPathLength, bruteHuffman(weights), `weights ${weights.join(",")}`);
    assert.equal(code.validate(), true);
    assert.equal(code.weightedPathLength, weightedPathLength(code.codes(), frequencies));
    const bits = code.encode(symbols);
    assert.deepEqual(code.decode(bits), symbols);
  }
});

test("HuffmanCode rejects invalid input and invalid bit strings", () => {
  assert.throws(() => HuffmanCode.fromFrequencies(new Map()), RangeError);
  assert.throws(() => HuffmanCode.fromFrequencies(new Map([["a", 0]])), RangeError);
  assert.throws(() => HuffmanCode.fromFrequencies(new Map([["a", -1]])), RangeError);
  assert.throws(() => HuffmanCode.fromFrequencies(new Map([["a", Number.NaN]])), RangeError);

  const code = HuffmanCode.fromFrequencies(new Map([["a", 1], ["b", 1]]));
  assert.throws(() => code.encode(["z"]), RangeError);
  assert.throws(() => code.decode("2"), RangeError);
  const single = HuffmanCode.fromFrequencies(new Map([["a", 1]]));
  assert.throws(() => single.decode("1"), RangeError);
  assert.deepEqual(code.decode(""), []);
});

test("HuffmanCode handles single-symbol alphabets", () => {
  const code = HuffmanCode.fromFrequencies(new Map([["only", 7]]));
  assert.deepEqual([...code.codes()], [["only", "0"]]);
  assert.equal(code.weightedPathLength, 7);
  assert.deepEqual(code.decode(code.encode(["only", "only"])), ["only", "only"]);
  assert.equal(code.validate(), true);
});

test("HuffmanCode assigns long code words without 32-bit overflow", () => {
  const frequencies = new Map<string, number>();
  let weight = 1;
  for (let index = 0; index < 40; index++) {
    frequencies.set(`s${index}`, weight);
    weight *= 2;
  }
  const code = HuffmanCode.fromFrequencies(frequencies);
  assert.equal(code.validate(), true);
  for (const word of code.codes().values()) {
    assert.equal(/^[01]+$/.test(word), true);
  }
  const symbols = [...frequencies.keys()].slice(0, 5);
  assert.deepEqual(code.decode(code.encode(symbols)), symbols);
});

test("LengthLimitedHuffman respects the limit and is optimal for small cases", () => {
  const random = seeded(0x5678);
  for (let trial = 0; trial < 400; trial++) {
    const count = 1 + Math.floor(random() * 5);
    const maxLength = 1 + Math.floor(random() * 4);
    if (count > 2 ** maxLength) {
      continue;
    }
    const symbols = alphabetOf(count);
    const weights = symbols.map(() => 1 + Math.floor(random() * 9));
    const frequencies = new Map(symbols.map((symbol, index) => [symbol, weights[index] as number]));
    const code = LengthLimitedHuffman.fromFrequencies(frequencies, maxLength);
    assert.equal(code.maxLength, maxLength);
    assert.equal(code.validate(), true);
    for (const word of code.codes().values()) {
      assert.equal(word.length <= maxLength, true);
    }
    assert.equal(code.weightedPathLength, bruteLengthLimited(weights, maxLength));
    assert.deepEqual(code.decode(code.encode(symbols)), symbols);
  }
});

test("LengthLimitedHuffman rejects infeasible and invalid limits", () => {
  const five = new Map(alphabetOf(5).map((symbol) => [symbol, 1]));
  assert.throws(() => LengthLimitedHuffman.fromFrequencies(five, 2), RangeError);
  assert.throws(() => LengthLimitedHuffman.fromFrequencies(five, 0), RangeError);
  assert.throws(() => LengthLimitedHuffman.fromFrequencies(five, 1.5), RangeError);

  const code = LengthLimitedHuffman.fromFrequencies(new Map([["a", 3], ["b", 2], ["c", 1]]));
  assert.equal(code.validate(), true);
  assert.equal(code.maxLength, 2);
  for (const word of code.codes().values()) {
    assert.equal(word.length <= 2, true);
  }
});

test("HuTuckerCode preserves symbol order and matches the alphabetic optimum", () => {
  const random = seeded(0x9abc);
  for (let trial = 0; trial < 700; trial++) {
    const count = 1 + Math.floor(random() * 9);
    const symbols = alphabetOf(count);
    const weights = symbols.map(() => 1 + Math.floor(random() * 15));
    const frequencies = new Map(symbols.map((symbol, index) => [symbol, weights[index] as number]));
    const code = HuTuckerCode.fromFrequencies(frequencies);
    assert.equal(code.weightedPathLength, bruteAlphabetic(weights), `weights ${weights.join(",")}`);
    assert.equal(code.validate(), true);

    const words = symbols.map((symbol) => code.codes().get(symbol) as string);
    for (let index = 1; index < words.length; index++) {
      assert.equal((words[index - 1] as string) < (words[index] as string), true);
    }
    assert.deepEqual(code.decode(code.encode(symbols)), symbols);
  }
});

test("HuTuckerCode handles equal weights and single symbols", () => {
  const symbols = alphabetOf(6);
  const code = HuTuckerCode.fromFrequencies(new Map(symbols.map((symbol) => [symbol, 1])));
  assert.equal(code.validate(), true);
  const words = symbols.map((symbol) => code.codes().get(symbol) as string);
  for (let index = 1; index < words.length; index++) {
    assert.equal((words[index - 1] as string) < (words[index] as string), true);
  }

  const single = HuTuckerCode.fromFrequencies(new Map([["x", 4]]));
  assert.deepEqual([...single.codes()], [["x", "0"]]);
  assert.equal(single.weightedPathLength, 4);
  assert.equal(single.validate(), true);
});

test("AdaptiveHuffmanCode starts at a single NYT and covers the alphabet", () => {
  const alphabet = ["a", "b", "c"];
  const code = new AdaptiveHuffmanCode(alphabet);
  assert.equal(code.weightedPathLength, 0);
  assert.equal(code.validate(), true);
  assert.deepEqual([...code.alphabet].sort(), alphabet);
  assert.equal(code.codes().size, 3);
  for (const symbol of alphabet) {
    assert.deepEqual(code.decode(code.encode([symbol])), [symbol]);
  }
  assert.throws(() => code.update("z" as never), RangeError);
  assert.throws(() => new AdaptiveHuffmanCode([]), RangeError);
  assert.throws(() => new AdaptiveHuffmanCode(["a", "a"]), RangeError);
});

test("AdaptiveHuffmanCode round-trips with mirrored updates and resets", () => {
  const random = seeded(0xdef0);
  for (let trial = 0; trial < 150; trial++) {
    const count = 1 + Math.floor(random() * 7);
    const alphabet = alphabetOf(count);
    const encoder = new AdaptiveHuffmanCode(alphabet);
    const decoder = new AdaptiveHuffmanCode(alphabet);
    for (let step = 0; step < 40; step++) {
      const symbol = alphabet[Math.floor(random() * count)] as string;
      const bits = encoder.encode([symbol]);
      assert.deepEqual(decoder.decode(bits), [symbol]);
      encoder.update(symbol);
      decoder.update(symbol);
      assert.equal(encoder.validate(), true);
      assert.equal(decoder.validate(), true);
      assert.equal(encoder.isPrefixFree(), true);
      assert.deepEqual([...encoder.codes()], [...decoder.codes()]);
    }
    assert.equal(encoder.weightedPathLength > 0, true);
    encoder.reset();
    assert.equal(encoder.weightedPathLength, 0);
    assert.equal(encoder.validate(), true);
  }
});

test("AdaptiveHuffmanCode decodes a complete stream against a fixed model", () => {
  const alphabet = ["a", "b", "c", "d"];
  const code = new AdaptiveHuffmanCode(alphabet);
  for (const symbol of alphabet) {
    code.update(symbol);
  }
  const stream: string[] = [];
  for (let index = 0; index < 60; index++) {
    stream.push(alphabet[(index * index + 1) % alphabet.length] as string);
  }
  const bits = code.encode(stream);
  assert.deepEqual(code.decode(bits), stream);
  assert.equal(code.validate(), true);
});

test("validate rejects stale, incomplete, and non-prefix-free tables", () => {
  const stale = HuffmanCode.fromFrequencies(new Map([["a", 1], ["b", 1]]));
  (stale as unknown as { weightedPathLength: number }).weightedPathLength = -1;
  assert.notEqual(stale.validate(), true);

  const missing = HuffmanCode.fromFrequencies(new Map([["a", 1], ["b", 1]]));
  (missing as unknown as { codeMap: Map<string, string> }).codeMap.delete("b");
  assert.notEqual(missing.validate(), true);

  const violation = HuffmanCode.fromFrequencies(new Map([["a", 1], ["b", 1]]));
  (violation as unknown as { codeMap: Map<string, string> }).codeMap.set("b", "00");
  assert.notEqual(violation.validate(), true);
  assert.equal(violation.isPrefixFree(), false);
});
