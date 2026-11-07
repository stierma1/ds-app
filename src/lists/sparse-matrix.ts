import {
  assertInteger,
  parseSerialized,
  readArray,
  readNumberValue,
  readOptionalInteger,
  serializeRecord,
} from "../core/index.ts";
import type { Serializable } from "../core/index.ts";

export type SparseEntry = [number, number, number];

function key(row: number, column: number): string {
  return `${row}:${column}`;
}

function assertDimension(value: number | undefined, name: string): void {
  if (value !== undefined) {
    assertInteger(value, name);
    if (value < 0) {
      throw new RangeError(`${name} must be non-negative`);
    }
  }
}

export class SparseMatrix implements Serializable {
  protected _rows: number | undefined;
  protected _cols: number | undefined;
  protected _data = new Map<string, number>();

  constructor(rows?: number, cols?: number) {
    assertDimension(rows, "rows");
    assertDimension(cols, "cols");
    if ((rows === undefined) !== (cols === undefined)) {
      throw new TypeError("rows and cols must both be specified or both omitted");
    }
    this._rows = rows;
    this._cols = cols;
  }

  get rows(): number | undefined {
    return this._rows;
  }

  get cols(): number | undefined {
    return this._cols;
  }

  get size(): number {
    return this._data.size;
  }

  private checkCell(row: number, column: number): void {
    assertInteger(row, "row");
    assertInteger(column, "column");
    if (row < 0 || column < 0) {
      throw new RangeError("row and column must be non-negative");
    }
    if (this._rows !== undefined && row >= this._rows) {
      throw new RangeError("row is out of bounds");
    }
    if (this._cols !== undefined && column >= this._cols) {
      throw new RangeError("column is out of bounds");
    }
  }

  set(row: number, column: number, value: number): this {
    this.checkCell(row, column);
    if (typeof value !== "number" || Number.isNaN(value)) {
      throw new TypeError("value must be a number");
    }
    this._data.set(key(row, column), value);
    return this;
  }

  get(row: number, column: number): number | undefined {
    this.checkCell(row, column);
    return this._data.get(key(row, column));
  }

  has(row: number, column: number): boolean {
    this.checkCell(row, column);
    return this._data.has(key(row, column));
  }

  delete(row: number, column: number): boolean {
    this.checkCell(row, column);
    return this._data.delete(key(row, column));
  }

  row(index: number): Array<[number, number]> {
    assertInteger(index, "row");
    if (index < 0 || (this._rows !== undefined && index >= this._rows)) {
      throw new RangeError("row is out of bounds");
    }
    const entries: Array<[number, number]> = [];
    for (const [storedKey, value] of this._data) {
      const [row, column] = storedKey.split(":").map(Number);
      if (row === index) {
        entries.push([column, value]);
      }
    }
    entries.sort((a, b) => a[0] - b[0]);
    return entries;
  }

  column(index: number): Array<[number, number]> {
    assertInteger(index, "column");
    if (index < 0 || (this._cols !== undefined && index >= this._cols)) {
      throw new RangeError("column is out of bounds");
    }
    const entries: Array<[number, number]> = [];
    for (const [storedKey, value] of this._data) {
      const [row, column] = storedKey.split(":").map(Number);
      if (column === index) {
        entries.push([row, value]);
      }
    }
    entries.sort((a, b) => a[0] - b[0]);
    return entries;
  }

  entries(): SparseEntry[] {
    const entries: SparseEntry[] = [];
    for (const [storedKey, value] of this._data) {
      const [row, column] = storedKey.split(":").map(Number);
      entries.push([row, column, value]);
    }
    entries.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return entries;
  }

  clear(): void {
    this._data.clear();
  }

  serialize(): string {
    return serializeRecord(this.serializationType(), {
      rows: this._rows,
      cols: this._cols,
      entries: this.entries(),
    });
  }

  static deserialize<T extends SparseMatrix>(
    this: new (rows?: number, cols?: number) => T,
    json: unknown,
  ): T {
    const record = parseSerialized(json, [
      "SparseMatrix",
      "GeneralizedList",
      "OrthogonalList",
    ]);
    const rows = readOptionalInteger(record, "rows");
    const cols = readOptionalInteger(record, "cols");
    const entries = readArray(record, "entries");
    const result = new this(rows, cols);
    for (const raw of entries) {
      if (!Array.isArray(raw) || raw.length !== 3) {
        throw new TypeError("each entry must be a [row, column, value] triple");
      }
      const row = readNumberValue(raw[0], "row");
      const column = readNumberValue(raw[1], "column");
      const value = readNumberValue(raw[2], "value");
      if (!Number.isInteger(row) || !Number.isInteger(column)) {
        throw new TypeError("row and column must be integers");
      }
      result.set(row, column, value);
    }
    return result;
  }

  protected serializationType(): string {
    return "SparseMatrix";
  }

  transpose(): this {
    const rows = this._rows;
    const cols = this._cols;
    const result = this.createMatrix(cols, rows);
    for (const entry of this.entries()) {
      result.set(entry[1], entry[0], entry[2]);
    }
    return result;
  }

  multiply(other: SparseMatrix): this {
    const rows = this.dimensionRows();
    const shared = this.dimensionCols();
    const otherRows = other.dimensionRows();
    const otherCols = other.dimensionCols();
    if (shared !== otherRows) {
      throw new RangeError("matrix dimensions are incompatible for multiplication");
    }
    const result = this.createMatrix(rows, otherCols);
    const otherRowsByIndex = new Map<number, Array<[number, number]>>();
    for (const [row, column, value] of other.entries()) {
      let entries = otherRowsByIndex.get(row);
      if (entries === undefined) {
        entries = [];
        otherRowsByIndex.set(row, entries);
      }
      entries.push([column, value]);
    }
    for (const [row, column, value] of this.entries()) {
      const matches = otherRowsByIndex.get(column);
      if (matches === undefined) {
        continue;
      }
      for (const [targetColumn, otherValue] of matches) {
        const existing = result.get(row, targetColumn) ?? 0;
        result.set(row, targetColumn, existing + value * otherValue);
      }
    }
    return result;
  }

  validate(): true | string {
    for (const [storedKey, value] of this._data) {
      const parts = storedKey.split(":");
      if (parts.length !== 2) {
        return `malformed key ${storedKey}`;
      }
      const row = Number(parts[0]);
      const column = Number(parts[1]);
      if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || column < 0) {
        return `malformed key ${storedKey}`;
      }
      if (this._rows !== undefined && row >= this._rows) {
        return `entry ${storedKey} is outside the declared rows`;
      }
      if (this._cols !== undefined && column >= this._cols) {
        return `entry ${storedKey} is outside the declared columns`;
      }
      if (typeof value !== "number" || Number.isNaN(value)) {
        return `entry ${storedKey} has a non-numeric value`;
      }
    }
    return true;
  }

  protected createMatrix(rows: number | undefined, cols: number | undefined): this {
    const Constructor = this.constructor as new (
      rows?: number,
      cols?: number,
    ) => this;
    return new Constructor(rows, cols);
  }

  protected dimensionRows(): number {
    if (this._rows !== undefined) {
      return this._rows;
    }
    let max = -1;
    for (const [row] of this.entries()) {
      if (row > max) max = row;
    }
    return max + 1;
  }

  protected dimensionCols(): number {
    if (this._cols !== undefined) {
      return this._cols;
    }
    let max = -1;
    for (const [, column] of this.entries()) {
      if (column > max) max = column;
    }
    return max + 1;
  }
}

export class GeneralizedList extends SparseMatrix {
  protected override serializationType(): string {
    return "GeneralizedList";
  }
}

export class OrthogonalList extends SparseMatrix {
  protected override serializationType(): string {
    return "OrthogonalList";
  }
}
