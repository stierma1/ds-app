/**
 * Three-way comparison: negative when a < b, zero when equal, positive when a > b. Ordered
 * containers call it O(log n) times per lookup and O(n log n) times per bulk build, so keep it
 * cheap and allocation-free.
 */
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

/**
 * O(1) per call. Fast path for same-type number, bigint, and string pairs; otherwise unwraps Date
 * via getTime() and objects via valueOf() and compares the resulting primitives. Throws TypeError
 * for null or undefined and for anything else (plain objects, mixed types), so supply an explicit
 * comparator for those.
 */
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

/**
 * O(1): returns `compare` when given (throwing TypeError if it is not a function), otherwise
 * defaultComparator.
 */
export function resolveComparator<T>(compare?: Comparator<T>): Comparator<T> {
  if (compare === undefined) {
    return defaultComparator;
  }
  if (typeof compare !== "function") {
    throw new TypeError("Comparator must be a function");
  }
  return compare;
}
