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

/** A node of a Huffman merge tree; `symbol` is the leaf's input index, or -1 for an internal node. */
export interface BuildNode {
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
    return nodeBefore(left, right);
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

function assertWeight(weight: number): void {
  if (!Number.isFinite(weight) || weight < 0) {
    throw new RangeError("weights must be finite and non-negative");
  }
}

function nodeBefore(left: BuildNode, right: BuildNode): boolean {
  return left.weight < right.weight || (left.weight === right.weight && left.order < right.order);
}

/**
 * O(n): leaf indices in ascending (weight, index) order when `weights` is already monotone
 * (non-decreasing or non-increasing), otherwise undefined. Equal-weight runs of a non-increasing
 * input are emitted in ascending index order so ties match the heap path exactly.
 */
function presortedLeafOrder(weights: readonly number[]): number[] | undefined {
  const count = weights.length;
  let ascending = true;
  let descending = true;
  for (let index = 1; index < count && (ascending || descending); index++) {
    const previous = weights[index - 1] as number;
    const current = weights[index] as number;
    if (current < previous) {
      ascending = false;
    } else if (current > previous) {
      descending = false;
    }
  }
  if (ascending) {
    return Array.from({ length: count }, (_, index) => index);
  }
  if (!descending) {
    return undefined;
  }
  const order: number[] = [];
  let end = count - 1;
  while (end >= 0) {
    let start = end;
    while (start > 0 && weights[start - 1] === weights[end]) {
      start--;
    }
    for (let index = start; index <= end; index++) {
      order.push(index);
    }
    end = start - 1;
  }
  return order;
}

/**
 * O(n): van Leeuwen's two-queue Huffman construction for leaves already in ascending
 * (weight, index) order. Merged nodes are created in non-decreasing weight order, so a FIFO holds
 * them sorted; each step takes the smaller front by (weight, order). This is exactly the node the
 * heap would pop, so the tree is identical to the heap construction.
 */
function buildHuffmanTreeTwoQueue(weights: readonly number[], leafOrder: readonly number[]): BuildNode {
  const count = weights.length;
  const leaves = leafOrder.map((index) => ({
    weight: weights[index] as number,
    order: index,
    symbol: index,
  }));
  const merged: BuildNode[] = [];
  let leafHead = 0;
  let mergedHead = 0;
  const take = (): BuildNode => {
    if (
      leafHead < count &&
      (mergedHead >= merged.length ||
        nodeBefore(leaves[leafHead] as BuildNode, merged[mergedHead] as BuildNode))
    ) {
      return leaves[leafHead++] as BuildNode;
    }
    return merged[mergedHead++] as BuildNode;
  };
  let order = count;
  for (let step = 1; step < count; step++) {
    const left = take();
    const right = take();
    merged.push({ weight: left.weight + right.weight, order: order++, symbol: -1, left, right });
  }
  return count === 1 ? (leaves[0] as BuildNode) : (merged[merged.length - 1] as BuildNode);
}

/**
 * O(n log n), or O(n) when `weights` is already sorted in either direction: the Huffman merge
 * tree. Ties are broken by (weight, creation order), where leaves are created in input order
 * before any merged node; both construction paths produce the same tree.
 */
export function buildHuffmanTree(weights: readonly number[]): BuildNode {
  for (const weight of weights) {
    assertWeight(weight);
  }
  const leafOrder = presortedLeafOrder(weights);
  if (leafOrder !== undefined) {
    return buildHuffmanTreeTwoQueue(weights, leafOrder);
  }
  const heap = new NodeHeap();
  for (let index = 0; index < weights.length; index++) {
    heap.push({ weight: weights[index] as number, order: index, symbol: index });
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
 * O(n log n), O(n) when `weights` is presorted: Huffman lengths for `weights` in the given order.
 * Ties are broken by insertion order, so the result is stable. A single symbol gets length 1 so its code is usable.
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
 * O(n + maxLength + Σℓ): canonical binary code words for the given lengths, in the supplied symbol
 * order. Symbols are ordered by length and then by position (a counting sort on length, so no
 * comparison sort is needed); the resulting map preserves prefix-freeness. Writing the code
 * strings is the Σℓ term, which is the size of the output.
 */
export function canonicalCodes(lengths: readonly number[]): string[] {
  let maxLength = 0;
  for (const length of lengths) {
    if (!Number.isInteger(length) || length < 1) {
      throw new RangeError("code lengths must be positive integers");
    }
    maxLength = Math.max(maxLength, length);
  }
  let indices: number[];
  if (maxLength <= 2 * lengths.length + 64) {
    const starts = new Array<number>(maxLength + 2).fill(0);
    for (const length of lengths) {
      starts[length + 1] = (starts[length + 1] as number) + 1;
    }
    for (let length = 1; length <= maxLength + 1; length++) {
      starts[length] = (starts[length] as number) + (starts[length - 1] as number);
    }
    indices = new Array<number>(lengths.length);
    for (let index = 0; index < lengths.length; index++) {
      const length = lengths[index] as number;
      indices[starts[length] as number] = index;
      starts[length] = (starts[length] as number) + 1;
    }
  } else {
    indices = lengths.map((_, index) => index);
    indices.sort((left, right) => (lengths[left] as number) - (lengths[right] as number) || left - right);
  }
  const codes = new Array<string>(lengths.length);
  let code = 0n;
  let previousLength = 0;
  for (const index of indices) {
    const length = lengths[index] as number;
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
