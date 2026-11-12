import {
  assertBits,
  assertSymbolKey,
  huffmanTreeCodes,
} from "./internal.ts";
import type { AdaptivePrefixCode, SymbolKey } from "./types.ts";

function bitIndex(value: number, width: number): string {
  return value.toString(2).padStart(width, "0");
}

/**
 * Adaptive Huffman code with a not-yet-transmitted (NYT) escape for unseen symbols.
 *
 * The alphabet is fixed at construction, so the escape can transmit an unseen symbol as a
 * fixed-width alphabet index after the NYT path. `update` folds one observation into the model and
 * rebuilds the Huffman tree over the current symbol weights plus the zero-weight NYT leaf;
 * `reset` returns to the initial single-NYT model.
 */
export class AdaptiveHuffmanCode<S extends SymbolKey = string>
  implements AdaptivePrefixCode<S>
{
  readonly alphabet: ReadonlySet<S>;
  readonly rawWidth: number;

  private readonly symbols: readonly S[];
  private readonly indexOf: ReadonlyMap<S, number>;
  private readonly frequencies = new Map<S, number>();
  private codeMap = new Map<S, string>();
  private symbolCodes = new Map<string, S>();
  private prefixSet = new Set<string>();
  private nytCode = "";
  private length = 0;

  constructor(alphabet: Iterable<S>) {
    const symbols: S[] = [];
    const seen = new Set<S>();
    for (const symbol of alphabet) {
      assertSymbolKey(symbol);
      if (seen.has(symbol)) {
        throw new RangeError(`duplicate symbol ${String(symbol)} in alphabet`);
      }
      seen.add(symbol);
      symbols.push(symbol);
    }
    if (symbols.length === 0) {
      throw new RangeError("alphabet must contain at least one symbol");
    }
    this.symbols = symbols;
    this.alphabet = new Set(symbols);
    this.indexOf = new Map(symbols.map((symbol, index) => [symbol, index]));
    this.rawWidth = Math.max(1, Math.ceil(Math.log2(symbols.length)));
    this.rebuild();
  }

  /** Current Σ weight(symbol) · length(code(symbol)) over symbols observed so far. */
  get weightedPathLength(): number {
    return this.length;
  }

  /** O(σ): the current code for every alphabet symbol, including NYT escapes for unseen ones. */
  codes(): ReadonlyMap<S, string> {
    return new Map(this.codeMap);
  }

  /** O(ℓ) per symbol: never mutates the adaptive model; call update separately. */
  encode(symbols: Iterable<S>): string {
    let bits = "";
    for (const symbol of symbols) {
      const code = this.codeMap.get(symbol);
      if (code === undefined) {
        throw new RangeError(`symbol ${String(symbol)} is outside the alphabet`);
      }
      bits += code;
    }
    return bits;
  }

  /** O(bits): decodes against the current model; call update separately for each decoded symbol. */
  decode(bits: string): S[] {
    if (typeof bits !== "string") {
      throw new TypeError("bits must be a string");
    }
    assertBits(bits);
    const symbols: S[] = [];
    let buffer = "";
    let index = 0;
    while (index < bits.length) {
      if (buffer === this.nytCode) {
        if (index + this.rawWidth > bits.length) {
          throw new RangeError("bit string ends in the middle of an NYT escape");
        }
        const value = Number.parseInt(bits.slice(index, index + this.rawWidth), 2);
        index += this.rawWidth;
        const symbol = this.symbols[value];
        if (symbol === undefined) {
          throw new RangeError("NYT escape names a symbol outside the alphabet");
        }
        symbols.push(symbol);
        buffer = "";
        continue;
      }
      buffer += bits[index++] as string;
      if (buffer === this.nytCode) {
        continue;
      }
      const symbol = this.symbolCodes.get(buffer);
      if (symbol !== undefined) {
        symbols.push(symbol);
        buffer = "";
        continue;
      }
      if (!this.prefixSet.has(buffer)) {
        throw new RangeError(`invalid code word ending at bit ${index - 1}`);
      }
    }
    if (buffer !== "") {
      throw new RangeError("bit string ends in the middle of a code word");
    }
    return symbols;
  }

  /** O(n log n): checks coverage, prefix-freeness, and the recorded weighted path length. */
  isPrefixFree(): boolean {
    const words = [...this.codeMap.values()].sort();
    for (let index = 1; index < words.length; index++) {
      if ((words[index] as string).startsWith(words[index - 1] as string)) {
        return false;
      }
    }
    return true;
  }

  /** O(n log n): validates the current adaptive model. */
  validate(): true | string {
    if (this.codeMap.size !== this.alphabet.size) {
      return "code table does not cover the alphabet";
    }
    let weightedPathLength = 0;
    for (const symbol of this.alphabet) {
      const code = this.codeMap.get(symbol);
      if (code === undefined) {
        return `missing code for symbol ${String(symbol)}`;
      }
      if (code.length === 0 || /[^01]/.test(code)) {
        return `invalid code word for symbol ${String(symbol)}`;
      }
      const frequency = this.frequencies.get(symbol);
      if (frequency !== undefined) {
        weightedPathLength += frequency * code.length;
      }
    }
    if (!this.isPrefixFree()) {
      return "code words are not prefix-free";
    }
    if (weightedPathLength !== this.length) {
      return "weighted path length is stale";
    }
    if (this.frequencies.size > 0 && this.nytCode === "") {
      return "NYT leaf is missing after symbols were observed";
    }
    return true;
  }

  /** O(σ log σ): records one observation and rebuilds the Huffman tree. */
  update(symbol: S): void {
    const index = this.indexOf.get(symbol);
    if (index === undefined) {
      throw new RangeError(`symbol ${String(symbol)} is outside the alphabet`);
    }
    this.frequencies.set(symbol, (this.frequencies.get(symbol) ?? 0) + 1);
    this.rebuild();
  }

  /** O(σ log σ): restores the initial single-NYT model. */
  reset(): void {
    this.frequencies.clear();
    this.rebuild();
  }

  private rebuild(): void {
    const seen = [...this.frequencies.keys()];
    const seenCodes = new Map<S, string>();
    const symbolCodes = new Map<string, S>();
    let nytCode = "";
    if (seen.length > 0) {
      const weights = seen.map((symbol) => this.frequencies.get(symbol) as number);
      weights.push(0);
      const words = huffmanTreeCodes(weights);
      for (let index = 0; index < seen.length; index++) {
        const symbol = seen[index] as S;
        const word = words[index] as string;
        seenCodes.set(symbol, word);
        symbolCodes.set(word, symbol);
      }
      nytCode = words[seen.length] as string;
    }

    const codeMap = new Map<S, string>();
    let weightedPathLength = 0;
    for (const symbol of this.symbols) {
      const word = seenCodes.get(symbol);
      if (word !== undefined) {
        codeMap.set(symbol, word);
        weightedPathLength += (this.frequencies.get(symbol) as number) * word.length;
      } else {
        const index = this.indexOf.get(symbol) as number;
        codeMap.set(symbol, nytCode + bitIndex(index, this.rawWidth));
      }
    }

    const prefixSet = new Set<string>();
    for (const word of seenCodes.values()) {
      for (let length = 1; length < word.length; length++) {
        prefixSet.add(word.slice(0, length));
      }
    }
    if (nytCode !== "") {
      for (let length = 1; length < nytCode.length; length++) {
        prefixSet.add(nytCode.slice(0, length));
      }
    }

    this.symbolCodes = symbolCodes;
    this.codeMap = codeMap;
    this.prefixSet = prefixSet;
    this.nytCode = nytCode;
    this.length = weightedPathLength;
  }
}
