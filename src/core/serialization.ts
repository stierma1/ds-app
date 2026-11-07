export const SERIALIZATION_VERSION = 1;

export interface Serializable {
  serialize(): string;
}

export interface SerializableConstructor<T> {
  deserialize(json: unknown): T;
}

export interface SerializedRecord {
  type: string;
  version: number;
  [key: string]: unknown;
}

export function serializeRecord(
  type: string,
  payload: Record<string, unknown>,
): string {
  return JSON.stringify({ type, version: SERIALIZATION_VERSION, ...payload });
}

export function parseSerialized(
  json: unknown,
  expectedType: string | readonly string[],
): SerializedRecord {
  let parsed: unknown = json;
  if (typeof json === "string") {
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new TypeError("Serialized value is not valid JSON");
    }
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("Serialized value must be an object");
  }
  const record = parsed as Record<string, unknown>;
  const expected = typeof expectedType === "string" ? [expectedType] : expectedType;
  if (typeof record.type !== "string" || !expected.includes(record.type)) {
    throw new TypeError(`Expected serialized type ${expected.join(" or ")}`);
  }
  if (record.version !== SERIALIZATION_VERSION) {
    throw new TypeError(`Unsupported serialization version ${String(record.version)}`);
  }
  return record as SerializedRecord;
}

export function readArray(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new TypeError(`${key} must be an array`);
  }
  return value;
}

export function readNumber(record: Record<string, unknown>, key: string): number {
  return readNumberValue(record[key], key);
}

export function readNumberValue(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
  return value;
}

export function readInteger(record: Record<string, unknown>, key: string): number {
  const value = readNumber(record, key);
  if (!Number.isInteger(value)) {
    throw new TypeError(`${key} must be an integer`);
  }
  return value;
}

export function readOptionalInteger(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  const number = readNumberValue(value, key);
  if (!Number.isInteger(number)) {
    throw new TypeError(`${key} must be an integer`);
  }
  return number;
}

export function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new TypeError(`${key} must be a string`);
  }
  return value;
}

export function readObject(
  value: unknown,
  name: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function readValue<T>(value: unknown, name: string): T {
  if (value === undefined) {
    throw new TypeError(`${name} must not be undefined`);
  }
  return value as T;
}
