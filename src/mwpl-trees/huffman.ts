import { PrefixCodeBase } from "./base.ts";
import { canonicalCodes, huffmanLengths, readFrequencies } from "./internal.ts";
import type { SymbolKey } from "./types.ts";

/**
 * Huffman code built from an explicit frequency table.
 *
 * Ties between equal frequencies are broken by symbol insertion order, so the code table is
 * stable across runs. A single-symbol alphabet receives the one-bit code `0`.
 */
export class HuffmanCode<S extends SymbolKey = string> extends PrefixCodeBase<S> {
  constructor(frequencies: ReadonlyMap<S, number>) {
    const { symbols, weights } = readFrequencies(frequencies);
    const lengths = huffmanLengths(weights);
    super(symbols, frequencies, canonicalCodes(lengths));
  }

  /** O(n log n): constructs a code from a frequency table. */
  static fromFrequencies<S extends SymbolKey = string>(
    frequencies: ReadonlyMap<S, number>,
  ): HuffmanCode<S> {
    return new HuffmanCode<S>(frequencies);
  }
}
