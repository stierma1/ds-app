import {
  assertDefined,
  parseSerialized,
  readArray,
  serializeRecord,
} from "../core/index.ts";

export function serializeValues(type: string, values: readonly unknown[]): string {
  return serializeRecord(type, { values });
}

export function deserializeValues(json: unknown, type: string): unknown[] {
  const record = parseSerialized(json, type);
  const values = readArray(record, "values");
  for (const value of values) {
    assertDefined(value as never);
  }
  return values;
}

export function serializeSets(type: string, sets: readonly (readonly unknown[])[]): string {
  return serializeRecord(type, { sets });
}

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
