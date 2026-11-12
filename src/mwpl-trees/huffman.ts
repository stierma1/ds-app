import { PrefixCodeBase } from "./base.ts";
import { canonicalCodes, huffmanLengths, readFrequencies } from "./internal.ts";
import type { SymbolKey } from "./types.ts";

/**
 * Huffman code built from an explicit frequency table.
 *
 * Ties between equal frequencies are broken by symbol insertion order, so the code table is
 * stable across runs. A single-symbol alphabet receives the one-bit code `0`.
 *
 * Construction is O(n log n) with a binary heap. When the frequencies are already sorted (either
 * direction, detected in O(n)), the two-queue method builds the same tree in O(n), and the
 * canonical code assignment uses a counting sort on lengths, so the only super-linear term left is
 * writing the Σℓ bits of the code table itself.
 */
export class HuffmanCode<S extends SymbolKey = string> extends PrefixCodeBase<S> {
  constructor(frequencies: ReadonlyMap<S, number>) {
    const { symbols, weights } = readFrequencies(frequencies);
    const lengths = huffmanLengths(weights);
    super(symbols, frequencies, canonicalCodes(lengths));
  }

  /** O(n log n), O(n) when frequencies are presorted (plus Σℓ to write the code table). */
  static fromFrequencies<S extends SymbolKey = string>(
    frequencies: ReadonlyMap<S, number>,
  ): HuffmanCode<S> {
    return new HuffmanCode<S>(frequencies);
  }
}
