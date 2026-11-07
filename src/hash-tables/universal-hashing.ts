import { assertDefined, readOptionalInteger } from "../core/index.ts";
import { createRng, log2Exact, mix32 } from "./hash.ts";
import { SeparateChaining } from "./separate-chaining.ts";
import { parseMap, serializeMap } from "./serialization.ts";
import type { UniversalHashOptions } from "./types.ts";

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

  override serialize(): string {
    return serializeMap(
      "UniversalHashing",
      this._capacity,
      this._loadFactor,
      this.collectEntries(),
      { seed: this._seed },
    );
  }

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
