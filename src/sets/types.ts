import type { Serializable } from "../core/index.ts";

export interface DisjointSet<E> extends Serializable {
  readonly setCount: number;
  makeSet(value: E): void;
  find(value: E): E;
  union(a: E, b: E): boolean;
  connected(a: E, b: E): boolean;
  sizeOf(value: E): number;
}

export interface BloomFilterOptions {
  bits?: number;
  hashes?: number;
  seed?: number;
}

export interface ScalableBloomFilterOptions extends BloomFilterOptions {
  capacity?: number;
  growthFactor?: number;
  tighteningRatio?: number;
}

export interface CuckooFilterOptions {
  buckets?: number;
  bucketSize?: number;
  fingerprintBits?: number;
  maxKicks?: number;
  seed?: number;
}
