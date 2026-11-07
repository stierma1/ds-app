import {
  assertDefined,
  ConsumedError,
  ContainerBase,
} from "../core/index.ts";
import { deserializeValues, serializeValues } from "./serialization.ts";
import type { OrderLabel, OrderMaintenanceList as OrderMaintenanceListContract } from "./types.ts";

/**
 * Top-level tag universe. Bucket tags are integers in [0, 2^TOP_BITS); the sentinel
 * bucket always holds tag 0 and the (virtual) end of the universe acts as the upper
 * fence, so no range check is ever needed when appending.
 */
const TOP_BITS = 50;
const TOP_UNIVERSE = 2 ** TOP_BITS;

/**
 * Density threshold base for the top level (Bender et al.). A tag range of size 2^i
 * may hold at most floor((2 / TOP_T)^i) buckets; larger ranges must be sparser, which
 * is what bounds the amortized relabel cost to O(log B) per bucket insertion.
 */
const TOP_T = 1.3;

/** Local label universe inside a bucket: integers in [0, 2^LOCAL_BITS). */
const LOCAL_BITS = 52;
const LOCAL_UNIVERSE = 2 ** LOCAL_BITS;

/** Smallest bucket capacity; grows with log2(n) so splits are amortized O(1). */
const MIN_BUCKET_CAPACITY = 32;

/**
 * One top-level node: a run of consecutive elements that share a tag. Elements in
 * the bucket are ordered by their `local` label.
 */
class Bucket<T> {
  tag: number;
  prev: Bucket<T> | null = null;
  next: Bucket<T> | null = null;
  first: OrderNode<T> | null = null;
  last: OrderNode<T> | null = null;
  count = 0;

  constructor(tag: number) {
    this.tag = tag;
  }
}

class OrderNode<T> implements OrderLabel {
  readonly list: OrderMaintenanceList<T>;
  value: T;
  bucket: Bucket<T> | null;
  local: number;
  prev: OrderNode<T> | null = null;
  next: OrderNode<T> | null = null;
  deleted = false;

  constructor(list: OrderMaintenanceList<T>, value: T, bucket: Bucket<T>, local: number) {
    this.list = list;
    this.value = value;
    this.bucket = bucket;
    this.local = local;
  }
}

/**
 * Order-maintenance list (Dietz and Sleator; Bender et al.): a two-level labeling
 * scheme over a doubly linked list whose node objects are handed back as OrderLabel
 * handles.
 *
 * Level 1 is a linked list of buckets, each carrying an integer tag in [0, 2^50);
 * level 2 is the run of up to O(log n) elements inside a bucket, each carrying a
 * local label in [0, 2^52). compare is O(1): it compares bucket tags, then local
 * labels. insertAfter and delete are O(1) relinks plus label maintenance:
 * - A new local label is the midpoint of its neighbours. When no integer midpoint
 *   is left the bucket (O(log n) elements) is relabeled evenly, which happens at
 *   most once per ~44 consecutive inserts at the same spot.
 * - When a bucket exceeds its capacity (max(32, 2 log2 n)) it splits in half and
 *   the new bucket gets a tag between its neighbours. If the tags are adjacent, the
 *   smallest enclosing aligned tag range whose density is under threshold is
 *   relabeled evenly (amortized O(log B) tag writes per split, B = bucket count).
 * Splits happen once per Θ(log n) inserts, so insertAfter is O(1) amortized and
 * never touches more than one bucket in the common case; the old implementation
 * relabeled the whole list. Deleting the last element of a bucket unlinks the
 * bucket in O(1); tags are never reused and never need compaction.
 * Labels stay valid across relabels because the label is the node itself; using a
 * deleted label throws ConsumedError. Iteration is over a snapshot and throws
 * ConcurrentModificationError if the list is mutated mid-iteration.
 */
export class OrderMaintenanceList<T>
  extends ContainerBase<T>
  implements OrderMaintenanceListContract<T>
{
  /** Always present, always tag 0, never holds elements. */
  private readonly _sentinel: Bucket<T> = new Bucket<T>(0);

  private resolve(label: OrderLabel): OrderNode<T> {
    if (!(label instanceof OrderNode)) {
      throw new TypeError("Label does not belong to an order-maintenance list");
    }
    if (label.list !== this) {
      throw new TypeError("Label belongs to a different list");
    }
    if (label.deleted) {
      throw new ConsumedError("Label has been deleted");
    }
    return label;
  }

  private get firstNode(): OrderNode<T> | null {
    return this._sentinel.next === null ? null : this._sentinel.next.first;
  }

  /**
   * O(1) amortized: an O(1) relink plus midpoint labeling in the common case. The
   * rare slow paths are an O(log n) bucket relabel (local labels exhausted) and an
   * O(log n) bucket split that may relabel O(log B) bucket tags. Passing null
   * inserts at the head.
   */
  insertAfter(label: OrderLabel | null, value: T): OrderLabel {
    assertDefined(value);
    const previous = label === null ? null : this.resolve(label);
    let bucket: Bucket<T>;
    let prevInBucket: OrderNode<T> | null;
    let nextInBucket: OrderNode<T> | null;
    if (previous === null) {
      if (this._sentinel.next === null) {
        bucket = new Bucket<T>(0);
        this.linkBucketAfter(this._sentinel, bucket);
      } else {
        bucket = this._sentinel.next;
      }
      prevInBucket = null;
      nextInBucket = bucket.first;
    } else {
      bucket = previous.bucket!;
      prevInBucket = previous;
      nextInBucket = previous === bucket.last ? null : previous.next;
    }
    const local = this.localBetween(bucket, prevInBucket, nextInBucket);
    const node = new OrderNode(this, value, bucket, local);
    const globalNext = previous === null ? this.firstNode : previous.next;
    node.prev = previous;
    node.next = globalNext;
    if (previous !== null) {
      previous.next = node;
    }
    if (globalNext !== null) {
      globalNext.prev = node;
    }
    if (prevInBucket === null) {
      bucket.first = node;
    }
    if (nextInBucket === null) {
      bucket.last = node;
    }
    bucket.count++;
    this._size++;
    if (bucket.count > this.bucketCapacity()) {
      this.splitBucket(bucket);
    }
    this.touch();
    return node;
  }

  /**
   * O(1) relink; marks the label consumed so later use throws ConsumedError. If the
   * bucket becomes empty it is unlinked too, so tags never need compaction.
   */
  delete(label: OrderLabel): boolean {
    const node = this.resolve(label);
    const bucket = node.bucket!;
    if (node.prev !== null) {
      node.prev.next = node.next;
    }
    if (node.next !== null) {
      node.next.prev = node.prev;
    }
    if (bucket.first === node) {
      bucket.first = node === bucket.last ? null : node.next;
    }
    if (bucket.last === node) {
      bucket.last = bucket.first === null ? null : node.prev;
    }
    bucket.count--;
    if (bucket.count === 0) {
      this.unlinkBucket(bucket);
    }
    node.deleted = true;
    node.bucket = null;
    node.prev = null;
    node.next = null;
    this._size--;
    this.touch();
    return true;
  }

  /**
   * O(1): compares bucket tags, then local labels, after an ownership and liveness
   * check. Both differences are exact (tags < 2^50, locals < 2^52).
   */
  compare(a: OrderLabel, b: OrderLabel): number {
    const left = this.resolve(a);
    const right = this.resolve(b);
    const byBucket = left.bucket!.tag - right.bucket!.tag;
    return byBucket !== 0 ? byBucket : left.local - right.local;
  }

  /** O(1). */
  get(label: OrderLabel): T | undefined {
    return this.resolve(label).value;
  }

  /** O(n). */
  serialize(): string {
    return serializeValues("OrderMaintenanceList", this.toArray());
  }

  /** O(n) amortized: appends via insertAfter. */
  static deserialize<T>(json: unknown): OrderMaintenanceList<T> {
    const list = new OrderMaintenanceList<T>();
    let label: OrderLabel | null = null;
    for (const value of deserializeValues(json, "OrderMaintenanceList")) {
      label = list.insertAfter(label, value as T);
    }
    return list;
  }

  /** O(n): walks every node to mark its label consumed before dropping the chain. */
  clear(): void {
    for (let node = this.firstNode; node !== null; node = node.next) {
      node.deleted = true;
      node.bucket = null;
    }
    this._sentinel.next = null;
    this._size = 0;
    this.touch();
  }

  /** O(n) walk into a fresh array. */
  toArray(): T[] {
    const values: T[] = [];
    for (let node = this.firstNode; node !== null; node = node.next) {
      values.push(node.value);
    }
    return values;
  }

  /** O(n) up front: snapshots the list, then throws ConcurrentModificationError on mutation. */
  [Symbol.iterator](): IterableIterator<T> {
    return this.snapshotIterator(this.toArray());
  }

  /**
   * O(n): checks both levels: strictly increasing tags from the sentinel, non-empty
   * buckets with correct first/last/count, strictly increasing in-range local labels
   * within each bucket, consistent element links, and the size total.
   */
  validate(): true | string {
    if (this._sentinel.tag !== 0 || this._sentinel.count !== 0) {
      return "sentinel bucket has been modified";
    }
    let total = 0;
    let bucketIndex = 0;
    let previousBucket: Bucket<T> = this._sentinel;
    let previousNode: OrderNode<T> | null = null;
    for (let bucket = this._sentinel.next; bucket !== null; bucket = bucket.next) {
      bucketIndex++;
      if (bucket.prev !== previousBucket) {
        return `broken bucket prev link at bucket ${bucketIndex}`;
      }
      if (
        !Number.isSafeInteger(bucket.tag) ||
        bucket.tag <= previousBucket.tag ||
        bucket.tag >= TOP_UNIVERSE
      ) {
        return `bucket tags are not strictly increasing at bucket ${bucketIndex}`;
      }
      if (bucket.count <= 0 || bucket.first === null || bucket.last === null) {
        return `empty bucket is still linked at bucket ${bucketIndex}`;
      }
      let count = 0;
      let lastLocal = -1;
      let node: OrderNode<T> | null = bucket.first;
      while (node !== null) {
        if (node.prev !== previousNode) {
          return `broken prev link at index ${total}`;
        }
        if (node.deleted) {
          return `deleted node is still linked at index ${total}`;
        }
        if (node.value === undefined) {
          return `node at index ${total} is undefined`;
        }
        if (node.bucket !== bucket) {
          return `node at index ${total} points at the wrong bucket`;
        }
        if (
          !Number.isSafeInteger(node.local) ||
          node.local <= lastLocal ||
          node.local >= LOCAL_UNIVERSE
        ) {
          return `local labels are not strictly increasing at index ${total}`;
        }
        lastLocal = node.local;
        previousNode = node;
        count++;
        total++;
        if (total > this._size) {
          return "cycle detected in order-maintenance links";
        }
        if (node === bucket.last) {
          break;
        }
        node = node.next;
      }
      if (node === null) {
        return `bucket ${bucketIndex} last pointer is not in its chain`;
      }
      if (count !== bucket.count) {
        return `bucket ${bucketIndex} count ${bucket.count} does not match ${count} nodes`;
      }
      if (bucket.next === null && bucket.last.next !== null) {
        return "last bucket's last node has a successor";
      }
      if (bucket.next !== null && bucket.last.next !== bucket.next.first) {
        return `bucket ${bucketIndex} does not chain into the next bucket`;
      }
      previousBucket = bucket;
    }
    if (total !== this._size) {
      return `size ${this._size} does not match node count ${total}`;
    }
    return true;
  }

  /** Capacity grows with log2(n) so splits are amortized O(1) per element insert. */
  private bucketCapacity(): number {
    return Math.max(MIN_BUCKET_CAPACITY, 2 * Math.ceil(Math.log2(this._size + 1)));
  }

  /**
   * Local label policy: the integer midpoint of the neighbours' labels (fences -1 and
   * 2^52 at the bucket ends). When no integer lies strictly between, the bucket is
   * relabeled evenly (O(bucket size) = O(log n)) and the midpoint is recomputed.
   */
  private localBetween(
    bucket: Bucket<T>,
    previous: OrderNode<T> | null,
    next: OrderNode<T> | null,
  ): number {
    let lo = previous === null ? -1 : previous.local;
    let hi = next === null ? LOCAL_UNIVERSE : next.local;
    if (hi - lo < 2) {
      this.relabelBucket(bucket);
      lo = previous === null ? -1 : previous.local;
      hi = next === null ? LOCAL_UNIVERSE : next.local;
    }
    return lo + Math.floor((hi - lo) / 2);
  }

  /** O(bucket.count): spreads the local labels evenly over [0, 2^52). */
  private relabelBucket(bucket: Bucket<T>): void {
    const step = LOCAL_UNIVERSE / (bucket.count + 1);
    let index = 1;
    for (let node = bucket.first; node !== null; node = node.next) {
      node.local = Math.floor(index * step);
      index++;
      if (node === bucket.last) {
        break;
      }
    }
  }

  /**
   * O(bucket.count) = O(log n): moves the upper half into a new bucket linked right
   * after this one, relabels both halves locally, and assigns the new bucket a tag.
   */
  private splitBucket(bucket: Bucket<T>): void {
    const keep = bucket.count >>> 1;
    let middle = bucket.first!;
    for (let i = 0; i < keep; i++) {
      middle = middle.next!;
    }
    const upper = new Bucket<T>(0);
    upper.first = middle;
    upper.last = bucket.last;
    upper.count = bucket.count - keep;
    bucket.last = middle.prev;
    bucket.count = keep;
    for (let node: OrderNode<T> | null = middle; node !== null; node = node.next) {
      node.bucket = upper;
      if (node === upper.last) {
        break;
      }
    }
    this.relabelBucket(bucket);
    this.relabelBucket(upper);
    this.linkBucketAfter(bucket, upper);
  }

  /** O(1) link plus tag assignment (see assignTag). */
  private linkBucketAfter(previous: Bucket<T>, bucket: Bucket<T>): void {
    bucket.prev = previous;
    bucket.next = previous.next;
    if (previous.next !== null) {
      previous.next.prev = bucket;
    }
    previous.next = bucket;
    this.assignTag(bucket);
  }

  /** O(1): the sentinel is never unlinked. */
  private unlinkBucket(bucket: Bucket<T>): void {
    bucket.prev!.next = bucket.next;
    if (bucket.next !== null) {
      bucket.next.prev = bucket.prev;
    }
    bucket.prev = null;
    bucket.next = null;
    bucket.first = null;
    bucket.last = null;
  }

  /**
   * Tag policy for a bucket already linked after `bucket.prev`: the integer midpoint
   * of the neighbouring tags (the end of the universe is the upper fence). When the
   * neighbours are adjacent, walk up aligned ranges of size 2^i around the
   * predecessor's tag until one is found whose occupancy (buckets already inside plus
   * this one) is at most floor((2 / TOP_T)^i), then spread that range's tags evenly.
   * The sentinel keeps tag 0 because it is the leftmost bucket of any range that
   * contains it. Amortized O(log B) tag writes per insertion by the standard density
   * argument; throws RangeError only if the whole 2^50 universe is over threshold,
   * which needs on the order of 10^9 buckets.
   */
  private assignTag(bucket: Bucket<T>): void {
    const previous = bucket.prev!;
    const lo = previous.tag;
    const hi = bucket.next === null ? TOP_UNIVERSE : bucket.next.tag;
    if (hi - lo >= 2) {
      bucket.tag = lo + Math.floor((hi - lo) / 2);
      return;
    }
    let leftmost: Bucket<T> = previous;
    let rightmost: Bucket<T> = bucket;
    let occupancy = 2;
    for (let level = 1; level <= TOP_BITS; level++) {
      const size = 2 ** level;
      const base = Math.floor(lo / size) * size;
      const end = base + size;
      while (leftmost.prev !== null && leftmost.prev.tag >= base) {
        leftmost = leftmost.prev;
        occupancy++;
      }
      while (rightmost.next !== null && rightmost.next.tag < end) {
        rightmost = rightmost.next;
        occupancy++;
      }
      const limit = Math.floor((2 / TOP_T) ** level);
      if (occupancy <= limit) {
        const step = size / occupancy;
        let index = 0;
        for (let current: Bucket<T> | null = leftmost; current !== null; current = current.next) {
          current.tag = base + Math.floor(index * step);
          index++;
          if (current === rightmost) {
            break;
          }
        }
        return;
      }
    }
    throw new RangeError("OrderMaintenanceList tag universe is exhausted");
  }
}
