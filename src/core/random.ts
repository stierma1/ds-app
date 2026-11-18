/**
 * Minimal source of uniformly distributed numbers in `[0, 1)`. Randomized structures accept any
 * object with `next()`, so tests and applications can inject their own generator. Use
 * {@link SeededRandom} or {@link createRandomSource} for the library's reproducible xoshiro128**
 * generator.
 */
export interface RandomSource {
  next(): number;
}

/**
 * splitmix32 seeding: expands one 32-bit seed into an arbitrary stream of well-mixed 32-bit words.
 * Used only to fill the four xoshiro128** state words, never to generate user-facing randomness.
 */
function splitmix32(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x9e3779b9) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 16), 0x21f0aaad) >>> 0;
    value = Math.imul(value ^ (value >>> 15), 0x735a2d97) >>> 0;
    return (value ^ (value >>> 15)) >>> 0;
  };
}

/** O(1): 32 bits from the platform CSPRNG when available, otherwise a time/math fallback. */
export function randomSeed(): number {
  const source = (
    globalThis as {
      crypto?: { getRandomValues?: (array: Uint32Array) => Uint32Array };
    }
  ).crypto;
  if (source !== undefined && typeof source.getRandomValues === "function") {
    const words = new Uint32Array(1);
    source.getRandomValues(words);
    return words[0] as number;
  }
  const clock = Date.now() >>> 0;
  const noise = Math.floor(Math.random() * 0x1_0000_0000) >>> 0;
  return (clock ^ noise) >>> 0;
}

/** O(1): 32-bit left rotation; the shift by 32 would be a no-op in JavaScript. */
function rotateLeft(value: number, shift: number): number {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

/**
 * Seeded xoshiro128** generator. The algorithm uses only 32-bit integer operations, so the same
 * seed produces the same stream on every JavaScript platform. `next()` returns a double in
 * `[0, 1)` with 32 bits of resolution; `nextUint32()` returns the raw word.
 *
 * A 32-bit seed is expanded by splitmix32. An omitted seed is drawn from the platform CSPRNG and
 * kept in `seed`, so a failing randomized run can be replayed.
 */
export class SeededRandom implements RandomSource {
  /** The normalized 32-bit seed this instance was created from. */
  readonly seed: number;
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  /** O(1); throws TypeError when `seed` is not an integer. */
  constructor(seed?: number) {
    const resolved = seed === undefined ? randomSeed() : seed;
    if (typeof resolved !== "number" || !Number.isInteger(resolved)) {
      throw new TypeError("seed must be an integer");
    }
    this.seed = resolved >>> 0;
    const fill = splitmix32(this.seed);
    this.s0 = fill();
    this.s1 = fill();
    this.s2 = fill();
    this.s3 = fill();
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) {
      this.s0 = 0x9e3779b9;
    }
  }

  /** O(1): the next 32-bit unsigned integer. */
  nextUint32(): number {
    const s0 = this.s0;
    const s1 = this.s1;
    const s2 = this.s2;
    const s3 = this.s3;
    const result = Math.imul(rotateLeft(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
    const shifted = (s1 << 9) >>> 0;

    this.s2 = (s2 ^ s0) >>> 0;
    this.s3 = (s3 ^ s1) >>> 0;
    this.s1 = (s1 ^ this.s2) >>> 0;
    this.s0 = (s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ shifted) >>> 0;
    this.s3 = rotateLeft(this.s3, 11);

    return result;
  }

  /** O(1): a double in `[0, 1)` with 32 bits of resolution. */
  next(): number {
    return this.nextUint32() / 0x1_0000_0000;
  }

  /**
   * O(1): true with the given probability. Probabilities outside `[0, 1]` throw RangeError; this is
   * the single place randomized structures turn a draw into a coin flip.
   */
  boolean(probability = 0.5): boolean {
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new RangeError("probability must be in [0, 1]");
    }
    return this.next() < probability;
  }

  /** O(1): a uniformly distributed integer in `[min, maxExclusive)`. */
  integer(min: number, maxExclusive: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(maxExclusive)) {
      throw new TypeError("bounds must be integers");
    }
    if (maxExclusive <= min) {
      throw new RangeError("maxExclusive must be greater than min");
    }
    return min + Math.floor(this.next() * (maxExclusive - min));
  }
}

/** O(1): a new {@link SeededRandom}; `seed` defaults to a CSPRNG value. */
export function createRandomSource(seed?: number): SeededRandom {
  return new SeededRandom(seed);
}

/**
 * O(1): normalizes the `rng` constructor option. A number becomes a {@link SeededRandom}; an
 * object providing `next()` is used as-is; `undefined` creates a CSPRNG-seeded generator. Anything
 * else throws TypeError.
 */
export function resolveRandomSource(
  rng?: RandomSource | number,
): RandomSource {
  if (rng === undefined) {
    return new SeededRandom();
  }
  if (typeof rng === "number") {
    return new SeededRandom(rng);
  }
  if (
    rng !== null &&
    typeof rng === "object" &&
    typeof (rng as RandomSource).next === "function"
  ) {
    return rng;
  }
  throw new TypeError("rng must be a RandomSource or an integer seed");
}
