import { assertDefined } from "../core/index.ts";
import type { HashOptions } from "./types.ts";

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

export function mix32(value: number): number {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

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

export function defaultHash<T>(value: T): number {
  return hashValueInternal(value, new Set());
}

export function normalizeHash(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError("Hash function must return a finite number");
  }
  return value >>> 0;
}

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

export function resolveCapacity(capacity?: number): number {
  if (capacity === undefined) {
    return 16;
  }
  return nextPowerOfTwo(capacity);
}

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

export function log2Exact(value: number): number {
  if (value <= 0 || (value & (value - 1)) !== 0) {
    throw new RangeError("value must be a positive power of two");
  }
  return Math.log2(value);
}
