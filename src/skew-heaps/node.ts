/**
 * Internal skew-heap node. Skew heaps store no balance metadata: the tree shape is whatever the
 * unconditional child swaps during meld produce.
 */
export interface SkewNode<T> {
  value: T;
  left: SkewNode<T> | null;
  right: SkewNode<T> | null;
}
