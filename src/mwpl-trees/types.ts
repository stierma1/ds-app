/** Symbol keys accepted by prefix codes: strings for text alphabets, numbers for integer alphabets. */
export type SymbolKey = string | number;

/**
 * A binary prefix code over a fixed alphabet. This is a codec, not a container: elements are
 * symbols with an associated bit string, not a sequence of values.
 *
 * `encode` concatenates codes without separators and throws RangeError for a symbol outside the
 * alphabet. `decode` consumes a complete bit string and throws RangeError for an invalid or
 * truncated suffix. `weightedPathLength` is Σ frequency(s) · length(code(s)) for static codes and
 * the current model's value for adaptive codes.
 */
export interface PrefixCode<S extends SymbolKey = string> {
  readonly alphabet: ReadonlySet<S>;
  readonly weightedPathLength: number;
  codes(): ReadonlyMap<S, string>;
  encode(symbols: Iterable<S>): string;
  decode(bits: string): S[];
  isPrefixFree(): boolean;
  validate(): true | string;
}

/** Construction options shared by length-bounded codes. */
export interface CodeOptions {
  maxLength?: number;
}

/**
 * A prefix code whose tree changes as symbols are observed. `update` folds one observation into
 * the model; `reset` restores the initial not-yet-transmitted state.
 */
export interface AdaptivePrefixCode<S extends SymbolKey = string>
  extends PrefixCode<S> {
  update(symbol: S): void;
  reset(): void;
}
