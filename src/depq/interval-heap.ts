import type { Comparator } from "../core/index.ts";
import { completeTreeHeight, DepqBase } from "./base.ts";
import { parseDepq } from "./serialization.ts";

interface IntervalNode<T> {
  low: T;
  high?: T;
}

/**
 * Interval heap: a complete binary tree whose nodes each hold an interval
 * `[low, high]`. Low endpoints form a min heap, high endpoints form a max heap,
 * and every child interval is contained in its parent interval. The last node
 * may hold a single value, which belongs only to the min heap. Both endpoints
 * are O(1) to inspect, and insertion/deletion is O(log n).
 *
 * Nodes are stored in a 0-based array; node `i` has children `2i+1` and `2i+2`.
 * Duplicate values are allowed and iteration follows node order, not sorted
 * order.
 */
export class IntervalHeap<T> extends DepqBase<T> {
  private _nodes: Array<IntervalNode<T>> = [];

  constructor(compare?: Comparator<T>) {
    super(compare);
  }

  /** O(log n): add a node, or complete the single last node, then float up. */
  push(value: T): void {
    this.requireValue(value);
    const nodes = this._nodes;
    if (this._size % 2 === 0) {
      nodes.push({ low: value });
    } else {
      const last = nodes[nodes.length - 1];
      if (this.compare(last.low, value) > 0) {
        last.high = last.low;
        last.low = value;
      } else {
        last.high = value;
      }
    }
    this._size++;
    if (this._size > 2) {
      const index = nodes.length - 1;
      const parent = (index - 1) >> 1;
      if (this.compare(nodes[parent].low, value) > 0) {
        this.floatUpMin(index);
      } else if (this.compare(nodes[parent].high as T, value) < 0) {
        this.floatUpMax(index);
      }
    }
    this.touch();
  }

  /** O(1): the low endpoint of the root, or undefined when empty. */
  peekMin(): T | undefined {
    return this._size === 0 ? undefined : this._nodes[0].low;
  }

  /** O(1): the high endpoint of the root, or the sole element when size is one. */
  peekMax(): T | undefined {
    if (this._size === 0) {
      return undefined;
    }
    return this._size === 1
      ? this._nodes[0].low
      : (this._nodes[0].high as T);
  }

  /** O(log n): move the last low endpoint to the root and float it down. */
  popMin(): T | undefined {
    if (this._size === 0) {
      return undefined;
    }
    const nodes = this._nodes;
    const min = nodes[0].low;
    if (this._size === 1) {
      this._nodes = [];
      this._size = 0;
      this.touch();
      return min;
    }
    const lastIndex = nodes.length - 1;
    const last = nodes[lastIndex];
    nodes[0].low = last.low;
    if (this._size % 2 === 1) {
      nodes.pop();
    } else {
      last.low = last.high as T;
      last.high = undefined;
    }
    this._size--;
    this.floatDownMin(0);
    this.touch();
    return min;
  }

  /** O(log n): move the last max endpoint to the root and float it down. */
  popMax(): T | undefined {
    if (this._size === 0) {
      return undefined;
    }
    if (this._size === 1) {
      return this.popMin();
    }
    const nodes = this._nodes;
    const max = nodes[0].high as T;
    const lastIndex = nodes.length - 1;
    const last = nodes[lastIndex];
    if (this._size % 2 === 1) {
      nodes[0].high = last.low;
      nodes.pop();
    } else {
      nodes[0].high = last.high as T;
      last.high = undefined;
    }
    this._size--;
    this.floatDownMax(0);
    this.touch();
    return max;
  }

  /** O(1): height in edges of the node tree. */
  get height(): number {
    return completeTreeHeight(this._nodes.length);
  }

  /** O(n log n): rebuilds by repeated insertion. */
  override build(values: Iterable<T>): void {
    const items = [...values];
    for (const value of items) {
      this.requireValue(value);
    }
    this._nodes = [];
    this._size = 0;
    for (const value of items) {
      this.push(value);
    }
    this.touch();
  }

  /** O(n): checks node count, both heap orderings, and interval containment. */
  validate(): true | string {
    const nodes = this._nodes;
    const expectedNodes = Math.ceil(this._size / 2);
    if (nodes.length !== expectedNodes) {
      return `node count ${nodes.length} does not match size ${this._size}`;
    }
    const lastSingle = this._size % 2 === 1;
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index];
      if (node.low === undefined) {
        return `node ${index} has an undefined low endpoint`;
      }
      if (lastSingle && index === nodes.length - 1) {
        if (node.high !== undefined) {
          return "last node must hold a single value";
        }
      } else if (node.high === undefined) {
        return `node ${index} is missing its high endpoint`;
      } else if (this.compare(node.low, node.high) > 0) {
        return `interval order violated at node ${index}`;
      }
      if (index === 0) {
        continue;
      }
      const parent = (index - 1) >> 1;
      const parentNode = nodes[parent];
      if (this.compare(parentNode.low, node.low) > 0) {
        return `min-heap order violated at node ${index}`;
      }
      if (node.high === undefined) {
        if (this.compare(parentNode.high as T, node.low) < 0) {
          return `last node is outside its parent interval at node ${index}`;
        }
      } else if (this.compare(parentNode.high as T, node.high) < 0) {
        return `max-heap order violated at node ${index}`;
      }
    }
    return true;
  }

  /** O(n log n): rebuilds by repeated insertion and validates the payload. */
  static deserialize<T>(
    json: unknown,
    compare?: Comparator<T>,
  ): IntervalHeap<T> {
    const { values } = parseDepq(json, "IntervalHeap");
    const heap = new IntervalHeap<T>(compare);
    heap.build(values as T[]);
    if (heap.validate() !== true) {
      throw new TypeError(`Invalid IntervalHeap payload: ${heap.validate()}`);
    }
    return heap;
  }

  protected override get serializationType(): string {
    return "IntervalHeap";
  }

  protected collectItems(): T[] {
    const values: T[] = [];
    for (const node of this._nodes) {
      values.push(node.low);
      if (node.high !== undefined) {
        values.push(node.high);
      }
    }
    return values;
  }

  protected releaseStorage(): void {
    this._nodes = [];
  }

  private floatUpMin(start: number): void {
    const nodes = this._nodes;
    let index = start;
    let node = nodes[index];
    while (index > 0) {
      const parentIndex = (index - 1) >> 1;
      const parent = nodes[parentIndex];
      if (this.compare(node.low, parent.low) >= 0) {
        return;
      }
      const value = node.low;
      node.low = parent.low;
      parent.low = value;
      index = parentIndex;
      node = parent;
    }
  }

  private floatUpMax(start: number): void {
    const nodes = this._nodes;
    const lastIndex = nodes.length - 1;
    let index = start;
    let node = nodes[index];
    while (index > 0) {
      const parentIndex = (index - 1) >> 1;
      const parent = nodes[parentIndex];
      if (index === lastIndex && this._size % 2 === 1) {
        if (this.compare(node.low, parent.high as T) < 0) {
          return;
        }
        const value = node.low;
        node.low = parent.high as T;
        parent.high = value;
      } else {
        if (this.compare(node.high as T, parent.high as T) < 0) {
          return;
        }
        const value = node.high as T;
        node.high = parent.high;
        parent.high = value;
      }
      index = parentIndex;
      node = parent;
    }
  }

  private floatDownMin(start: number): void {
    const nodes = this._nodes;
    let index = start;
    while (true) {
      const left = index * 2 + 1;
      if (left >= nodes.length) {
        return;
      }
      let child = left;
      if (left + 1 < nodes.length) {
        child =
          this.compare(nodes[left].low, nodes[left + 1].low) < 0
            ? left
            : left + 1;
      }
      const node = nodes[index];
      const childNode = nodes[child];
      if (this.compare(node.low, childNode.low) <= 0) {
        return;
      }
      const value = node.low;
      node.low = childNode.low;
      childNode.low = value;
      if (
        childNode.high !== undefined &&
        this.compare(childNode.low, childNode.high) > 0
      ) {
        const high = childNode.high;
        childNode.high = childNode.low;
        childNode.low = high;
      }
      index = child;
    }
  }

  private floatDownMax(start: number): void {
    const nodes = this._nodes;
    let index = start;
    while (true) {
      const left = index * 2 + 1;
      if (left >= nodes.length) {
        return;
      }
      const right = left + 1;
      const lastIsSingle =
        right === nodes.length - 1 && this._size % 2 === 1;
      let child = left;
      if (right < nodes.length) {
        if (lastIsSingle) {
          child =
            this.compare(nodes[left].high as T, nodes[right].low) > 0
              ? left
              : right;
        } else {
          child =
            this.compare(
              nodes[left].high as T,
              nodes[right].high as T,
            ) > 0
              ? left
              : right;
        }
      }
      const node = nodes[index];
      const childNode = nodes[child];
      const childIsSingle =
        child === nodes.length - 1 && this._size % 2 === 1;
      if (childIsSingle) {
        if (this.compare(node.high as T, childNode.low) >= 0) {
          return;
        }
        const value = node.high as T;
        node.high = childNode.low;
        childNode.low = value;
      } else {
        if (this.compare(node.high as T, childNode.high as T) >= 0) {
          return;
        }
        const value = node.high as T;
        node.high = childNode.high;
        childNode.high = value;
        if (this.compare(childNode.low, childNode.high as T) > 0) {
          const high = childNode.high as T;
          childNode.high = childNode.low;
          childNode.low = high;
        }
      }
      index = child;
    }
  }
}
