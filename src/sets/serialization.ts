import {
  assertDefined,
  parseSerialized,
  readArray,
  serializeRecord,
} from "../core/index.ts";

/** O(n): wraps a flat value array in a versioned record. */
export function serializeValues(type: string, values: readonly unknown[]): string {
  return serializeRecord(type, { values });
}

/** O(n): parses and validates the record and rejects any undefined element. */
export function deserializeValues(json: unknown, type: string): unknown[] {
  const record = parseSerialized(json, type);
  const values = readArray(record, "values");
  for (const value of values) {
    assertDefined(value as never);
  }
  return values;
}

/** O(total elements): wraps an array of groups (used by the union-find family). */
export function serializeSets(type: string, sets: readonly (readonly unknown[])[]): string {
  return serializeRecord(type, { sets });
}

/** O(total elements): checks that every group is an array of defined values. */
export function deserializeSets(json: unknown, type: string): unknown[][] {
  const record = parseSerialized(json, type);
  const sets = readArray(record, "sets");
  const result: unknown[][] = [];
  for (let index = 0; index < sets.length; index++) {
    const values = sets[index];
    if (!Array.isArray(values)) {
      throw new TypeError(`sets[${index}] must be an array`);
    }
    for (const value of values) {
      assertDefined(value as never);
    }
    result.push(values);
  }
  return result;
}
