import { ConcurrentModificationError, ConsumedError } from "../core/index.ts";

/**
 * Internal implementation handle for a finger. The public contract is the `Finger<K>` interface;
 * keeping the bookkeeping here lets both implementations share handle validity rules while their
 * node types stay private.
 *
 * `_node` is the implementation's node object and `_index` is its slot inside a leaf (or `-1` for
 * a node-based finger). `_key` is the entry's key and does not change when neighbours are
 * inserted or removed before the finger.
 */
export class FingerHandle<K> {
  readonly _owner: object;
  private readonly ownerConsumed: () => boolean;
  _node: object;
  _index: number;
  _key: K;
  private invalidated = false;

  constructor(
    owner: object,
    ownerConsumed: () => boolean,
    key: K,
    node: object,
    index: number,
  ) {
    this._owner = owner;
    this.ownerConsumed = ownerConsumed;
    this._key = key;
    this._node = node;
    this._index = index;
  }

  /**
   * O(1): the finger's key. Throws `ConsumedError` once the owning map has been consumed, and
   * `ConcurrentModificationError` after `deleteAt`, `delete`, or `clear` invalidated the finger.
   */
  get key(): K {
    if (this.ownerConsumed()) {
      throw new ConsumedError();
    }
    if (this.invalidated) {
      throw new ConcurrentModificationError();
    }
    return this._key;
  }

  /** O(1): true once the pointed-at entry was removed or the map was cleared. */
  get invalid(): boolean {
    return this.invalidated;
  }

  /** O(1): reports whether the owning map has been consumed by join or split. */
  isOwnerConsumed(): boolean {
    return this.ownerConsumed();
  }

  /** O(1): permanently invalidates the handle. */
  markInvalid(): void {
    this.invalidated = true;
  }

  /** O(1): updates the handle after `insertAfter` moved it to a new entry. */
  move(node: object, index: number, key: K): void {
    if (this.ownerConsumed()) {
      throw new ConsumedError();
    }
    if (this.invalidated) {
      throw new ConcurrentModificationError();
    }
    this._node = node;
    this._index = index;
    this._key = key;
  }
}
