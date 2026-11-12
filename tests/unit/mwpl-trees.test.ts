import test from "node:test";
import assert from "node:assert/strict";
import {
  AdaptiveHuffmanCode,
  HuffmanCode,
  HuTuckerCode,
  LengthLimitedHuffman,
} from "../../src/index.ts";
import { huffmanLengths } from "../../src/mwpl-trees/internal.ts";

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

/** Reference Huffman lengths from a plain priority-queue merge with (weight, creation order) ties. */
function referenceHuffmanLengths(weights: readonly number[]): number[] {
  if (weights.length === 1) {
    return [1];
  }
  type Node = { weight: number; order: number; leaves: number[] };
  const pool: Node[] = weights.map((weight, index) => ({ weight, order: index, leaves: [index] }));
  const lengths = new Array<number>(weights.length).fill(0);
  let order = weights.length;
  const takeMin = (): Node => {
    let best = 0;
    for (let index = 1; index < pool.length; index++) {
      const node = pool[index] as Node;
      const current = pool[best] as Node;
      if (node.weight < current.weight || (node.weight === current.weight && node.order < current.order)) {
        best = index;
      }
    }
    return pool.splice(best, 1)[0] as Node;
  };
  while (pool.length > 1) {
    const left = takeMin();
    const right = takeMin();
    for (const leaf of [...left.leaves, ...right.leaves]) {
      lengths[leaf] = (lengths[leaf] as number) + 1;
    }
    pool.push({ weight: left.weight + right.weight, order: order++, leaves: [...left.leaves, ...right.leaves] });
  }
  return lengths;
}

test("HuffmanCode presorted frequencies (two-queue path) match the heap construction exactly", () => {
  const random = seeded(0x50f7);
  for (let trial = 0; trial < 600; trial++) {
    const count = 1 + Math.floor(random() * 24);
    const integral = trial % 2 === 0;
    const weights = Array.from({ length: count }, () =>
      integral ? 1 + Math.floor(random() * 6) : random() * 10 + 0.01,
    );
    weights.sort((left, right) => (trial % 4 < 2 ? left - right : right - left));
    assert.deepEqual(huffmanLengths(weights), referenceHuffmanLengths(weights), `weights ${weights}`);
    const frequencies = new Map(weights.map((weight, index) => [`s${index}`, weight]));
    const code = HuffmanCode.fromFrequencies(frequencies);
    assert.equal(code.validate(), true);
    if (count <= 7) {
      const optimum = bruteHuffman(weights);
      assert.ok(Math.abs(code.weightedPathLength - optimum) < 1e-9 * Math.max(1, optimum));
    }
  }
  // Unsorted input still goes through the heap and agrees with the reference.
  for (let trial = 0; trial < 200; trial++) {
    const weights = Array.from({ length: 2 + Math.floor(random() * 20) }, () => 1 + Math.floor(random() * 9));
    assert.deepEqual(huffmanLengths(weights), referenceHuffmanLengths(weights));
  }
  // Descending input is the doc example; its canonical table is unchanged.
  const example = HuffmanCode.fromFrequencies(new Map([["a", 5], ["b", 2], ["c", 1], ["d", 1]]));
  assert.deepEqual([...example.codes()], [["a", "0"], ["b", "10"], ["c", "110"], ["d", "111"]]);
});

test("AdaptiveHuffmanCode.decode rejects bit strings no encoder produces", () => {
  const code = new AdaptiveHuffmanCode(["a", "b", "c"]);
  code.update("a");
  assert.equal(code.encode(["a"]), "1");
  // '0' is the NYT path; '00' would be the escape index of 'a', which now has its own leaf.
  assert.throws(() => code.decode("000"), RangeError);
  assert.deepEqual(code.decode("001"), ["b"]);
  assert.throws(() => code.decode("011"), RangeError); // index 3 is outside the alphabet
  assert.throws(() => code.decode("00"), RangeError); // truncated escape

  // Every random bit string decode accepts must be exactly what encode would emit for the result.
  const random = seeded(0xaced);
  for (let trial = 0; trial < 60; trial++) {
    const alphabet = alphabetOf(1 + Math.floor(random() * 9));
    const model = new AdaptiveHuffmanCode(alphabet);
    for (let step = 0; step < 30; step++) {
      for (let probe = 0; probe < 10; probe++) {
        let bits = "";
        const length = Math.floor(random() * 14);
        for (let index = 0; index < length; index++) {
          bits += random() < 0.5 ? "0" : "1";
        }
        let decoded: string[] | undefined;
        try {
          decoded = model.decode(bits);
        } catch (error) {
          assert.ok(error instanceof RangeError);
        }
        if (decoded !== undefined) {
          assert.equal(model.encode(decoded), bits);
        }
      }
      model.update(alphabet[Math.floor(random() ** 2 * alphabet.length)] as string);
    }
  }
});

test("AdaptiveHuffmanCode stays consistent on deep, skewed trees", () => {
  const alphabet = Array.from({ length: 40 }, (_, index) => index);
  const encoder = new AdaptiveHuffmanCode<number>(alphabet);
  const decoder = new AdaptiveHuffmanCode<number>(alphabet);
  // Fibonacci-like counts force a tree whose depth grows linearly with the number of symbols.
  const stream: number[] = [];
  let previous = 1;
  let current = 1;
  for (let symbol = 0; symbol < 18; symbol++) {
    for (let repeat = 0; repeat < current; repeat++) {
      stream.push(symbol);
    }
    [previous, current] = [current, previous + current];
  }
  for (const symbol of stream) {
    const bits = encoder.encode([symbol]);
    assert.deepEqual(decoder.decode(bits), [symbol]);
    encoder.update(symbol);
    decoder.update(symbol);
  }
  const depth = Math.max(...[...encoder.codes().values()].map((word) => word.length));
  assert.ok(depth >= 17, `depth ${depth}`);
  assert.equal(encoder.validate(), true);
  assert.deepEqual([...encoder.codes()], [...decoder.codes()]);
  const message = Array.from({ length: 500 }, (_, index) => alphabet[(index * 7) % 40] as number);
  assert.deepEqual(encoder.decode(encoder.encode(message)), message);
  encoder.reset();
  assert.equal(encoder.validate(), true);
  assert.equal(encoder.encode([5]), "000101");
});

test("AdaptiveHuffmanCode drops the NYT leaf once every symbol is seen and restores it on reset", () => {
  const code = new AdaptiveHuffmanCode(["a", "b", "c"]);
  code.update("a");
  code.update("b");
  // 'c' is still unseen: NYT path '10' followed by its 2-bit index '10'.
  assert.deepEqual([...code.codes()], [["a", "11"], ["b", "0"], ["c", "1010"]]);
  assert.deepEqual(code.decode("1010"), ["c"]);
  assert.throws(() => code.decode("1000"), RangeError); // escape for already-seen 'a'
  code.update("c");
  assert.equal(code.validate(), true);
  // NYT is gone: a complete Huffman tree over the weights (1, 1, 1), Kraft sum exactly 1.
  assert.deepEqual([...code.codes()], [["a", "10"], ["b", "11"], ["c", "0"]]);
  assert.equal(code.weightedPathLength, 5);
  // The old escape bits now parse only as ordinary code words; no escape path exists.
  assert.deepEqual(code.decode("1010"), ["a", "a"]);
  assert.throws(() => code.decode("1"), RangeError);
  // Corrupting the model is caught: an NYT leaf must not survive full coverage.
  (code as unknown as { nyt: unknown }).nyt = {};
  assert.notEqual(code.validate(), true);
  code.reset();
  assert.equal(code.validate(), true);
  assert.equal(code.encode(["b"]), "01");
  assert.deepEqual(code.decode("10"), ["c"]);

  // σ = 1: before the first update the symbol is an escape `0`; afterwards its own code `0`.
  const single = new AdaptiveHuffmanCode(["x"]);
  assert.equal(single.encode(["x"]), "0");
  single.update("x");
  assert.equal(single.validate(), true);
  assert.deepEqual([...single.codes()], [["x", "0"]]);
  assert.equal(single.weightedPathLength, 1);
  assert.deepEqual(single.decode("000"), ["x", "x", "x"]);
  assert.throws(() => single.decode("1"), RangeError);
  single.reset();
  assert.equal(single.validate(), true);
  assert.throws(() => single.decode("1"), RangeError);

  // Lockstep round trips across the transition, for every small alphabet size.
  const random = seeded(0x7a11);
  for (let size = 1; size <= 9; size++) {
    const alphabet = alphabetOf(size);
    const encoder = new AdaptiveHuffmanCode(alphabet);
    const decoder = new AdaptiveHuffmanCode(alphabet);
    let bits = "";
    const stream: string[] = [];
    for (let step = 0; step < 120; step++) {
      const symbol = (step < size ? alphabet[step] : alphabet[Math.floor(random() * size)]) as string;
      stream.push(symbol);
      bits += encoder.encode([symbol]);
      encoder.update(symbol);
      assert.equal(encoder.validate(), true);
    }
    const decoded: string[] = [];
    let position = 0;
    while (position < bits.length) {
      let end = position + 1;
      let result: string[] | undefined;
      for (; end <= bits.length; end++) {
        try {
          result = decoder.decode(bits.slice(position, end));
        } catch {
          continue;
        }
        break;
      }
      assert.equal(result?.length, 1);
      decoded.push((result as string[])[0] as string);
      decoder.update((result as string[])[0] as string);
      position = end;
    }
    assert.deepEqual(decoded, stream);
    assert.deepEqual([...decoder.codes()], [...encoder.codes()]);
  }
});

test("AdaptiveHuffmanCode spends about log2 σ bits per symbol on a cyclic stream", () => {
  // Same stream as benchmarks/phase3-mwpl.ts: a 64-symbol alphabet cycled by the LCG.
  const alphabet = Array.from({ length: 256 }, (_, index) => `s${index}`);
  const adaptiveAlphabet = alphabet.slice(0, 64);
  let state = 0x9e3779b9;
  const text: string[] = [];
  for (let index = 0; index < 20_000; index++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    text.push(adaptiveAlphabet[Number((alphabet[state % alphabet.length] as string).slice(1)) % 64] as string);
  }
  const code = new AdaptiveHuffmanCode(adaptiveAlphabet);
  let bits = 0;
  for (const symbol of text) {
    bits += code.encode([symbol]).length;
    code.update(symbol);
  }
  const perSymbol = bits / text.length;
  assert.ok(perSymbol < 6.05, `bits/symbol ${perSymbol}`);
  assert.equal(code.validate(), true);
});
