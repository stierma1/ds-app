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

/**
 * Dictionary-of-keys sparse matrix: one Map from the string "row:column" to
 * the value. Only explicitly set cells are stored (including explicit zeros,
 * which still count toward size and cost in every scan). nnz below is the
 * number of stored entries.
 *
 * Fast: get/set/has/delete are O(1) expected hash operations on a freshly built
 * key string. Slow: there is no per-row or per-column index, so row(i) and
 * column(j) each scan and parse every stored entry (O(nnz)) and then sort the
 * matches; a row is no cheaper to read than a column. entries(), transpose()
 * and serialize() are O(nnz log nnz) because they sort. Dimensions may be left
 * undefined, in which case multiply derives them with extra O(nnz log nnz)
 * passes over entries().
 */
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

  /** O(1). */
  get rows(): number | undefined {
    return this._rows;
  }

  /** O(1). */
  get cols(): number | undefined {
    return this._cols;
  }

  /** O(1): number of stored entries (nnz), explicit zeros included. */
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

  /** O(1) expected Map set; storing 0 keeps an entry rather than deleting it. */
  set(row: number, column: number, value: number): this {
    this.checkCell(row, column);
    if (typeof value !== "number" || Number.isNaN(value)) {
      throw new TypeError("value must be a number");
    }
    this._data.set(key(row, column), value);
    return this;
  }

  /** O(1) expected Map lookup; undefined means the cell was never set (not 0). */
  get(row: number, column: number): number | undefined {
    this.checkCell(row, column);
    return this._data.get(key(row, column));
  }

  /** O(1) expected. */
  has(row: number, column: number): boolean {
    this.checkCell(row, column);
    return this._data.has(key(row, column));
  }

  /** O(1) expected. */
  delete(row: number, column: number): boolean {
    this.checkCell(row, column);
    return this._data.delete(key(row, column));
  }

  /** O(nnz + k log k): scans and parses every stored key, then sorts the k matches by column. */
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

  /** O(nnz + k log k): the same full scan as row(); columns are not indexed separately. */
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

  /** O(nnz log nnz): parses every key into a fresh array and sorts it in row-major order. */
  entries(): SparseEntry[] {
    const entries: SparseEntry[] = [];
    for (const [storedKey, value] of this._data) {
      const [row, column] = storedKey.split(":").map(Number);
      entries.push([row, column, value]);
    }
    entries.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return entries;
  }

  /** O(nnz). */
  clear(): void {
    this._data.clear();
  }

  /** O(nnz log nnz) via entries(). */
  serialize(): string {
    return serializeRecord(this.serializationType(), {
      rows: this._rows,
      cols: this._cols,
      entries: this.entries(),
    });
  }

  /** O(nnz) expected: one set() per entry. */
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

  /** O(nnz log nnz): sorts via entries(), then re-inserts each cell into a new matrix. */
  transpose(): this {
    const rows = this._rows;
    const cols = this._cols;
    const result = this.createMatrix(cols, rows);
    for (const entry of this.entries()) {
      result.set(entry[1], entry[0], entry[2]);
    }
    return result;
  }

  /**
   * O(nnz_A + nnz_B + sum over k of a_k * b_k) hash operations, where a_k is the
   * number of entries in column k of this matrix and b_k the number in row k of
   * other, plus O(nnz log nnz) sorts from entries() (and up to four more when
   * the dimensions are undefined). Builds a row index of `other` first;
   * cancellations leave explicit zeros in the result.
   */
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

  /** O(nnz). */
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

  /** O(1) when rows was given; otherwise O(nnz log nnz) via entries(). */
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

  /** O(1) when cols was given; otherwise O(nnz log nnz) via entries(). */
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

/**
 * SparseMatrix under a different serialization tag. Despite the name it has no
 * list-of-lists layout: row and column access are the same O(nnz) scans.
 */
export class GeneralizedList extends SparseMatrix {
  protected override serializationType(): string {
    return "GeneralizedList";
  }
}

/**
 * SparseMatrix under a different serialization tag. Despite the name there are
 * no per-row/per-column linked chains: row(i) and column(j) remain O(nnz) full
 * scans rather than O(k) walks.
 */
export class OrthogonalList extends SparseMatrix {
  protected override serializationType(): string {
    return "OrthogonalList";
  }
}
