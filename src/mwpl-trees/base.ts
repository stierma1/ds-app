import { assertBits, assertSymbolKey } from "./internal.ts";
import type { PrefixCode, SymbolKey } from "./types.ts";

interface TrieNode<S> {
  children: [TrieNode<S> | undefined, TrieNode<S> | undefined];
  symbol: S | undefined;
  hasSymbol: boolean;
}

function emptyTrie<S>(): TrieNode<S> {
  return { children: [undefined, undefined], symbol: undefined, hasSymbol: false };
}

/**
 * Shared implementation for static prefix codes: the alphabet, the symbol-to-code table, the
 * recorded weighted path length, encode/decode, and invariant checks.
 *
 * Subclasses compute the code words and pass them in; a code word must be non-empty and binary,
 * and the set must be prefix-free.
 */
export abstract class PrefixCodeBase<S extends SymbolKey = string>
  implements PrefixCode<S>
{
  readonly alphabet: ReadonlySet<S>;
  readonly weightedPathLength: number;

  protected readonly frequencies: ReadonlyMap<S, number>;
  private readonly codeMap: ReadonlyMap<S, string>;
  private readonly trie: TrieNode<S>;

  protected constructor(
    symbols: readonly S[],
    frequencies: ReadonlyMap<S, number>,
    codeWords: readonly string[],
  ) {
    if (symbols.length !== codeWords.length) {
      throw new RangeError("symbol and code length arrays must have equal length");
    }
    if (symbols.length === 0) {
      throw new RangeError("a prefix code requires at least one symbol");
    }

    const codes = new Map<S, string>();
    const trie = emptyTrie<S>();
    let weightedPathLength = 0;

    for (let index = 0; index < symbols.length; index++) {
      const symbol = symbols[index] as S;
      const code = codeWords[index] as string;
      assertSymbolKey(symbol);
      if (typeof code !== "string" || code.length === 0 || /[^01]/.test(code)) {
        throw new RangeError(`invalid code word for symbol ${String(symbol)}`);
      }
      if (codes.has(symbol)) {
        throw new RangeError(`duplicate symbol ${String(symbol)}`);
      }
      codes.set(symbol, code);

      let node = trie;
      for (let bitIndex = 0; bitIndex < code.length; bitIndex++) {
        if (node.hasSymbol) {
          throw new RangeError("code words are not prefix-free");
        }
        const bit = code[bitIndex] === "1" ? 1 : 0;
        let next = node.children[bit];
        if (next === undefined) {
          next = emptyTrie<S>();
          node.children[bit] = next;
        }
        node = next;
      }
      if (node.hasSymbol || node.children[0] !== undefined || node.children[1] !== undefined) {
        throw new RangeError("code words are not prefix-free");
      }
      node.hasSymbol = true;
      node.symbol = symbol;

      const frequency = frequencies.get(symbol);
      if (frequency === undefined) {
        throw new RangeError(`missing frequency for symbol ${String(symbol)}`);
      }
      weightedPathLength += frequency * code.length;
    }

    this.alphabet = new Set(symbols);
    this.frequencies = new Map(frequencies);
    this.codeMap = codes;
    this.trie = trie;
    this.weightedPathLength = weightedPathLength;
  }

  /** O(n): a copy of the symbol-to-code table. */
  codes(): ReadonlyMap<S, string> {
    return new Map(this.codeMap);
  }

  /** O(ℓ) per symbol: concatenates the code words, throwing RangeError for an unknown symbol. */
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

  /** O(bits): consumes a complete bit string; an invalid or truncated suffix throws RangeError. */
  decode(bits: string): S[] {
    if (typeof bits !== "string") {
      throw new TypeError("bits must be a string");
    }
    assertBits(bits);
    const symbols: S[] = [];
    let node = this.trie;
    for (let index = 0; index < bits.length; index++) {
      const next = node.children[bits[index] === "1" ? 1 : 0];
      if (next === undefined) {
        throw new RangeError(`invalid code word ending at bit ${index}`);
      }
      node = next;
      if (node.hasSymbol) {
        symbols.push(node.symbol as S);
        node = this.trie;
      }
    }
    if (node !== this.trie) {
      throw new RangeError("bit string ends in the middle of a code word");
    }
    return symbols;
  }

  /** O(n log n): checks that no code word is a prefix of another. */
  isPrefixFree(): boolean {
    const words = [...this.codeMap.values()].sort();
    for (let index = 1; index < words.length; index++) {
      if ((words[index] as string).startsWith(words[index - 1] as string)) {
        return false;
      }
    }
    return true;
  }

  /**
   * O(n log n): checks alphabet coverage, binary prefix-free code words, and that the recorded
   * weighted path length still equals Σ frequency(s) · length(code(s)).
   */
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
      if (frequency === undefined) {
        return `missing frequency for symbol ${String(symbol)}`;
      }
      weightedPathLength += frequency * code.length;
    }
    if (!this.isPrefixFree()) {
      return "code words are not prefix-free";
    }
    if (weightedPathLength !== this.weightedPathLength) {
      return "weighted path length is stale";
    }
    return true;
  }
}
