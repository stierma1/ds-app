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
