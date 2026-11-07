import {
  parseSerialized,
  readArray,
  readInteger,
  readNumber,
  serializeRecord,
} from "../core/index.ts";
import { hashString, mix32 } from "../hash-tables/hash.ts";
import type { BloomFilterOptions, ScalableBloomFilterOptions } from "./types.ts";

const WORD_BITS = 32;

function assertString(value: string): void {
  if (typeof value !== "string") {
    throw new TypeError("value must be a string");
  }
}

function assertOptions(options: BloomFilterOptions): void {
  if (options.bits !== undefined && (!Number.isInteger(options.bits) || options.bits <= 0)) {
    throw new TypeError("bits must be a positive integer");
  }
  if (
    options.hashes !== undefined &&
    (!Number.isInteger(options.hashes) || options.hashes <= 0)
  ) {
    throw new TypeError("hashes must be a positive integer");
  }
  if (options.seed !== undefined && !Number.isInteger(options.seed)) {
    throw new TypeError("seed must be an integer");
  }
}

function hashPair(value: string, seed: number): [number, number] {
  const base = hashString(value);
  const first = mix32(base ^ seed);
  let second = mix32(base ^ (seed + 0x9e3779b9));
  if (second === 0) {
    second = 0x85ebca6b;
  }
  return [first, second];
}

function popcountWord(value: number): number {
  let x = value >>> 0;
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return (Math.imul(x, 0x01010101) >>> 24) & 0xff;
}

export class BloomFilter {
  readonly bits: number;
  readonly hashes: number;
  readonly seed: number;
  protected _words: Uint32Array;
  protected _size: number;

  constructor(options: BloomFilterOptions = {}) {
    assertOptions(options);
    this.bits = options.bits ?? 1024;
    this.hashes = options.hashes ?? 3;
    this.seed = options.seed ?? 0x9747b28c;
    this._words = new Uint32Array(Math.ceil(this.bits / WORD_BITS));
    this._size = 0;
  }

  get size(): number {
    return this._size;
  }

  get falsePositiveRate(): number {
    if (this._size === 0) {
      return 0;
    }
    const exponent = (-this.hashes * this._size) / this.bits;
    return (1 - Math.exp(exponent)) ** this.hashes;
  }

  add(value: string): void {
    assertString(value);
    for (const position of this.positions(value)) {
      this.setBit(position);
    }
    this._size++;
  }

  has(value: string): boolean {
    assertString(value);
    if (this._size === 0) {
      return false;
    }
    for (const position of this.positions(value)) {
      if (!this.testBit(position)) {
        return false;
      }
    }
    return true;
  }

  clear(): void {
    this._words = new Uint32Array(this._words.length);
    this._size = 0;
  }

  validate(): true | string {
    if (this._words.length !== Math.ceil(this.bits / WORD_BITS)) {
      return "word count does not match bit count";
    }
    if (!Number.isInteger(this.hashes) || this.hashes <= 0) {
      return "hash count must be a positive integer";
    }
    if (!Number.isInteger(this._size) || this._size < 0) {
      return "size must be a non-negative integer";
    }
    const remainder = this.bits % WORD_BITS;
    if (remainder !== 0 && this._words.length > 0) {
      const last = this._words[this._words.length - 1];
      const allowed = (1 << remainder) - 1;
      if ((last & ~allowed) !== 0) {
        return "bits outside the bit array are set";
      }
    }
    return true;
  }

  serialize(): string {
    return serializeRecord(this.serializationType, {
      bits: this.bits,
      hashes: this.hashes,
      seed: this.seed,
      size: this._size,
      words: Array.from(this._words),
    });
  }

  static deserialize(json: unknown): BloomFilter {
    const record = parseSerialized(json, "BloomFilter");
    const filter = new BloomFilter({
      bits: readInteger(record, "bits"),
      hashes: readInteger(record, "hashes"),
      seed: readInteger(record, "seed"),
    });
    filter._size = readInteger(record, "size");
    if (filter._size < 0) {
      throw new TypeError("size must be non-negative");
    }
    filter.restoreWords(readArray(record, "words"));
    return filter;
  }

  protected *positions(value: string): IterableIterator<number> {
    const [first, second] = hashPair(value, this.seed);
    for (let index = 0; index < this.hashes; index++) {
      yield ((first + Math.imul(index, second)) >>> 0) % this.bits;
    }
  }

  protected get serializationType(): string {
    return "BloomFilter";
  }

  protected setBit(position: number): void {
    const word = Math.floor(position / WORD_BITS);
    this._words[word] |= 1 << (position % WORD_BITS);
  }

  protected testBit(position: number): boolean {
    const word = Math.floor(position / WORD_BITS);
    return (this._words[word] & (1 << (position % WORD_BITS))) !== 0;
  }

  protected restoreWords(rawWords: unknown[]): void {
    if (rawWords.length !== this._words.length) {
      throw new TypeError("words length does not match bit count");
    }
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
      this._words[index] = word >>> 0;
    }
    if (this.validate() !== true) {
      throw new TypeError(`Invalid BloomFilter payload: ${this.validate()}`);
    }
  }
}

export class PartitionedBloomFilter extends BloomFilter {
  private readonly _sliceBits: number;

  constructor(options: BloomFilterOptions = {}) {
    assertOptions(options);
    const hashes = options.hashes ?? 3;
    const requestedBits = options.bits ?? 1024;
    const sliceBits = Math.max(1, Math.floor(requestedBits / hashes));
    super({ ...options, bits: sliceBits * hashes });
    this._sliceBits = sliceBits;
  }

  protected override *positions(value: string): IterableIterator<number> {
    const [first, second] = hashPair(value, this.seed);
    for (let index = 0; index < this.hashes; index++) {
      const offset = ((first + Math.imul(index, second)) >>> 0) % this._sliceBits;
      yield index * this._sliceBits + offset;
    }
  }

  protected override get serializationType(): string {
    return "PartitionedBloomFilter";
  }

  static override deserialize(json: unknown): PartitionedBloomFilter {
    const record = parseSerialized(json, "PartitionedBloomFilter");
    const filter = new PartitionedBloomFilter({
      bits: readInteger(record, "bits"),
      hashes: readInteger(record, "hashes"),
      seed: readInteger(record, "seed"),
    });
    filter._size = readInteger(record, "size");
    if (filter._size < 0) {
      throw new TypeError("size must be non-negative");
    }
    filter.restoreWords(readArray(record, "words"));
    return filter;
  }
}

export class CountingBloomFilter {
  readonly bits: number;
  readonly hashes: number;
  readonly seed: number;
  private _counters: Uint32Array;
  private _size: number;

  constructor(options: BloomFilterOptions = {}) {
    assertOptions(options);
    this.bits = options.bits ?? 1024;
    this.hashes = options.hashes ?? 3;
    this.seed = options.seed ?? 0x9747b28c;
    this._counters = new Uint32Array(this.bits);
    this._size = 0;
  }

  get size(): number {
    return this._size;
  }

  get falsePositiveRate(): number {
    if (this._size === 0) {
      return 0;
    }
    const exponent = (-this.hashes * this._size) / this.bits;
    return (1 - Math.exp(exponent)) ** this.hashes;
  }

  add(value: string): void {
    assertString(value);
    for (const position of this.positions(value)) {
      if (this._counters[position] < 0xffffffff) {
        this._counters[position]++;
      }
    }
    this._size++;
  }

  has(value: string): boolean {
    assertString(value);
    if (this._size === 0) {
      return false;
    }
    for (const position of this.positions(value)) {
      if (this._counters[position] === 0) {
        return false;
      }
    }
    return true;
  }

  delete(value: string): boolean {
    assertString(value);
    let changed = false;
    for (const position of this.positions(value)) {
      if (this._counters[position] > 0) {
        this._counters[position]--;
        changed = true;
      }
    }
    if (changed) {
      this._size = Math.max(0, this._size - 1);
    }
    return changed;
  }

  clear(): void {
    this._counters = new Uint32Array(this.bits);
    this._size = 0;
  }

  validate(): true | string {
    if (this._counters.length !== this.bits) {
      return "counter count does not match bit count";
    }
    if (!Number.isInteger(this._size) || this._size < 0) {
      return "size must be a non-negative integer";
    }
    return true;
  }

  serialize(): string {
    return serializeRecord("CountingBloomFilter", {
      bits: this.bits,
      hashes: this.hashes,
      seed: this.seed,
      size: this._size,
      counters: Array.from(this._counters),
    });
  }

  static deserialize(json: unknown): CountingBloomFilter {
    const record = parseSerialized(json, "CountingBloomFilter");
    const filter = new CountingBloomFilter({
      bits: readInteger(record, "bits"),
      hashes: readInteger(record, "hashes"),
      seed: readInteger(record, "seed"),
    });
    filter._size = readInteger(record, "size");
    if (filter._size < 0) {
      throw new TypeError("size must be non-negative");
    }
    const counters = readArray(record, "counters");
    if (counters.length !== filter._counters.length) {
      throw new TypeError("counters length does not match bit count");
    }
    for (let index = 0; index < counters.length; index++) {
      const counter = counters[index];
      if (
        typeof counter !== "number" ||
        !Number.isInteger(counter) ||
        counter < 0 ||
        counter > 0xffffffff
      ) {
        throw new TypeError(`counters[${index}] must be a 32-bit unsigned integer`);
      }
      filter._counters[index] = counter;
    }
    if (filter.validate() !== true) {
      throw new TypeError(`Invalid CountingBloomFilter payload: ${filter.validate()}`);
    }
    return filter;
  }

  private *positions(value: string): IterableIterator<number> {
    const [first, second] = hashPair(value, this.seed);
    for (let index = 0; index < this.hashes; index++) {
      yield ((first + Math.imul(index, second)) >>> 0) % this.bits;
    }
  }
}

export class ScalableBloomFilter {
  private _filters: BloomFilter[] = [];
  private _capacities: number[] = [];
  private readonly _growthFactor: number;
  private readonly _tighteningRatio: number;
  private readonly _hashes: number;
  private readonly _seed: number;
  private readonly _initialBits: number;
  private readonly _initialCapacity: number;

  constructor(options: ScalableBloomFilterOptions = {}) {
    this._growthFactor = options.growthFactor ?? 2;
    this._tighteningRatio = options.tighteningRatio ?? 0.9;
    this._hashes = options.hashes ?? 3;
    this._seed = options.seed ?? 0x9747b28c;
    this._initialBits = options.bits ?? 1024;
    this._initialCapacity = options.capacity ?? 128;
    if (!(this._growthFactor > 1)) {
      throw new RangeError("growthFactor must be greater than 1");
    }
    if (!(this._tighteningRatio > 0 && this._tighteningRatio < 1)) {
      throw new RangeError("tighteningRatio must be in (0, 1)");
    }
    if (!Number.isInteger(this._initialCapacity) || this._initialCapacity <= 0) {
      throw new TypeError("capacity must be a positive integer");
    }
    this.reset();
  }

  get size(): number {
    return this._filters.reduce((total, filter) => total + filter.size, 0);
  }

  get bits(): number {
    return this._filters.reduce((total, filter) => total + filter.bits, 0);
  }

  get hashes(): number {
    return this._hashes;
  }

  get filterCount(): number {
    return this._filters.length;
  }

  get growthFactor(): number {
    return this._growthFactor;
  }

  get tighteningRatio(): number {
    return this._tighteningRatio;
  }

  get falsePositiveRate(): number {
    let survival = 1;
    for (const filter of this._filters) {
      survival *= 1 - filter.falsePositiveRate;
    }
    return 1 - survival;
  }

  add(value: string): void {
    assertString(value);
    const lastIndex = this._filters.length - 1;
    if (this._filters[lastIndex].size >= this._capacities[lastIndex]) {
      this.addFilter();
    }
    this._filters[this._filters.length - 1].add(value);
  }

  has(value: string): boolean {
    assertString(value);
    for (const filter of this._filters) {
      if (filter.has(value)) {
        return true;
      }
    }
    return false;
  }

  clear(): void {
    this.reset();
  }

  validate(): true | string {
    if (this._filters.length === 0) {
      return "scalable filter has no stages";
    }
    if (this._filters.length !== this._capacities.length) {
      return "filter and capacity counts differ";
    }
    for (let index = 0; index < this._filters.length; index++) {
      const result = this._filters[index].validate();
      if (result !== true) {
        return `stage ${index}: ${result}`;
      }
      if (this._capacities[index] <= 0) {
        return `stage ${index} has a non-positive capacity`;
      }
    }
    return true;
  }

  serialize(): string {
    return serializeRecord("ScalableBloomFilter", {
      growthFactor: this._growthFactor,
      tighteningRatio: this._tighteningRatio,
      hashes: this._hashes,
      seed: this._seed,
      initialBits: this._initialBits,
      initialCapacity: this._initialCapacity,
      capacities: this._capacities,
      filters: this._filters.map((filter) => JSON.parse(filter.serialize()) as unknown),
    });
  }

  static deserialize(json: unknown): ScalableBloomFilter {
    const record = parseSerialized(json, "ScalableBloomFilter");
    const growthFactor = readNumber(record, "growthFactor");
    const tighteningRatio = readNumber(record, "tighteningRatio");
    const hashes = readInteger(record, "hashes");
    const seed = readInteger(record, "seed");
    const initialBits = readInteger(record, "initialBits");
    const initialCapacity = readInteger(record, "initialCapacity");
    const filter = new ScalableBloomFilter({
      growthFactor,
      tighteningRatio,
      hashes,
      seed,
      bits: initialBits,
      capacity: initialCapacity,
    });
    const capacities = readArray(record, "capacities");
    const rawFilters = readArray(record, "filters");
    if (capacities.length !== rawFilters.length) {
      throw new TypeError("filter and capacity counts differ");
    }
    const filters: BloomFilter[] = [];
    for (let index = 0; index < rawFilters.length; index++) {
      const capacity = capacities[index];
      if (typeof capacity !== "number" || !Number.isInteger(capacity) || capacity <= 0) {
        throw new TypeError(`capacities[${index}] must be a positive integer`);
      }
      filters.push(BloomFilter.deserialize(rawFilters[index]));
    }
    filter._filters = filters;
    filter._capacities = capacities as number[];
    if (filter.validate() !== true) {
      throw new TypeError(`Invalid ScalableBloomFilter payload: ${filter.validate()}`);
    }
    return filter;
  }

  private reset(): void {
    this._filters = [
      new BloomFilter({
        bits: this._initialBits,
        hashes: this._hashes,
        seed: this._seed,
      }),
    ];
    this._capacities = [this._initialCapacity];
  }

  private addFilter(): void {
    const last = this._filters[this._filters.length - 1];
    const lastCapacity = this._capacities[this._capacities.length - 1];
    const bits = Math.max(
      last.bits + 1,
      Math.ceil((last.bits * this._growthFactor) / this._tighteningRatio),
    );
    const capacity = Math.max(
      lastCapacity + 1,
      Math.ceil(lastCapacity * this._growthFactor),
    );
    this._filters.push(
      new BloomFilter({
        bits,
        hashes: this._hashes,
        seed: this._seed,
      }),
    );
    this._capacities.push(capacity);
  }
}
