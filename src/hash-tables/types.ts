import type { Container, SetLike } from "../core/index.ts";

export interface HashOptions<K> {
  capacity?: number;
  loadFactor?: number;
  hash?: (key: K) => number;
  equals?: (a: K, b: K) => boolean;
}

export interface HashMapLike<K, V> extends Container<[K, V]> {
  set(key: K, value: V): this;
  get(key: K): V | undefined;
  has(key: K): boolean;
  delete(key: K): boolean;
  keys(): IterableIterator<K>;
  values(): IterableIterator<V>;
  entries(): IterableIterator<[K, V]>;
  clear(): void;
  reserve(capacity: number): void;
}

export interface HashSetLike<E> extends SetLike<E> {
  values(): IterableIterator<E>;
}

export interface UniversalHashOptions<K> extends HashOptions<K> {
  seed?: number;
}

export interface CuckooHashOptions<K> extends HashOptions<K> {
  bucketSize?: number;
  maxKicks?: number;
}

export interface ExtendibleHashOptions<K> extends HashOptions<K> {
  bucketSize?: number;
}

export interface PerfectHashOptions<K> extends HashOptions<K> {
  seed?: number;
}
