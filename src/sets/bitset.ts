import {
  ContainerBase,
  parseSerialized,
  readArray,
  readInteger,
  serializeRecord,
} from "../core/index.ts";
import type { SetLike } from "../core/index.ts";

const WORD_BITS = 32;

function popcount32(value: number): number {
  let x = value >>> 0;
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return (Math.imul(x, 0x01010101) >>> 24) & 0xff;
}

export class BitSet extends ContainerBase<number> implements SetLike<number> {
  readonly universe: number;
  private _words: Uint32Array;

  constructor(universe: number) {
    super();
    if (!Number.isInteger(universe) || universe < 0) {
      throw new TypeError("universe must be a non-negative integer");
    }
    this.universe = universe;
    this._words = new Uint32Array(Math.ceil(universe / WORD_BITS));
  }

  add(value: number): boolean {
    const { word, mask } = this.locate(value);
    if ((this._words[word] & mask) !== 0) {
      return false;
    }
    this._words[word] |= mask;
    this._size++;
    this.touch();
    return true;
  }

  delete(value: number): boolean {
    const { word, mask } = this.locate(value);
    if ((this._words[word] & mask) === 0) {
      return false;
    }
    this._words[word] &= ~mask;
    this._size--;
    this.touch();
    return true;
  }

  has(value: number): boolean {
    const { word, mask } = this.locate(value);
    return (this._words[word] & mask) !== 0;
  }

  clear(): void {
    this._words = new Uint32Array(this._words.length);
    this._size = 0;
    this.touch();
  }

  union(other: Iterable<number>): BitSet {
    const result = this.cloneEmpty();
    result._words.set(this._words);
    result._size = this._size;
    for (const value of other) {
      result.add(value);
    }
    return result;
  }

  intersection(other: Iterable<number>): BitSet {
    const membership = new Set(other);
    const result = this.cloneEmpty();
    for (const value of this) {
      if (membership.has(value)) {
        result.add(value);
      }
    }
    return result;
  }

  difference(other: Iterable<number>): BitSet {
    const result = this.cloneEmpty();
    result._words.set(this._words);
    result._size = this._size;
    for (const value of other) {
      result.delete(value);
    }
    return result;
  }

  symmetricDifference(other: Iterable<number>): BitSet {
    const result = this.cloneEmpty();
    result._words.set(this._words);
    result._size = this._size;
    for (const value of other) {
      if (this.has(value)) {
        result.delete(value);
      } else {
        result.add(value);
      }
    }
    return result;
  }

  isSubsetOf(other: Iterable<number>): boolean {
    const membership = new Set(other);
    if (this._size > membership.size) {
      return false;
    }
    for (const value of this) {
      if (!membership.has(value)) {
        return false;
      }
    }
    return true;
  }

  isSupersetOf(other: Iterable<number>): boolean {
    for (const value of other) {
      if (!this.hasValue(value)) {
        return false;
      }
    }
    return true;
  }

  equals(other: Iterable<number>): boolean {
    const membership = new Set(other);
    return this._size === membership.size && this.isSubsetOf(membership);
  }

  hasValue(value: number): boolean {
    if (!Number.isInteger(value) || value < 0 || value >= this.universe) {
      return false;
    }
    return this.has(value);
  }

  toArray(): number[] {
    const values: number[] = [];
    for (let word = 0; word < this._words.length; word++) {
      let bits = this._words[word];
      while (bits !== 0) {
        const lowest = bits & -bits;
        const bit = 31 - Math.clz32(lowest);
        values.push(word * WORD_BITS + bit);
        bits &= bits - 1;
      }
    }
    return values;
  }

  [Symbol.iterator](): IterableIterator<number> {
    return this.snapshotIterator(this.toArray());
  }

  validate(): true | string {
    if (this._words.length !== Math.ceil(this.universe / WORD_BITS)) {
      return "word count does not match universe";
    }
    let count = 0;
    for (let word = 0; word < this._words.length; word++) {
      count += popcount32(this._words[word]);
    }
    if (count !== this._size) {
      return `size ${this._size} does not match popcount ${count}`;
    }
    const remainder = this.universe % WORD_BITS;
    if (remainder !== 0 && this._words.length > 0) {
      const last = this._words[this._words.length - 1];
      const allowed = (1 << remainder) - 1;
      if ((last & ~allowed) !== 0) {
        return "bits outside the universe are set";
      }
    }
    return true;
  }

  serialize(): string {
    return serializeRecord("BitSet", {
      universe: this.universe,
      words: Array.from(this._words),
    });
  }

  static deserialize(json: unknown): BitSet {
    const record = parseSerialized(json, "BitSet");
    const universe = readInteger(record, "universe");
    if (universe < 0) {
      throw new TypeError("universe must be non-negative");
    }
    const rawWords = readArray(record, "words");
    const expected = Math.ceil(universe / WORD_BITS);
    if (rawWords.length !== expected) {
      throw new TypeError("words length does not match universe");
    }
    const set = new BitSet(universe);
    for (let index = 0; index < rawWords.length; index++) {
      const word = rawWords[index];
      if (
        typeof word !== "number" ||
        !Number.isInteger(word) ||
        word < 0 ||
        word > 0xffffffff
      ) {
        throw new TypeError(`words[${index}] must be a 32-bit unsigned integer`);
      }
      set._words[index] = word >>> 0;
    }
    let count = 0;
    for (const word of set._words) {
      count += popcount32(word);
    }
    set._size = count;
    if (set.validate() !== true) {
      throw new TypeError(`Invalid BitSet payload: ${set.validate()}`);
    }
    return set;
  }

  private locate(value: number): { word: number; mask: number } {
    if (!Number.isInteger(value)) {
      throw new TypeError("value must be an integer");
    }
    if (value < 0 || value >= this.universe) {
      throw new RangeError("value is outside the universe");
    }
    return {
      word: Math.floor(value / WORD_BITS),
      mask: 1 << (value % WORD_BITS),
    };
  }

  private cloneEmpty(): BitSet {
    return new BitSet(this.universe);
  }
}
