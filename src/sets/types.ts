import type { Serializable } from "../core/index.ts";

/**
 * Disjoint-set (union-find) ADT implemented by UnionFind, QuickFind, QuickUnion, and
 * WeightedUnionFind. The four differ only in cost: find/union are O(alpha(n)) amortized in
 * UnionFind, O(log n) worst case in WeightedUnionFind, O(1) find / O(n) union in QuickFind, and
 * O(n) worst case in QuickUnion.
 */
export interface DisjointSet<E> extends Serializable {
  readonly setCount: number;
  makeSet(value: E): void;
  find(value: E): E;
  union(a: E, b: E): boolean;
  connected(a: E, b: E): boolean;
  sizeOf(value: E): number;
}

/**
 * Sizing for the Bloom filters: `bits` (default 1024) is the bit-array length m, `hashes` (default
 * 3) is the probe count k, and `seed` perturbs the two base hashes. The expected false-positive
 * rate after n inserts is (1 - e^(-kn/m))^k; add/has cost O(k) regardless of m or n.
 */
export interface BloomFilterOptions {
  bits?: number;
  hashes?: number;
  seed?: number;
}

/**
 * Growth policy for ScalableBloomFilter: `capacity` (default 128) is the insert count at which the
 * first stage is full; each new stage multiplies capacity by `growthFactor` (default 2) and bits by
 * growthFactor / `tighteningRatio` (default 0.9), so later stages are proportionally sparser and
 * the compound false-positive rate converges.
 */
export interface ScalableBloomFilterOptions extends BloomFilterOptions {
  capacity?: number;
  growthFactor?: number;
  tighteningRatio?: number;
}

/**
 * Sizing for CuckooFilter: `buckets` (default 128, rounded up to a power of two) times `bucketSize`
 * (default 4) is the fixed slot capacity; `fingerprintBits` (default 8) sets the false-positive
 * rate to roughly 2 * bucketSize / 2^fingerprintBits; `maxKicks` (default 500) bounds the
 * displacement chain of a crowded insert.
 */
export interface CuckooFilterOptions {
  buckets?: number;
  bucketSize?: number;
  fingerprintBits?: number;
  maxKicks?: number;
  seed?: number;
}
