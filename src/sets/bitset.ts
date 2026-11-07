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

/**
 * Fixed-universe set of non-negative integers stored one bit per value in a Uint32Array of
 * W = ceil(universe / 32) words. The universe is fixed at construction and never grows.
 *
 * Fast: add/delete/has are O(1) bit operations with no hashing or allocation, and the whole set
 * costs 1 bit per universe element. Set algebra against another BitSet over the same universe
 * is word-parallel: union/intersection/difference/symmetricDifference/isSubsetOf/equals run in
 * O(W) regardless of how many elements are set. Slow: with any other iterable (including a
 * BitSet over a different universe) the same operations fall back to O(W + m) element-wise
 * work, where m is the size of `other`; toArray and iteration are O(W + n) because every word is
 * scanned. Prefer HashSet or SortedArraySet for sparse sets over a large or unbounded universe.
 *
 * Iteration is over a snapshot (ascending) and throws ConcurrentModificationError if the set is
 * mutated mid-iteration.
 */
export class BitSet extends ContainerBase<number> implements SetLike<number> {
  readonly universe: number;
  private _words: Uint32Array;

  /**
   * O(W): allocates the zeroed word array for the whole universe up front, even if the set stays
   * empty.
   */
  constructor(universe: number) {
    super();
    if (!Number.isInteger(universe) || universe < 0) {
      throw new TypeError("universe must be a non-negative integer");
    }
    this.universe = universe;
    this._words = new Uint32Array(Math.ceil(universe / WORD_BITS));
  }

  /** O(1): sets one bit. Throws TypeError for non-integers and RangeError outside the universe. */
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

  /** O(1): clears one bit. Same argument checks as add. */
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

  /** O(1). Throws outside [0, universe); hasValue returns false instead. */
  has(value: number): boolean {
    const { word, mask } = this.locate(value);
    return (this._words[word] & mask) !== 0;
  }

  /** O(W): replaces the word array with a fresh zeroed one rather than zeroing in place. */
  clear(): void {
    this._words = new Uint32Array(this._words.length);
    this._size = 0;
    this.touch();
  }

  /** O(W) word-wise OR for a same-universe BitSet; otherwise O(W + m) adding `other` one by one. */
  union(other: Iterable<number>): BitSet {
    const result = this.cloneEmpty();
    result._words.set(this._words);
    const bits = this.sameUniverse(other);
    if (bits !== null) {
      for (let i = 0; i < result._words.length; i++) {
        result._words[i] |= bits._words[i];
      }
      result.recount();
      return result;
    }
    result._size = this._size;
    for (const value of other) {
      result.add(value);
    }
    return result;
  }

  /**
   * O(W) word-wise AND for a same-universe BitSet; otherwise O(m + W + n): materializes `other`
   * into a JS Set, then re-adds the survivors of this set.
   */
  intersection(other: Iterable<number>): BitSet {
    const result = this.cloneEmpty();
    const bits = this.sameUniverse(other);
    if (bits !== null) {
      for (let i = 0; i < result._words.length; i++) {
        result._words[i] = this._words[i] & bits._words[i];
      }
      result.recount();
      return result;
    }
    const membership = new Set(other);
    for (const value of this) {
      if (membership.has(value)) {
        result.add(value);
      }
    }
    return result;
  }

  /** O(W) word-wise AND NOT for a same-universe BitSet; otherwise O(W + m) deleting one by one. */
  difference(other: Iterable<number>): BitSet {
    const result = this.cloneEmpty();
    result._words.set(this._words);
    const bits = this.sameUniverse(other);
    if (bits !== null) {
      for (let i = 0; i < result._words.length; i++) {
        result._words[i] &= ~bits._words[i];
      }
      result.recount();
      return result;
    }
    result._size = this._size;
    for (const value of other) {
      result.delete(value);
    }
    return result;
  }

  /** O(W) word-wise XOR for a same-universe BitSet; otherwise O(W + m) toggling one by one. */
  symmetricDifference(other: Iterable<number>): BitSet {
    const result = this.cloneEmpty();
    result._words.set(this._words);
    const bits = this.sameUniverse(other);
    if (bits !== null) {
      for (let i = 0; i < result._words.length; i++) {
        result._words[i] ^= bits._words[i];
      }
      result.recount();
      return result;
    }
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

  /**
   * O(W) for a same-universe BitSet (stops at the first word with a bit missing from `other`);
   * otherwise O(m + W + n) via a JS Set, returning false after only O(m) when this set is larger.
   */
  isSubsetOf(other: Iterable<number>): boolean {
    const bits = this.sameUniverse(other);
    if (bits !== null) {
      if (this._size > bits._size) {
        return false;
      }
      for (let i = 0; i < this._words.length; i++) {
        if ((this._words[i] & ~bits._words[i]) !== 0) {
          return false;
        }
      }
      return true;
    }
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

  /**
   * O(m): one O(1) hasValue probe per element of `other`, short-circuiting, no allocation. The
   * cheapest of the comparison methods for a non-BitSet `other`.
   */
  isSupersetOf(other: Iterable<number>): boolean {
    for (const value of other) {
      if (!this.hasValue(value)) {
        return false;
      }
    }
    return true;
  }

  /**
   * O(W) word comparison for a same-universe BitSet (O(1) when the sizes differ); otherwise
   * O(m + W + n) via a JS Set.
   */
  equals(other: Iterable<number>): boolean {
    const bits = this.sameUniverse(other);
    if (bits !== null) {
      if (this._size !== bits._size) {
        return false;
      }
      for (let i = 0; i < this._words.length; i++) {
        if (this._words[i] !== bits._words[i]) {
          return false;
        }
      }
      return true;
    }
    const membership = new Set(other);
    return this._size === membership.size && this.isSubsetOf(membership);
  }

  /** O(1): the word-parallel fast paths apply only to a BitSet over the identical universe. */
  private sameUniverse(other: Iterable<number>): BitSet | null {
    return other instanceof BitSet && other.universe === this.universe ? other : null;
  }

  /** O(W): recomputes the cached size from word popcounts after a word-wise operation. */
  private recount(): void {
    let count = 0;
    for (let i = 0; i < this._words.length; i++) {
      count += popcount32(this._words[i]);
    }
    this._size = count;
  }

  /**
   * O(1): like has, but returns false instead of throwing for non-integers or values outside the
   * universe.
   */
  hasValue(value: number): boolean {
    if (!Number.isInteger(value) || value < 0 || value >= this.universe) {
      return false;
    }
    return this.has(value);
  }

  /**
   * O(W + n): scans every word and peels set bits lowest-first with clz32, so the result is always
   * ascending. Allocates a fresh array.
   */
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

  /**
   * O(W + n) up front to build the snapshot via toArray, then O(1) per step; throws
   * ConcurrentModificationError if the set is mutated during iteration.
   */
  [Symbol.iterator](): IterableIterator<number> {
    return this.snapshotIterator(this.toArray());
  }

  /** O(W): popcounts every word and checks that no bit above the universe is set. */
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

  /** O(W): emits every word, so the payload is proportional to the universe, not to n. */
  serialize(): string {
    return serializeRecord("BitSet", {
      universe: this.universe,
      words: Array.from(this._words),
    });
  }

  /** O(W): validates and copies every word, then recounts the size via popcount. */
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
