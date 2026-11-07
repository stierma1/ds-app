import {
  assertDefined,
  parseSerialized,
  readArray,
  readInteger,
  readNumber,
  readObject,
  readValue,
  serializeRecord,
} from "../core/index.ts";
import type { SerializedRecord } from "../core/index.ts";

export interface ParsedHashTable<K, V> {
  record: SerializedRecord;
  capacity: number;
  loadFactor: number;
  entries: Array<[K, V]>;
}

/**
 * O(n) to copy and validate the entries into a payload array, then JSON.stringify of the whole
 * record (O(serialized size)); the intermediate copy doubles peak memory for the entries.
 */
export function serializeMap(
  type: string,
  capacity: number,
  loadFactor: number,
  entries: Iterable<[unknown, unknown]>,
  extra: Record<string, unknown> = {},
): string {
  const payload: Array<[unknown, unknown]> = [];
  for (const [key, value] of entries) {
    assertDefined(key, "key");
    assertDefined(value, "value");
    payload.push([key, value]);
  }
  return serializeRecord(type, {
    capacity,
    loadFactor,
    ...extra,
    entries: payload,
  });
}

/**
 * O(n): validates every [key, value] pair into a fresh entries array; callers re-insert them one
 * by one (or restore a layout), so deserialization is at least O(n) on top of JSON.parse.
 */
export function parseMap<K, V>(
  json: unknown,
  type: string,
): ParsedHashTable<K, V> {
  const record = parseSerialized(json, type);
  const capacity = readInteger(record, "capacity");
  if (capacity <= 0) {
    throw new TypeError("capacity must be positive");
  }
  const loadFactor = readNumber(record, "loadFactor");
  if (!(loadFactor > 0)) {
    throw new TypeError("loadFactor must be positive");
  }
  const rawEntries = readArray(record, "entries");
  const entries: Array<[K, V]> = [];
  for (let index = 0; index < rawEntries.length; index++) {
    const pair = rawEntries[index];
    if (!Array.isArray(pair) || pair.length !== 2) {
      throw new TypeError(`entries[${index}] must be a [key, value] pair`);
    }
    const key = readValue<K>(pair[0], `entries[${index}][0]`);
    const value = readValue<V>(pair[1], `entries[${index}][1]`);
    entries.push([key, value]);
  }
  return { record, capacity, loadFactor, entries };
}

export function readExtraInteger(
  record: SerializedRecord,
  key: string,
): number {
  return readInteger(record, key);
}

export function readExtraNumber(
  record: SerializedRecord,
  key: string,
): number {
  return readNumber(record, key);
}

export function readExtraObject(
  record: SerializedRecord,
  key: string,
): Record<string, unknown> {
  return readObject(record[key], key);
}
