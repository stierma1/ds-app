import { assertDefined } from "../core/index.ts";
import type { HashOptions } from "./types.ts";

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

/** O(1): 32-bit avalanche finalizer (two imul/xor-shift rounds) used to spread weak hashes. */
export function mix32(value: number): number {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** O(length): FNV-1a over UTF-16 code units, one xor and one imul per character. */
export function hashString(value: string): number {
  let hash = FNV_OFFSET;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

function hashNumber(value: number): number {
  if (Number.isInteger(value) && value >= 0 && value <= 0xffffffff) {
    return mix32(value);
  }
  if (Number.isInteger(value) && value < 0 && value >= -0x80000000) {
    return mix32(value >>> 0);
  }
  if (Object.is(value, -0)) {
    return hashString("-0");
  }
  return hashString(String(value));
}

function hashBoolean(value: boolean): number {
  return value ? 0x9e3779b1 : 0x85ebca6b;
}

function hashArray(value: readonly unknown[], seen: Set<object>): number {
  let hash = 0x811c9dc5;
  hash = Math.imul(hash ^ 0x5bd1e995, FNV_PRIME);
  for (let index = 0; index < value.length; index++) {
    const element = value[index];
    hash ^= Math.imul(hashValueInternal(element, seen) + index, FNV_PRIME);
    hash = mix32(hash);
  }
  return hash >>> 0;
}

function hashRecord(value: Record<string, unknown>, seen: Set<object>): number {
  const keys = Object.keys(value).sort();
  let hash = 0x27d4eb2f;
  for (const key of keys) {
    hash ^= hashString(key);
    hash = Math.imul(hash, FNV_PRIME);
    hash ^= mix32(hashValueInternal(value[key], seen));
    hash = mix32(hash);
  }
  return hash >>> 0;
}

function hashValueInternal(value: unknown, seen: Set<object>): number {
  if (value === undefined) {
    throw new TypeError("Cannot hash undefined");
  }
  if (value === null) {
    return 0x6a09e667;
  }
  switch (typeof value) {
    case "number":
      return hashNumber(value);
    case "bigint":
      return hashString(value.toString());
    case "string":
      return hashString(value);
    case "boolean":
      return hashBoolean(value);
    case "symbol":
    case "function":
      throw new TypeError(`Cannot hash a ${typeof value}`);
    case "object": {
      if (value instanceof Date) {
        return hashNumber(value.getTime());
      }
      if (seen.has(value)) {
        throw new TypeError("Cannot hash a cyclic value");
      }
      seen.add(value);
      try {
        if (Array.isArray(value)) {
          return hashArray(value, seen);
        }
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
          throw new TypeError(
            "Default hash supports primitives, Date, arrays, and plain records; supply a hash function",
          );
        }
        return hashRecord(value as Record<string, unknown>, seen);
      } finally {
        seen.delete(value);
      }
    }
    default:
      throw new TypeError(`Cannot hash a ${typeof value}`);
  }
}

/**
 * Structural default hash. Cost depends on the key type:
 * - integers in [-2^31, 2^32): O(1) via mix32; other numbers and bigints are stringified first,
 *   so they cost O(digits) FNV hashing;
 * - strings: O(length); booleans, null and Date: O(1);
 * - arrays: O(total element count), recursive; plain records: O(k log k) to sort the k keys plus
 *   recursive hashing of every value.
 * Throws for undefined, symbols, functions, class instances (anything whose prototype is not
 * Object.prototype or null) and cyclic values, and allocates a Set per top-level call for cycle
 * detection. Records and arrays hash by content, but the default `equals` is Object.is, so two
 * equal-content objects land in the same chain yet remain distinct keys; supply `equals` (or key
 * by a primitive id) for structural keys.
 */
export function defaultHash<T>(value: T): number {
  return hashValueInternal(value, new Set());
}

/** O(1): rejects non-finite results and truncates to uint32 with >>> 0. */
export function normalizeHash(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError("Hash function must return a finite number");
  }
  return value >>> 0;
}

/** Returns defaultHash itself, or the user hash wrapped so every call also pays normalizeHash. */
export function resolveHash<K>(
  hash?: (key: K) => number,
): (key: K) => number {
  if (hash === undefined) {
    return defaultHash;
  }
  if (typeof hash !== "function") {
    throw new TypeError("Hash function must be a function");
  }
  return (key: K): number => normalizeHash(hash(key));
}

/** Defaults to Object.is (NaN equals NaN, +0 differs from -0), not ===. */
export function resolveEquals<K>(
  equals?: (a: K, b: K) => boolean,
): (a: K, b: K) => boolean {
  if (equals === undefined) {
    return Object.is;
  }
  if (typeof equals !== "function") {
    throw new TypeError("Equals function must be a function");
  }
  return equals;
}

/** O(log value) doubling loop; rejects results above 2^30. */
export function nextPowerOfTwo(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError("capacity must be a positive integer");
  }
  let capacity = 1;
  while (capacity < value) {
    capacity *= 2;
    if (capacity > 0x40000000) {
      throw new RangeError("capacity is too large");
    }
  }
  return capacity;
}

/** Default 16; otherwise rounded up to a power of two so bucket index is `hash & (cap - 1)`. */
export function resolveCapacity(capacity?: number): number {
  if (capacity === undefined) {
    return 16;
  }
  return nextPowerOfTwo(capacity);
}

/** Default 0.75. No upper bound here; tables that need loadFactor < 1 assert it themselves. */
export function resolveLoadFactor(
  loadFactor?: number,
  fallback = 0.75,
): number {
  const value = loadFactor ?? fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new TypeError("loadFactor must be a positive finite number");
  }
  return value;
}

export function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
}

/** Convenience bundle of the four resolve* helpers above; O(1). */
export function resolveOptions<K>(options: HashOptions<K> = {}): {
  hash: (key: K) => number;
  equals: (a: K, b: K) => boolean;
  capacity: number;
  loadFactor: number;
} {
  return {
    hash: resolveHash(options.hash),
    equals: resolveEquals(options.equals),
    capacity: resolveCapacity(options.capacity),
    loadFactor: resolveLoadFactor(options.loadFactor),
  };
}

/**
 * Seeded mulberry32-style PRNG: O(1) per draw and deterministic for a given seed. Used to pick
 * multipliers for UniversalHashing and PerfectHashing, so the same seed reproduces the same layout.
 */
export function createRng(seed: number): () => number {
  assertDefined(seed, "seed");
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0);
  };
}

/** O(1); throws unless value is a positive power of two. */
export function log2Exact(value: number): number {
  if (value <= 0 || (value & (value - 1)) !== 0) {
    throw new RangeError("value must be a positive power of two");
  }
  return Math.log2(value);
}
