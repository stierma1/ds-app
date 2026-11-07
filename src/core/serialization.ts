/** Version stamped into every serialized record; parseSerialized rejects any other value. */
export const SERIALIZATION_VERSION = 1;

/**
 * Anything that can emit itself as a JSON string via serialize(). Every container's output is O(n)
 * in its contents (or O(capacity) for the bit-array filters).
 */
export interface Serializable {
  serialize(): string;
}

/**
 * Static counterpart of Serializable: `deserialize` accepts either a JSON string or an
 * already-parsed object.
 */
export interface SerializableConstructor<T> {
  deserialize(json: unknown): T;
}

/**
 * Shape of every serialized container: a `type` tag, a `version`, and type-specific payload fields.
 */
export interface SerializedRecord {
  type: string;
  version: number;
  [key: string]: unknown;
}

/** O(size of payload): a single JSON.stringify of `{ type, version, ...payload }`. */
export function serializeRecord(
  type: string,
  payload: Record<string, unknown>,
): string {
  return JSON.stringify({ type, version: SERIALIZATION_VERSION, ...payload });
}

/**
 * O(length of json) when given a string (one JSON.parse); O(1) when given an already-parsed object,
 * which is returned as-is without copying. Validates the type tag and version and throws TypeError
 * otherwise.
 */
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

/**
 * O(1) field accessor; throws TypeError unless the field is an array. The array is returned, not
 * copied.
 */
export function readArray(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new TypeError(`${key} must be an array`);
  }
  return value;
}

/** O(1); throws TypeError unless the field is a finite number. */
export function readNumber(record: Record<string, unknown>, key: string): number {
  return readNumberValue(record[key], key);
}

/** O(1) finite-number check on a bare value. */
export function readNumberValue(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
  return value;
}

/** O(1); throws TypeError unless the field is a finite integer. */
export function readInteger(record: Record<string, unknown>, key: string): number {
  const value = readNumber(record, key);
  if (!Number.isInteger(value)) {
    throw new TypeError(`${key} must be an integer`);
  }
  return value;
}

/** O(1); `undefined` when the field is absent, otherwise the same check as readInteger. */
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

/** O(1); throws TypeError unless the field is a string. */
export function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new TypeError(`${key} must be a string`);
  }
  return value;
}

/** O(1); throws TypeError unless the value is a non-null, non-array object. */
export function readObject(
  value: unknown,
  name: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

/** O(1); rejects `undefined` only and passes any other value through as T unchecked. */
export function readValue<T>(value: unknown, name: string): T {
  if (value === undefined) {
    throw new TypeError(`${name} must not be undefined`);
  }
  return value as T;
}
