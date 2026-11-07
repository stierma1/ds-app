/** Thrown by containers for operations their representation cannot support. */
export class UnsupportedError extends Error {
  constructor(message = "Operation is not supported") {
    super(message);
    this.name = "UnsupportedError";
  }
}

/**
 * Thrown by a snapshot iterator's `next()` when the container's version changed after the iterator
 * was created. The mutation itself succeeds; the error surfaces on the next iteration step.
 */
export class ConcurrentModificationError extends Error {
  constructor(message = "Container was modified during iteration") {
    super(message);
    this.name = "ConcurrentModificationError";
  }
}

/** Thrown when a single-use container or iterator is used again after it has been drained. */
export class ConsumedError extends Error {
  constructor(message = "Container has been consumed") {
    super(message);
    this.name = "ConsumedError";
  }
}
