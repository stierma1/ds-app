export type Comparator<T> = (a: T, b: T) => number;

function primitiveCompare(a: unknown, b: unknown): number | undefined {
  if (typeof a === "number" && typeof b === "number") {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (typeof a === "bigint" && typeof b === "bigint") {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (typeof a === "string" && typeof b === "string") {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  return undefined;
}

function toComparable(value: unknown): unknown {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (
    value !== null &&
    typeof value === "object" &&
    "valueOf" in value &&
    typeof (value as { valueOf: unknown }).valueOf === "function"
  ) {
    const primitive = (value as { valueOf(): unknown }).valueOf();
    if (primitive !== value) {
      return primitive;
    }
  }
  return value;
}

export function defaultComparator<T>(a: T, b: T): number {
  if (a === undefined || b === undefined || a === null || b === null) {
    throw new TypeError("Cannot compare null or undefined values");
  }

  const direct = primitiveCompare(a, b);
  if (direct !== undefined) {
    return direct;
  }

  const left = toComparable(a);
  const right = toComparable(b);
  const coerced = primitiveCompare(left, right);
  if (coerced !== undefined) {
    return coerced;
  }

  throw new TypeError(
    "Values require an explicit comparator: default comparator supports number, bigint, string, Date, and valueOf primitives",
  );
}

export function resolveComparator<T>(compare?: Comparator<T>): Comparator<T> {
  if (compare === undefined) {
    return defaultComparator;
  }
  if (typeof compare !== "function") {
    throw new TypeError("Comparator must be a function");
  }
  return compare;
}
