import type { SymbolKey } from "./types.ts";

/** O(n): throws unless `symbol` is a string or a number (the SymbolKey domain). */
export function assertSymbolKey(value: unknown, name = "symbol"): asserts value is SymbolKey {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new TypeError(`${name} must be a string or number`);
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number`);
  }
}

/** O(n): validates frequencies and returns symbols in insertion order with their weights. */
export function readFrequencies<S extends SymbolKey>(
  frequencies: ReadonlyMap<S, number>,
): { symbols: S[]; weights: number[] } {
  if (!(frequencies instanceof Map) && typeof (frequencies as { entries?: unknown }).entries !== "function") {
    throw new TypeError("frequencies must be a Map");
  }
  if (frequencies.size === 0) {
    throw new RangeError("frequencies must contain at least one symbol");
  }
  const symbols: S[] = [];
  const weights: number[] = [];
  for (const [symbol, weight] of frequencies) {
    assertSymbolKey(symbol);
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0) {
      throw new RangeError(`frequency for symbol ${String(symbol)} must be a positive finite number`);
    }
    symbols.push(symbol);
    weights.push(weight);
  }
  return { symbols, weights };
}

interface BuildNode {
  weight: number;
  order: number;
  symbol: number;
  left?: BuildNode;
  right?: BuildNode;
}

class NodeHeap {
  private readonly items: BuildNode[] = [];

  get size(): number {
    return this.items.length;
  }

  push(node: BuildNode): void {
    this.items.push(node);
    this.up(this.items.length - 1);
  }

  pop(): BuildNode {
    const first = this.items[0] as BuildNode;
    const last = this.items.pop() as BuildNode;
    if (this.items.length > 0) {
      this.items[0] = last;
      this.down(0);
    }
    return first;
  }

  private less(left: BuildNode, right: BuildNode): boolean {
    return left.weight < right.weight || (left.weight === right.weight && left.order < right.order);
  }

  private up(index: number): void {
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this.less(this.items[index] as BuildNode, this.items[parent] as BuildNode)) {
        return;
      }
      this.swap(index, parent);
      index = parent;
    }
  }

  private down(index: number): void {
    const size = this.items.length;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < size && this.less(this.items[left] as BuildNode, this.items[smallest] as BuildNode)) {
        smallest = left;
      }
      if (right < size && this.less(this.items[right] as BuildNode, this.items[smallest] as BuildNode)) {
        smallest = right;
      }
      if (smallest === index) {
        return;
      }
      this.swap(index, smallest);
      index = smallest;
    }
  }

  private swap(left: number, right: number): void {
    const value = this.items[left] as BuildNode;
    this.items[left] = this.items[right] as BuildNode;
    this.items[right] = value;
  }
}

function buildHuffmanTree(weights: readonly number[]): BuildNode {
  const heap = new NodeHeap();
  for (let index = 0; index < weights.length; index++) {
    const weight = weights[index] as number;
    if (!Number.isFinite(weight) || weight < 0) {
      throw new RangeError("weights must be finite and non-negative");
    }
    heap.push({ weight, order: index, symbol: index });
  }
  let order = weights.length;
  while (heap.size > 1) {
    const left = heap.pop();
    const right = heap.pop();
    heap.push({
      weight: left.weight + right.weight,
      order: order++,
      symbol: -1,
      left,
      right,
    });
  }
  return heap.pop() as BuildNode;
}

/**
 * O(n log n): Huffman lengths for `weights` in the given order. Ties are broken by insertion
 * order, so the result is stable. A single symbol gets length 1 so its code is usable.
 */
export function huffmanLengths(weights: readonly number[]): number[] {
  const count = weights.length;
  if (count === 0) {
    throw new RangeError("at least one symbol is required");
  }
  if (count === 1) {
    return [1];
  }
  const lengths = new Array<number>(count).fill(0);
  const root = buildHuffmanTree(weights);
  const stack: Array<[BuildNode, number]> = [[root, 0]];
  while (stack.length > 0) {
    const [node, depth] = stack.pop() as [BuildNode, number];
    if (node.symbol >= 0) {
      lengths[node.symbol] = Math.max(1, depth);
    } else {
      if (node.left !== undefined) {
        stack.push([node.left, depth + 1]);
      }
      if (node.right !== undefined) {
        stack.push([node.right, depth + 1]);
      }
    }
  }
  return lengths;
}

/**
 * O(n log n): code words taken directly from the Huffman merge tree, which preserves the
 * sibling property for adaptive coding. A single symbol gets the one-bit code `0`.
 */
export function huffmanTreeCodes(weights: readonly number[]): string[] {
  const count = weights.length;
  if (count === 0) {
    throw new RangeError("at least one symbol is required");
  }
  if (count === 1) {
    return ["0"];
  }
  const root = buildHuffmanTree(weights);
  const codes = new Array<string>(count);
  const stack: Array<[BuildNode, string]> = [[root, ""]];
  while (stack.length > 0) {
    const [node, prefix] = stack.pop() as [BuildNode, string];
    if (node.symbol >= 0) {
      codes[node.symbol] = prefix;
    } else {
      if (node.left !== undefined) {
        stack.push([node.left, `${prefix}0`]);
      }
      if (node.right !== undefined) {
        stack.push([node.right, `${prefix}1`]);
      }
    }
  }
  return codes;
}

/**
 * O(n log n): canonical binary code words for the given lengths, in the supplied symbol order.
 * Symbols are ordered by length and then by position; the resulting map preserves prefix-freeness.
 */
export function canonicalCodes(lengths: readonly number[]): string[] {
  const indices = lengths.map((_, index) => index);
  indices.sort((left, right) => {
    const leftLength = lengths[left] as number;
    const rightLength = lengths[right] as number;
    return leftLength - rightLength || left - right;
  });
  const codes = new Array<string>(lengths.length);
  let code = 0n;
  let previousLength = 0;
  for (const index of indices) {
    const length = lengths[index] as number;
    if (!Number.isInteger(length) || length < 1) {
      throw new RangeError("code lengths must be positive integers");
    }
    code <<= BigInt(length - previousLength);
    if (code >= 1n << BigInt(length)) {
      throw new RangeError("code lengths do not satisfy the Kraft inequality");
    }
    codes[index] = code.toString(2).padStart(length, "0");
    code += 1n;
    previousLength = length;
  }
  return codes;
}

/**
 * O(n): assigns binary code words with the same left-to-right order as the symbols, which is the
 * defining property of an alphabetic code. Throws RangeError if `lengths` is not the depth
 * sequence of a binary alphabetic tree.
 */
export function alphabeticCodes(lengths: readonly number[]): string[] {
  const codes = new Array<string>(lengths.length);
  let code = 0n;
  let previousLength = 0;
  for (let index = 0; index < lengths.length; index++) {
    const length = lengths[index] as number;
    if (!Number.isInteger(length) || length < 1) {
      throw new RangeError("code lengths must be positive integers");
    }
    if (index === 0) {
      code = 0n;
    } else if (length > previousLength) {
      code = (code + 1n) << BigInt(length - previousLength);
    } else {
      code = (code >> BigInt(previousLength - length)) + 1n;
    }
    if (code >= 1n << BigInt(length)) {
      throw new RangeError("code lengths are not alphabetic");
    }
    codes[index] = code.toString(2).padStart(length, "0");
    previousLength = length;
  }
  return codes;
}

/** O(bits): throws RangeError unless every character is `0` or `1`. */
export function assertBits(bits: string): void {
  for (let index = 0; index < bits.length; index++) {
    const bit = bits[index];
    if (bit !== "0" && bit !== "1") {
      throw new RangeError(`bit string contains a non-binary character at index ${index}`);
    }
  }
}
