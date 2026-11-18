import {
  assertDefined,
  parseSerialized,
  readArray,
  readValue,
  serializeRecord,
} from "../core/index.ts";

/**
 * O(n): validates that every entry has a defined key and value, then encodes the in-order entry
 * list with the shared `{ type, version, entries }` shape. Priorities, skip-list levels, and RNG
 * state are deliberately omitted.
 */
export function serializeRandomizedEntries(
  type: string,
  entries: ReadonlyArray<readonly [unknown, unknown]>,
): string {
  for (const entry of entries) {
    if (entry[0] === undefined || entry[1] === undefined) {
      throw new TypeError("Cannot serialize an undefined key or value");
    }
  }
  return serializeRecord(type, { entries });
}

/**
 * O(size of json): parses and validates an ordered randomized payload. Each entry must be a
 * two-element `[key, value]` pair with neither side undefined.
 */
export function readRandomizedEntries<K, V>(
  json: unknown,
  type: string,
): Array<[K, V]> {
  const record = parseSerialized(json, type);
  const raw = readArray(record, "entries");
  const entries: Array<[K, V]> = [];
  for (let index = 0; index < raw.length; index++) {
    const entry = raw[index];
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new TypeError(`entries[${index}] must be a [key, value] pair`);
    }
    const key = readValue<K>(entry[0], `entries[${index}][0]`);
    const value = readValue<V>(entry[1], `entries[${index}][1]`);
    entries.push([key, value]);
  }
  return entries;
}

/** O(n): wraps a heap's values in iteration order with a versioned type tag. */
export function serializeRandomizedValues(
  type: string,
  values: readonly unknown[],
): string {
  for (const value of values) {
    if (value === undefined) {
      throw new TypeError("Cannot serialize an undefined value");
    }
  }
  return serializeRecord(type, { values });
}

/** O(size of json): parses and validates a randomized heap payload and copies its values. */
export function readRandomizedValues(json: unknown, type: string): unknown[] {
  const record = parseSerialized(json, type);
  const values = readArray(record, "values");
  for (const value of values) {
    assertDefined(value);
  }
  return [...values];
}
