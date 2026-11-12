import { PrefixCodeBase } from "./base.ts";
import { canonicalCodes, huffmanLengths, readFrequencies } from "./internal.ts";
import type { CodeOptions, SymbolKey } from "./types.ts";

interface PackageItem {
  weight: number;
  sequence: number;
  leaf: number;
  left: number;
  right: number;
}

function compareItems(left: PackageItem, right: PackageItem): number {
  if (left.weight !== right.weight) {
    return left.weight - right.weight;
  }
  const leftLeaf = left.leaf >= 0 ? 0 : 1;
  const rightLeaf = right.leaf >= 0 ? 0 : 1;
  if (leftLeaf !== rightLeaf) {
    return leftLeaf - rightLeaf;
  }
  return left.sequence - right.sequence;
}

function mergeItems(left: readonly PackageItem[], right: readonly PackageItem[]): PackageItem[] {
  const merged: PackageItem[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (compareItems(left[leftIndex] as PackageItem, right[rightIndex] as PackageItem) <= 0) {
      merged.push(left[leftIndex++] as PackageItem);
    } else {
      merged.push(right[rightIndex++] as PackageItem);
    }
  }
  while (leftIndex < left.length) {
    merged.push(left[leftIndex++] as PackageItem);
  }
  while (rightIndex < right.length) {
    merged.push(right[rightIndex++] as PackageItem);
  }
  return merged;
}

/**
 * O(n·L): package-merge for optimal length-limited Huffman code lengths. The returned lengths are
 * indexed like `weights`. Selection is propagated down the levels, so leaves are counted once per
 * selected coin rather than by expanding every package.
 */
function packageMergeLengths(weights: readonly number[], maxLength: number): number[] {
  const count = weights.length;
  if (count === 1) {
    return [1];
  }
  if (count > 2 ** maxLength) {
    throw new RangeError(`a length limit of ${maxLength} cannot represent ${count} symbols`);
  }
  if (maxLength >= count - 1) {
    return huffmanLengths(weights);
  }

  const limit = 2 * count - 2;
  const sorted = weights.map((_, index) => index);
  sorted.sort((left, right) => {
    const difference = (weights[left] as number) - (weights[right] as number);
    return difference !== 0 ? difference : left - right;
  });

  let sequence = 0;
  const levels: PackageItem[][] = [];
  let previous = sorted.map((index): PackageItem => ({
    weight: weights[index] as number,
    sequence: sequence++,
    leaf: index,
    left: -1,
    right: -1,
  }));
  levels.push(previous);

  for (let level = 1; level < maxLength; level++) {
    const packages: PackageItem[] = [];
    for (let index = 0; index + 1 < previous.length; index += 2) {
      const left = previous[index] as PackageItem;
      const right = previous[index + 1] as PackageItem;
      packages.push({
        weight: left.weight + right.weight,
        sequence: sequence++,
        leaf: -1,
        left: index,
        right: index + 1,
      });
    }
    const leaves = sorted.map((index): PackageItem => ({
      weight: weights[index] as number,
      sequence: sequence++,
      leaf: index,
      left: -1,
      right: -1,
    }));
    previous = mergeItems(leaves, packages).slice(0, limit);
    levels.push(previous);
  }

  const selected: boolean[][] = levels.map((level) => new Array<boolean>(level.length).fill(false));
  const lastLevel = levels.length - 1;
  const final = levels[lastLevel] as PackageItem[];
  if (final.length < limit) {
    throw new RangeError(`a length limit of ${maxLength} is infeasible`);
  }
  for (let index = 0; index < limit; index++) {
    (selected[lastLevel] as boolean[])[index] = true;
  }

  const lengths = new Array<number>(count).fill(0);
  for (let level = lastLevel; level >= 0; level--) {
    const items = levels[level] as PackageItem[];
    const chosen = selected[level] as boolean[];
    for (let index = 0; index < items.length; index++) {
      if (!chosen[index]) {
        continue;
      }
      const item = items[index] as PackageItem;
      if (item.leaf >= 0) {
        lengths[item.leaf] = (lengths[item.leaf] as number) + 1;
      } else if (level > 0) {
        const below = selected[level - 1] as boolean[];
        below[item.left] = true;
        below[item.right] = true;
      }
    }
  }

  for (const length of lengths) {
    if (length < 1 || length > maxLength) {
      throw new RangeError(`a length limit of ${maxLength} is infeasible`);
    }
  }
  return lengths;
}

function readMaxLength(options: number | CodeOptions | undefined, count: number): number {
  const value =
    typeof options === "number"
      ? options
      : options === undefined
        ? undefined
        : options.maxLength;
  if (value === undefined) {
    return Math.max(1, count - 1);
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError("maxLength must be a positive integer");
  }
  return value;
}

/**
 * Length-limited Huffman code. Package-merge minimizes weighted path length subject to every code
 * word having at most `maxLength` bits. An infeasible limit throws RangeError.
 */
export class LengthLimitedHuffman<S extends SymbolKey = string> extends PrefixCodeBase<S> {
  readonly maxLength: number;

  constructor(
    frequencies: ReadonlyMap<S, number>,
    options?: number | CodeOptions,
  ) {
    const { symbols, weights } = readFrequencies(frequencies);
    const maxLength = readMaxLength(options, weights.length);
    if (weights.length === 1 && maxLength < 1) {
      throw new RangeError("a single symbol needs maxLength of at least 1");
    }
    const lengths = packageMergeLengths(weights, maxLength);
    super(symbols, frequencies, canonicalCodes(lengths));
    this.maxLength = maxLength;
  }

  /** O(n·L): constructs an optimal length-limited code. */
  static fromFrequencies<S extends SymbolKey = string>(
    frequencies: ReadonlyMap<S, number>,
    options?: number | CodeOptions,
  ): LengthLimitedHuffman<S> {
    return new LengthLimitedHuffman<S>(frequencies, options);
  }
}
