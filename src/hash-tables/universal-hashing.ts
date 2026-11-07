import { assertDefined, readOptionalInteger } from "../core/index.ts";
import { createRng, log2Exact, mix32 } from "./hash.ts";
import { SeparateChaining } from "./separate-chaining.ts";
import { parseMap, serializeMap } from "./serialization.ts";
import type { UniversalHashOptions } from "./types.ts";

/**
 * SeparateChaining whose bucket index comes from a seeded multiply-shift hash:
 * (a * (h ^ mix32(seed))) >>> (32 - log2(capacity)), with the odd multiplier `a` drawn from a
 * PRNG seeded by `seed`. Different seeds pick different members of the family, so a key set that
 * clusters under one seed is spread under another; with the default seed the function is fixed,
 * so pass a random `seed` to get the randomized guarantee. Same expected O(1) operations and
 * O(n + capacity) doubling as SeparateChaining, plus one imul per hash. Two costs to know: the
 * stored hash is capacity-dependent, so every rehash must recompute it; and it only has
 * log2(capacity) bits, so every entry in a bucket passes the hash pre-check and reaches `equals`
 * (a chain scan calls `equals` once per entry rather than once per true collision).
 */
export class UniversalHashing<K, V> extends SeparateChaining<K, V> {
  private readonly _seed: number;
  private readonly _multiplier: number;

  constructor(options: UniversalHashOptions<K> = {}) {
    super(options);
    this._seed = options.seed ?? 0x9e3779b9;
    if (!Number.isInteger(this._seed)) {
      throw new TypeError("seed must be an integer");
    }
    let multiplier = createRng(this._seed)() | 1;
    if (multiplier === 0) {
      multiplier = 1;
    }
    this._multiplier = multiplier;
  }

  /** O(n + capacity); records the seed so deserialize reproduces the same layout. */
  override serialize(): string {
    return serializeMap(
      "UniversalHashing",
      this._capacity,
      this._loadFactor,
      this.collectEntries(),
      { seed: this._seed },
    );
  }

  /**
   * O(1) on top of the base hash: multiply-shift down to log2(capacity) bits, so the result is
   * already the bucket index.
   */
  protected override hashKey(key: K): number {
    assertDefined(key, "key");
    const base = this._hash(key);
    const bits = log2Exact(this._capacity);
    if (bits === 0) {
      return 0;
    }
    return (Math.imul(this._multiplier, base ^ mix32(this._seed)) >>> (32 - bits)) >>> 0;
  }

  protected override get serializationType(): string {
    return "UniversalHashing";
  }

  /** O(n) expected re-insertion with the stored seed, then an O(n + capacity) validate. */
  static override deserialize<K, V>(
    json: unknown,
    options: UniversalHashOptions<K> = {},
  ): UniversalHashing<K, V> {
    const parsed = parseMap<K, V>(json, "UniversalHashing");
    const seed = readOptionalInteger(parsed.record, "seed");
    const table = new UniversalHashing<K, V>({
      ...options,
      capacity: options.capacity ?? parsed.capacity,
      loadFactor: options.loadFactor ?? parsed.loadFactor,
      ...(seed === undefined ? {} : { seed }),
    });
    for (const [key, value] of parsed.entries) {
      table.set(key, value);
    }
    if (table.validate() !== true) {
      throw new TypeError(`Invalid UniversalHashing payload: ${table.validate()}`);
    }
    return table;
  }
}
