import {
  assertDefined,
  parseSerialized,
  readArray,
  readValue,
  serializeRecord,
} from "../core/index.ts";
import type { SerializedRecord } from "../core/index.ts";

/** O(n): wraps the heap's values (in iteration order) with a versioned type tag. */
export function serializeHeap(
  type: string,
  values: readonly unknown[],
  payload: Record<string, unknown> = {},
): string {
  return serializeRecord(type, { values, ...payload });
}

/**
 * O(size of json): parses and validates a heap payload and returns both the record (for
 * implementation-specific fields) and a copy of the values array.
 */
export function parseHeap(
  json: unknown,
  type: string,
): { record: SerializedRecord; values: unknown[] } {
  const record = parseSerialized(json, type);
  const values = readArray(record, "values");
  for (const value of values) {
    assertDefined(value);
  }
  return { record, values: [...values] };
}

/** O(n): serializes an event/index payload as an array of `[key, value]` pairs. */
export function serializeEntries(
  type: string,
  entries: ReadonlyArray<readonly [unknown, unknown]>,
  payload: Record<string, unknown> = {},
): string {
  return serializeRecord(type, { entries, ...payload });
}

/**
 * O(size of json): parses `entries` as an array of two-element arrays and rejects undefined keys,
 * values, or malformed pairs.
 */
export function parseEntries(
  json: unknown,
  type: string,
): { record: SerializedRecord; entries: Array<[unknown, unknown]> } {
  const record = parseSerialized(json, type);
  const raw = readArray(record, "entries");
  const entries: Array<[unknown, unknown]> = [];
  for (let index = 0; index < raw.length; index++) {
    const pair = raw[index];
    if (!Array.isArray(pair) || pair.length !== 2) {
      throw new TypeError(`entries[${index}] must be a [key, value] pair`);
    }
    const [key, value] = pair;
    assertDefined(key, "key");
    assertDefined(value, "value");
    entries.push([key, value]);
  }
  return { record, entries };
}

export interface SerializedEvent {
  id: number;
  time: number;
  seq: number;
  value: unknown;
}

/** O(n): serializes timer events as `[id, time, seq, value]` tuples. */
export function serializeEvents(
  type: string,
  events: readonly SerializedEvent[],
  payload: Record<string, unknown> = {},
): string {
  return serializeRecord(type, {
    events: events.map((event) => [event.id, event.time, event.seq, event.value]),
    ...payload,
  });
}

/**
 * O(size of json): parses `[id, time, seq, value]` tuples, rejecting malformed records and
 * undefined values.
 */
export function parseEvents(
  json: unknown,
  type: string,
): { record: SerializedRecord; events: SerializedEvent[] } {
  const record = parseSerialized(json, type);
  const raw = readArray(record, "events");
  const events: SerializedEvent[] = [];
  for (let index = 0; index < raw.length; index++) {
    const tuple = raw[index];
    if (!Array.isArray(tuple) || tuple.length !== 4) {
      throw new TypeError(`events[${index}] must be an [id, time, seq, value] tuple`);
    }
    const [id, time, seq, value] = tuple;
    if (typeof id !== "number" || !Number.isInteger(id) || id < 1) {
      throw new TypeError(`events[${index}][0] must be a positive integer id`);
    }
    if (typeof time !== "number" || !Number.isFinite(time)) {
      throw new TypeError(`events[${index}][1] must be a finite time`);
    }
    if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 0) {
      throw new TypeError(`events[${index}][2] must be a non-negative integer seq`);
    }
    const defined = readValue(value, `events[${index}][3]`);
    events.push({ id, time, seq, value: defined });
  }
  return { record, events };
}

/** O(1): reads a required defined value of type T. */
export function readTyped<T>(value: unknown, name: string): T {
  return readValue<T>(value, name);
}

/**
 * O(1) wrapper for deserializers: runs `restore` and reports any RangeError raised while rebuilding
 * from a payload (bad geometry, out-of-range keys or counters) as the TypeError the serialization
 * contract requires for malformed input.
 */
export function restoreFromPayload<R>(type: string, restore: () => R): R {
  try {
    return restore();
  } catch (error) {
    if (error instanceof RangeError) {
      throw new TypeError(`Invalid ${type} payload: ${error.message}`);
    }
    throw error;
  }
}
