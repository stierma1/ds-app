import { assertBits, assertSymbolKey, buildHuffmanTree } from "./internal.ts";
import type { BuildNode } from "./internal.ts";
import type { AdaptivePrefixCode, SymbolKey } from "./types.ts";

/** `symbol` value of the not-yet-transmitted leaf. */
const NYT = -1;
/** `symbol` value of an internal node. */
const INTERNAL = -2;

/**
 * A node of the current adaptive tree. Leaves carry an alphabet index (or NYT); every non-root node
 * records its parent and which child it is, so a leaf's code can be read bottom-up in O(ℓ).
 */
interface CodeNode {
  symbol: number;
  parent: CodeNode | null;
  bit: 0 | 1;
  zero: CodeNode | null;
  one: CodeNode | null;
}

function bitIndex(value: number, width: number): string {
  return value.toString(2).padStart(width, "0");
}

/**
 * Adaptive Huffman code with a not-yet-transmitted (NYT) escape for unseen symbols.
 *
 * The alphabet is fixed at construction, so the escape can transmit an unseen symbol as a
 * fixed-width alphabet index after the NYT path. `update` folds one observation into the model and
 * rebuilds the Huffman tree over the current symbol weights plus the zero-weight NYT leaf while
 * some alphabet symbol is still unseen. Once every symbol has been seen the escape can never be
 * used again, so the NYT leaf is dropped and the tree is a plain Huffman tree over the observed
 * weights (no bit is wasted on the dead escape). With σ = 1 that tree is the single code `0`.
 * `reset` returns to the initial single-NYT model.
 *
 * The model is kept as an explicit tree with parent links, not as code strings: `update` costs
 * O(σ log σ) for the Huffman rebuild plus O(σ) to relink the tree and never builds a code word;
 * `encode` reads a leaf's path bottom-up in O(ℓ); `decode` walks the tree one bit at a time in
 * O(1) per bit. Only `codes()`, `isPrefixFree()`, and `validate()` materialize code words, which
 * costs Σℓ characters, the size of the table they return or check.
 */
export class AdaptiveHuffmanCode<S extends SymbolKey = string>
  implements AdaptivePrefixCode<S>
{
  readonly alphabet: ReadonlySet<S>;
  readonly rawWidth: number;

  private readonly symbols: readonly S[];
  private readonly indexOf: ReadonlyMap<S, number>;
  /** Observation count per alphabet index; 0 means not yet seen. */
  private readonly counts: number[];
  /** Alphabet indices in first-seen order (the Huffman tie-breaking order). */
  private seenOrder: number[] = [];
  private root!: CodeNode;
  /** The NYT leaf, or null once every alphabet symbol has been seen. */
  private nyt: CodeNode | null = null;
  /** Leaf for each alphabet index, or null while the symbol is unseen. */
  private leafOf: Array<CodeNode | null> = [];
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
    this.counts = new Array<number>(symbols.length).fill(0);
    this.rawWidth = Math.max(1, Math.ceil(Math.log2(symbols.length)));
    this.rebuild();
  }

  /** Current Σ weight(symbol) · length(code(symbol)) over symbols observed so far. */
  get weightedPathLength(): number {
    return this.length;
  }

  /**
   * O(σ + Σℓ): the current code for every alphabet symbol, including NYT escapes for unseen ones.
   * Σℓ is the total length of the returned code words.
   */
  codes(): ReadonlyMap<S, string> {
    const codes = new Map<S, string>();
    for (let index = 0; index < this.symbols.length; index++) {
      codes.set(this.symbols[index] as S, this.codeOf(index));
    }
    return codes;
  }

  /** O(ℓ) per symbol: never mutates the adaptive model; call update separately. */
  encode(symbols: Iterable<S>): string {
    let bits = "";
    for (const symbol of symbols) {
      const index = this.indexOf.get(symbol);
      if (index === undefined) {
        throw new RangeError(`symbol ${String(symbol)} is outside the alphabet`);
      }
      bits += this.codeOf(index);
    }
    return bits;
  }

  /**
   * O(1) per bit: walks the current tree bit by bit, accumulating the fixed-width index after an
   * NYT escape. Decodes against the current model; call update separately for each decoded symbol.
   * Throws RangeError for a truncated stream or a code word no encoder of this model emits (an
   * escape naming an index outside the alphabet or a symbol that already has its own leaf).
   */
  decode(bits: string): S[] {
    if (typeof bits !== "string") {
      throw new TypeError("bits must be a string");
    }
    assertBits(bits);
    const symbols: S[] = [];
    const root = this.root;
    const width = this.rawWidth;
    let node = root;
    let atWordStart = true;
    // Bits of the escape index still to read; 0 while walking the tree.
    let escapeRemaining = root === this.nyt ? width : 0;
    let escapeValue = 0;
    for (let index = 0; index < bits.length; index++) {
      const bit = bits.charCodeAt(index) === 49 ? 1 : 0;
      atWordStart = false;
      if (escapeRemaining > 0) {
        escapeValue = escapeValue * 2 + bit;
        escapeRemaining--;
        if (escapeRemaining === 0) {
          if (escapeValue >= this.symbols.length) {
            throw new RangeError("NYT escape names a symbol outside the alphabet");
          }
          if (this.leafOf[escapeValue] !== null) {
            throw new RangeError(
              `invalid code word ending at bit ${index}: NYT escape names an already-seen symbol`,
            );
          }
          symbols.push(this.symbols[escapeValue] as S);
          node = root;
          atWordStart = true;
          escapeValue = 0;
          escapeRemaining = root === this.nyt ? width : 0;
        }
        continue;
      }
      const next = bit === 1 ? node.one : node.zero;
      if (next === null) {
        throw new RangeError(`invalid code word ending at bit ${index}`);
      }
      node = next;
      if (node.symbol >= 0) {
        symbols.push(this.symbols[node.symbol] as S);
        node = root;
        atWordStart = true;
      } else if (node.symbol === NYT) {
        escapeRemaining = width;
        escapeValue = 0;
      }
    }
    if (!atWordStart) {
      throw new RangeError(
        escapeRemaining > 0
          ? "bit string ends in the middle of an NYT escape"
          : "bit string ends in the middle of a code word",
      );
    }
    return symbols;
  }

  /** O(Σℓ log σ): sorts the current code words and checks neighbours for a prefix relation. */
  isPrefixFree(): boolean {
    const words = [...this.codes().values()].sort();
    for (let index = 1; index < words.length; index++) {
      if ((words[index] as string).startsWith(words[index - 1] as string)) {
        return false;
      }
    }
    return true;
  }

  /**
   * O(σ + Σℓ log σ): checks the tree links, that every seen symbol (and only those) has a leaf,
   * that an NYT leaf exists iff some symbol is unseen, alphabet coverage, prefix-freeness, and the recorded weighted path
   * length.
   */
  validate(): true | string {
    const structure = this.checkTree();
    if (structure !== true) {
      return structure;
    }
    const codes = this.codes();
    if (codes.size !== this.alphabet.size) {
      return "code table does not cover the alphabet";
    }
    let weightedPathLength = 0;
    for (const symbol of this.alphabet) {
      const code = codes.get(symbol);
      if (code === undefined) {
        return `missing code for symbol ${String(symbol)}`;
      }
      if (code.length === 0 || /[^01]/.test(code)) {
        return `invalid code word for symbol ${String(symbol)}`;
      }
      const count = this.counts[this.indexOf.get(symbol) as number] as number;
      weightedPathLength += count * code.length;
    }
    if (!this.isPrefixFree()) {
      return "code words are not prefix-free";
    }
    if (weightedPathLength !== this.length) {
      return "weighted path length is stale";
    }
    return true;
  }

  /** O(σ log σ): records one observation and rebuilds the Huffman tree. */
  update(symbol: S): void {
    const index = this.indexOf.get(symbol);
    if (index === undefined) {
      throw new RangeError(`symbol ${String(symbol)} is outside the alphabet`);
    }
    if (this.counts[index] === 0) {
      this.seenOrder.push(index);
    }
    this.counts[index] = (this.counts[index] as number) + 1;
    this.rebuild();
  }

  /** O(σ): restores the initial single-NYT model. */
  reset(): void {
    this.counts.fill(0);
    this.seenOrder = [];
    this.rebuild();
  }

  /** O(ℓ): the code word for alphabet index `index` under the current tree. */
  private codeOf(index: number): string {
    const leaf = this.leafOf[index] ?? null;
    if (leaf !== null) {
      return pathOf(leaf);
    }
    // Unseen symbols exist only while the NYT leaf does.
    return pathOf(this.nyt as CodeNode) + bitIndex(index, this.rawWidth);
  }

  /**
   * O(σ log σ): Huffman tree over the seen weights (first-seen order) plus the zero-weight NYT
   * leaf while some symbol is unseen, relinked into CodeNodes in O(σ). No code strings are built.
   */
  private rebuild(): void {
    const seen = this.seenOrder;
    const leafOf = new Array<CodeNode | null>(this.symbols.length).fill(null);
    if (seen.length === 0) {
      const nyt: CodeNode = { symbol: NYT, parent: null, bit: 0, zero: null, one: null };
      this.root = nyt;
      this.nyt = nyt;
      this.leafOf = leafOf;
      this.length = 0;
      return;
    }
    const hasNyt = seen.length < this.symbols.length;
    const weights = seen.map((index) => this.counts[index] as number);
    if (hasNyt) {
      weights.push(0);
    }
    const root: CodeNode = { symbol: INTERNAL, parent: null, bit: 0, zero: null, one: null };
    if (weights.length === 1) {
      // σ = 1 and its only symbol has been seen: one leaf under the `0` edge, `1` is invalid.
      const index = seen[0] as number;
      const leaf: CodeNode = { symbol: index, parent: root, bit: 0, zero: null, one: null };
      root.zero = leaf;
      leafOf[index] = leaf;
      this.root = root;
      this.nyt = null;
      this.leafOf = leafOf;
      this.length = this.counts[index] as number;
      return;
    }
    const tree = buildHuffmanTree(weights);
    let nyt: CodeNode | null = null;
    let weightedPathLength = 0;
    const stack: Array<[BuildNode, CodeNode, number]> = [[tree, root, 0]];
    while (stack.length > 0) {
      const [source, target, depth] = stack.pop() as [BuildNode, CodeNode, number];
      if (source.symbol >= 0) {
        if (source.symbol === seen.length) {
          target.symbol = NYT;
          nyt = target;
        } else {
          const index = seen[source.symbol] as number;
          target.symbol = index;
          leafOf[index] = target;
          weightedPathLength += (this.counts[index] as number) * depth;
        }
        continue;
      }
      const zero: CodeNode = { symbol: INTERNAL, parent: target, bit: 0, zero: null, one: null };
      const one: CodeNode = { symbol: INTERNAL, parent: target, bit: 1, zero: null, one: null };
      target.zero = zero;
      target.one = one;
      stack.push([source.left as BuildNode, zero, depth + 1]);
      stack.push([source.right as BuildNode, one, depth + 1]);
    }
    this.root = root;
    this.nyt = nyt;
    this.leafOf = leafOf;
    this.length = weightedPathLength;
  }

  /** O(σ): structural checks on the tree and its correspondence with the observation counts. */
  private checkTree(): true | string {
    if (this.root.parent !== null) {
      return "root has a parent";
    }
    let leaves = 0;
    let nytLeaves = 0;
    const stack: CodeNode[] = [this.root];
    while (stack.length > 0) {
      const node = stack.pop() as CodeNode;
      if (node.symbol === INTERNAL) {
        // Only the σ = 1 tree has a one-child (the `0` edge) root.
        const unary = node === this.root && this.symbols.length === 1 && node.one === null;
        if (node.zero === null || (node.one === null && !unary)) {
          return "internal node is missing a child";
        }
        if (node.zero.parent !== node || node.zero.bit !== 0) {
          return "child links are inconsistent";
        }
        stack.push(node.zero);
        if (node.one !== null) {
          if (node.one.parent !== node || node.one.bit !== 1) {
            return "child links are inconsistent";
          }
          stack.push(node.one);
        }
        continue;
      }
      if (node.zero !== null || node.one !== null) {
        return "leaf has children";
      }
      if (node.symbol === NYT) {
        if (node !== this.nyt) {
          return "NYT leaf is not the recorded one";
        }
        nytLeaves++;
      } else {
        if (this.leafOf[node.symbol] !== node || this.counts[node.symbol] === 0) {
          return `leaf for symbol index ${node.symbol} does not match the model`;
        }
        leaves++;
      }
    }
    const someUnseen = this.seenOrder.length < this.symbols.length;
    if (someUnseen && nytLeaves !== 1) {
      return "NYT leaf is missing while some symbol is unseen";
    }
    if (!someUnseen && (nytLeaves !== 0 || this.nyt !== null)) {
      return "NYT leaf is present although every symbol has been seen";
    }
    if (leaves !== this.seenOrder.length) {
      return "seen symbols and leaves differ";
    }
    for (let index = 0; index < this.counts.length; index++) {
      if (((this.counts[index] as number) > 0) !== (this.leafOf[index] !== null)) {
        return `symbol index ${index} has a leaf iff it was observed: violated`;
      }
    }
    return true;
  }
}

/** O(ℓ): the root-to-`node` path read bottom-up through parent links. */
function pathOf(node: CodeNode): string {
  const bits: string[] = [];
  for (let current: CodeNode = node; current.parent !== null; current = current.parent) {
    bits.push(current.bit === 1 ? "1" : "0");
  }
  return bits.reverse().join("");
}
