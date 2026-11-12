import { PrefixCodeBase } from "./base.ts";
import { alphabeticCodes, readFrequencies } from "./internal.ts";
import type { SymbolKey } from "./types.ts";

interface GarsiaWachsNode {
  weight: number;
  symbol: number;
  left?: GarsiaWachsNode;
  right?: GarsiaWachsNode;
}

/**
 * O(n²) worst case here; the original Garsia–Wachs algorithm is O(n log n) with a balanced
 * sequence. The tree is built with the two-phase Garsia–Wachs construction, which produces the
 * same leaf depths as Hu–Tucker, then the depths are converted to alphabetic code words in input
 * order.
 */
function garsiaWachsLengths(weights: readonly number[]): number[] {
  const count = weights.length;
  if (count === 0) {
    throw new RangeError("at least one symbol is required");
  }
  if (count === 1) {
    return [1];
  }

  const forest: GarsiaWachsNode[] = weights.map((weight, symbol) => ({ weight, symbol }));
  while (forest.length > 1) {
    let index = -1;
    for (let candidate = 1; candidate < forest.length; candidate++) {
      const next = candidate + 1 < forest.length
        ? (forest[candidate + 1] as GarsiaWachsNode).weight
        : Number.POSITIVE_INFINITY;
      if ((forest[candidate - 1] as GarsiaWachsNode).weight <= next) {
        index = candidate;
        break;
      }
    }
    if (index < 0) {
      throw new RangeError("Garsia–Wachs combination failed");
    }
    const left = forest[index - 1] as GarsiaWachsNode;
    const right = forest[index] as GarsiaWachsNode;
    const parent: GarsiaWachsNode = {
      weight: left.weight + right.weight,
      symbol: -1,
      left,
      right,
    };
    forest.splice(index - 1, 2);
    let position = index - 1;
    while (position > 0 && (forest[position - 1] as GarsiaWachsNode).weight < parent.weight) {
      position--;
    }
    forest.splice(position, 0, parent);
  }

  const root = forest[0] as GarsiaWachsNode;
  const lengths = new Array<number>(count).fill(0);
  const stack: Array<[GarsiaWachsNode, number]> = [[root, 0]];
  while (stack.length > 0) {
    const [node, depth] = stack.pop() as [GarsiaWachsNode, number];
    if (node.symbol >= 0) {
      lengths[node.symbol] = depth;
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
 * Hu–Tucker optimal alphabetic code. The left-to-right order of the supplied frequency map is the
 * required order of the symbols; codes preserve that order lexicographically.
 *
 * The implementation uses the Garsia–Wachs construction, whose leaf depths coincide with those of
 * the Hu–Tucker algorithm.
 */
export class HuTuckerCode<S extends SymbolKey = string> extends PrefixCodeBase<S> {
  constructor(frequencies: ReadonlyMap<S, number>) {
    const { symbols, weights } = readFrequencies(frequencies);
    const lengths = garsiaWachsLengths(weights);
    super(symbols, frequencies, alphabeticCodes(lengths));
  }

  /** O(n²) worst case: constructs an optimal alphabetic code. */
  static fromFrequencies<S extends SymbolKey = string>(
    frequencies: ReadonlyMap<S, number>,
  ): HuTuckerCode<S> {
    return new HuTuckerCode<S>(frequencies);
  }
}
