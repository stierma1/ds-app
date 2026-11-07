export class UnsupportedError extends Error {
  constructor(message = "Operation is not supported") {
    super(message);
    this.name = "UnsupportedError";
  }
}

export class ConcurrentModificationError extends Error {
  constructor(message = "Container was modified during iteration") {
    super(message);
    this.name = "ConcurrentModificationError";
  }
}

export class ConsumedError extends Error {
  constructor(message = "Container has been consumed") {
    super(message);
    this.name = "ConsumedError";
  }
}
