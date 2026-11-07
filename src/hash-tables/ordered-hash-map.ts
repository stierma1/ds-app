import { HashMap } from "./separate-chaining.ts";
import { parseMap } from "./serialization.ts";
import type { HashOptions } from "./types.ts";

export class OrderedHashMap<K, V> extends HashMap<K, V> {
  private _order: K[] = [];

  constructor(options: HashOptions<K> = {}) {
    super(options);
  }

  override set(key: K, value: V): this {
    if (super.has(key)) {
      super.set(key, value);
      return this;
    }
    this._order.push(key);
    try {
      super.set(key, value);
    } catch (error) {
      this._order.pop();
      throw error;
    }
    this.touch();
    return this;
  }

  override delete(key: K): boolean {
    const index = this._order.findIndex((entry) => this.equalKeys(entry, key));
    if (!super.delete(key)) {
      return false;
    }
    if (index < 0) {
      throw new Error("ordered hash map order is inconsistent");
    }
    this._order.splice(index, 1);
    this.touch();
    return true;
  }

  override clear(): void {
    super.clear();
    this._order = [];
    this.touch();
  }

  override validate(): true | string {
    const result = super.validate();
    if (result !== true) {
      return result;
    }
    if (this._order.length !== this._size) {
      return `order length ${this._order.length} does not match size ${this._size}`;
    }
    const seen: K[] = [];
    for (const key of this._order) {
      if (!super.has(key)) {
        return "order contains a key that is not stored";
      }
      for (const other of seen) {
        if (this.equalKeys(other, key)) {
          return "order contains a duplicate key";
        }
      }
      seen.push(key);
    }
    return true;
  }

  protected override collectEntries(): Array<[K, V]> {
    return this._order.map((key) => [key, super.get(key) as V]);
  }

  protected override get serializationType(): string {
    return "OrderedHashMap";
  }

  static override deserialize<K, V>(
    json: unknown,
    options: HashOptions<K> = {},
  ): OrderedHashMap<K, V> {
    const parsed = parseMap<K, V>(json, "OrderedHashMap");
    const table = new OrderedHashMap<K, V>({
      ...options,
      capacity: options.capacity ?? parsed.capacity,
      loadFactor: options.loadFactor ?? parsed.loadFactor,
    });
    for (const [key, value] of parsed.entries) {
      table.set(key, value);
    }
    if (table.validate() !== true) {
      throw new TypeError(`Invalid OrderedHashMap payload: ${table.validate()}`);
    }
    return table;
  }
}
