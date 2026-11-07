import {
  assertDefined,
  ConsumedError,
  ContainerBase,
} from "../core/index.ts";
import { deserializeValues, serializeValues } from "./serialization.ts";
import type { OrderLabel, OrderMaintenanceList as OrderMaintenanceListContract } from "./types.ts";

const GAP = 1 << 30;

class OrderNode<T> implements OrderLabel {
  readonly list: OrderMaintenanceList<T>;
  value: T;
  order: number;
  prev: OrderNode<T> | null = null;
  next: OrderNode<T> | null = null;
  deleted = false;

  constructor(list: OrderMaintenanceList<T>, value: T, order: number) {
    this.list = list;
    this.value = value;
    this.order = order;
  }
}

export class OrderMaintenanceList<T>
  extends ContainerBase<T>
  implements OrderMaintenanceListContract<T>
{
  private _head: OrderNode<T> | null = null;
  private _tail: OrderNode<T> | null = null;

  private resolve(label: OrderLabel): OrderNode<T> {
    if (!(label instanceof OrderNode)) {
      throw new TypeError("Label does not belong to an order-maintenance list");
    }
    if (label.list !== this) {
      throw new TypeError("Label belongs to a different list");
    }
    if (label.deleted) {
      throw new ConsumedError("Label has been deleted");
    }
    return label;
  }

  insertAfter(label: OrderLabel | null, value: T): OrderLabel {
    assertDefined(value);
    const previous = label === null ? null : this.resolve(label);
    const next = previous === null ? this._head : previous.next;
    const order = this.orderBetween(previous, next);
    const node = new OrderNode(this, value, order);
    node.prev = previous;
    node.next = next;
    if (previous === null) {
      this._head = node;
    } else {
      previous.next = node;
    }
    if (next === null) {
      this._tail = node;
    } else {
      next.prev = node;
    }
    this._size++;
    this.touch();
    return node;
  }

  delete(label: OrderLabel): boolean {
    const node = this.resolve(label);
    if (node.prev === null) {
      this._head = node.next;
    } else {
      node.prev.next = node.next;
    }
    if (node.next === null) {
      this._tail = node.prev;
    } else {
      node.next.prev = node.prev;
    }
    node.deleted = true;
    node.prev = null;
    node.next = null;
    this._size--;
    this.touch();
    return true;
  }

  compare(a: OrderLabel, b: OrderLabel): number {
    const left = this.resolve(a);
    const right = this.resolve(b);
    return left.order - right.order;
  }

  get(label: OrderLabel): T | undefined {
    return this.resolve(label).value;
  }

  serialize(): string {
    return serializeValues("OrderMaintenanceList", this.toArray());
  }

  static deserialize<T>(json: unknown): OrderMaintenanceList<T> {
    const list = new OrderMaintenanceList<T>();
    let label: OrderLabel | null = null;
    for (const value of deserializeValues(json, "OrderMaintenanceList")) {
      label = list.insertAfter(label, value as T);
    }
    return list;
  }

  clear(): void {
    for (let node = this._head; node !== null; node = node.next) {
      node.deleted = true;
    }
    this._head = null;
    this._tail = null;
    this._size = 0;
    this.touch();
  }

  toArray(): T[] {
    const values: T[] = [];
    for (let node = this._head; node !== null; node = node.next) {
      values.push(node.value);
    }
    return values;
  }

  [Symbol.iterator](): IterableIterator<T> {
    return this.snapshotIterator(this.toArray());
  }

  validate(): true | string {
    let count = 0;
    let previous: OrderNode<T> | null = null;
    let lastOrder = -Infinity;
    for (let node = this._head; node !== null; node = node.next) {
      if (node.prev !== previous) {
        return `broken prev link at index ${count}`;
      }
      if (node.deleted) {
        return `deleted node is still linked at index ${count}`;
      }
      if (node.value === undefined) {
        return `node at index ${count} is undefined`;
      }
      if (!(node.order > lastOrder) || !Number.isSafeInteger(node.order)) {
        return `orders are not strictly increasing at index ${count}`;
      }
      lastOrder = node.order;
      previous = node;
      count++;
      if (count > this._size) {
        return "cycle detected in order-maintenance links";
      }
    }
    if (count !== this._size) {
      return `size ${this._size} does not match node count ${count}`;
    }
    if (this._tail !== previous) {
      return "tail pointer does not match the last node";
    }
    if (this._size === 0 && (this._head !== null || this._tail !== null)) {
      return "empty list has non-null endpoints";
    }
    return true;
  }

  private orderBetween(previous: OrderNode<T> | null, next: OrderNode<T> | null): number {
    if (previous === null && next === null) {
      return 0;
    }
    if (previous === null) {
      return next!.order - GAP;
    }
    if (next === null) {
      return previous.order + GAP;
    }
    const candidate = (previous.order + next.order) / 2;
    if (
      candidate > previous.order &&
      candidate < next.order &&
      Number.isSafeInteger(candidate)
    ) {
      return candidate;
    }
    this.relabel();
    return (previous.order + next.order) / 2;
  }

  private relabel(): void {
    let order = GAP;
    for (let node = this._head; node !== null; node = node.next) {
      node.order = order;
      order += GAP;
    }
  }
}
