import {
  assertDefined,
  parseSerialized,
  readArray,
  serializeRecord,
} from "../core/index.ts";
import type { SerializedRecord } from "../core/index.ts";

/** O(n): wraps the queue's values (in iteration order) with a versioned type tag. */
export function serializeDepq(
  type: string,
  values: readonly unknown[],
  payload: Record<string, unknown> = {},
): string {
  return serializeRecord(type, { values, ...payload });
}

/**
 * O(size of json): parses and validates a double-ended priority queue payload
 * and returns a copy of its values.
 */
export function parseDepq(
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
