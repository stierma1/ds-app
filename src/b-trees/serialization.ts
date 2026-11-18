import {
  parseSerialized,
  readArray,
  readValue,
  serializeRecord,
} from "../core/index.ts";

/**
 * O(n): validates that every entry has a defined key and value, then JSON-encodes the in-order
 * entry list with the shared `{ type, version, entries }` shape.
 */
export function serializeBTreeEntries(
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
 * O(size of json): parses and validates a B-tree payload. Each entry must be a two-element
 * `[key, value]` pair with neither side undefined.
 */
export function readBTreeEntries<K, V>(
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
