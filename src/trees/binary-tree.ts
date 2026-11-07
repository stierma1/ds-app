import {
  ContainerBase,
  parseSerialized,
  readArray,
  readInteger,
  readObject,
  readValue,
  serializeRecord,
} from "../core/index.ts";
import type { TreeNode, TreeLike } from "./types.ts";

export function makeNode<T>(
  value: T,
  parent: TreeNode<T> | null = null,
): TreeNode<T> {
  return { value, left: null, right: null, parent };
}

export class BinaryTree<T> extends ContainerBase<T> implements TreeLike<T> {
  private _root: TreeNode<T> | null;

  constructor(root: TreeNode<T> | null = null) {
    super();
    this._root = root;
  }

  static fromComplete<T>(values: Array<T | null>): BinaryTree<T> {
    if (values.length === 0 || values[0] === null) {
      return new BinaryTree<T>(null);
    }
    const root = makeNode(values[0]);
    const queue: TreeNode<T>[] = [root];
    let index = 1;
    while (queue.length > 0 && index < values.length) {
      const parent = queue.shift()!;
      const left = values[index++];
      if (left !== null && left !== undefined) {
        const child = makeNode(left, parent);
        parent.left = child;
        queue.push(child);
      }
      if (index >= values.length) {
        break;
      }
      const right = values[index++];
      if (right !== null && right !== undefined) {
        const child = makeNode(right, parent);
        parent.right = child;
        queue.push(child);
      }
    }
    return new BinaryTree(root);
  }

  get root(): TreeNode<T> | null {
    return this._root;
  }

  override get size(): number {
    let count = 0;
    const stack: TreeNode<T>[] = this._root === null ? [] : [this._root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      count++;
      if (node.right !== null) stack.push(node.right);
      if (node.left !== null) stack.push(node.left);
    }
    return count;
  }

  override isEmpty(): boolean {
    return this._root === null;
  }

  get height(): number {
    if (this._root === null) {
      return -1;
    }
    let height = 0;
    let level: TreeNode<T>[] = [this._root];
    while (level.length > 0) {
      const next: TreeNode<T>[] = [];
      for (const node of level) {
        if (node.left !== null) next.push(node.left);
        if (node.right !== null) next.push(node.right);
      }
      if (next.length > 0) {
        height++;
      }
      level = next;
    }
    return height;
  }

  preorder(): IterableIterator<T> {
    const values: T[] = [];
    const stack: TreeNode<T>[] = this._root === null ? [] : [this._root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      values.push(node.value);
      if (node.right !== null) stack.push(node.right);
      if (node.left !== null) stack.push(node.left);
    }
    return this.snapshotIterator(values);
  }

  inorder(): IterableIterator<T> {
    const values: T[] = [];
    const stack: TreeNode<T>[] = [];
    let node = this._root;
    while (node !== null || stack.length > 0) {
      while (node !== null) {
        stack.push(node);
        node = node.left;
      }
      node = stack.pop()!;
      values.push(node.value);
      node = node.right;
    }
    return this.snapshotIterator(values);
  }

  postorder(): IterableIterator<T> {
    const values: T[] = [];
    const stack: TreeNode<T>[] = this._root === null ? [] : [this._root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      values.push(node.value);
      if (node.left !== null) stack.push(node.left);
      if (node.right !== null) stack.push(node.right);
    }
    values.reverse();
    return this.snapshotIterator(values);
  }

  levelOrder(): IterableIterator<T> {
    const values: T[] = [];
    const queue: TreeNode<T>[] = this._root === null ? [] : [this._root];
    let index = 0;
    while (index < queue.length) {
      const node = queue[index++];
      values.push(node.value);
      if (node.left !== null) queue.push(node.left);
      if (node.right !== null) queue.push(node.right);
    }
    return this.snapshotIterator(values);
  }

  eulerTour(): IterableIterator<T> {
    const values: T[] = [];
    if (this._root === null) {
      return this.snapshotIterator(values);
    }
    interface Frame {
      node: TreeNode<T>;
      entered: boolean;
      childIndex: number;
    }
    const stack: Frame[] = [{ node: this._root, entered: false, childIndex: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (!frame.entered) {
        frame.entered = true;
        values.push(frame.node.value);
        continue;
      }
      const children = [frame.node.left, frame.node.right].filter(
        (child): child is TreeNode<T> => child !== null,
      );
      if (frame.childIndex < children.length) {
        const child = children[frame.childIndex++];
        stack.push({ node: child, entered: false, childIndex: 0 });
      } else {
        stack.pop();
        if (stack.length > 0) {
          values.push(stack[stack.length - 1].node.value);
        }
      }
    }
    return this.snapshotIterator(values);
  }

  serialize(): string {
    const nodes: Array<{
      value: T;
      parent: number;
      side: "left" | "right" | null;
    }> = [];
    if (this._root !== null) {
      const stack: Array<{
        node: TreeNode<T>;
        parent: number;
        side: "left" | "right" | null;
      }> = [{ node: this._root, parent: -1, side: null }];
      while (stack.length > 0) {
        const current = stack.pop()!;
        if (current.node.value === undefined) {
          throw new TypeError("Cannot serialize a node with an undefined value");
        }
        const index = nodes.length;
        nodes.push({
          value: current.node.value,
          parent: current.parent,
          side: current.side,
        });
        if (current.node.right !== null) {
          stack.push({ node: current.node.right, parent: index, side: "right" });
        }
        if (current.node.left !== null) {
          stack.push({ node: current.node.left, parent: index, side: "left" });
        }
      }
    }
    return serializeRecord("BinaryTree", { nodes });
  }

  static deserialize<T>(json: unknown): BinaryTree<T> {
    const record = parseSerialized(json, "BinaryTree");
    const raw = readArray(record, "nodes");
    const tree = new BinaryTree<T>();
    if (raw.length === 0) {
      return tree;
    }
    const created: TreeNode<T>[] = [];
    for (let index = 0; index < raw.length; index++) {
      const entry = readObject(raw[index], `nodes[${index}]`);
      const value = readValue<T>(entry.value, `nodes[${index}].value`);
      const parent = readInteger(entry, "parent");
      const side = entry.side;
      if (side !== null && side !== "left" && side !== "right") {
        throw new TypeError(`nodes[${index}].side must be 'left', 'right', or null`);
      }
      const node = makeNode(value);
      if (index === 0) {
        if (parent !== -1 || side !== null) {
          throw new TypeError("root must have parent -1 and side null");
        }
        tree._root = node;
      } else {
        if (parent < 0 || parent >= index) {
          throw new TypeError(`nodes[${index}].parent must refer to an earlier node`);
        }
        if (side === null) {
          throw new TypeError(`nodes[${index}].side must be 'left' or 'right'`);
        }
        const parentNode = created[parent];
        if (side === "left") {
          if (parentNode.left !== null) {
            throw new TypeError(`nodes[${index}] would replace an existing left child`);
          }
          parentNode.left = node;
        } else {
          if (parentNode.right !== null) {
            throw new TypeError(`nodes[${index}] would replace an existing right child`);
          }
          parentNode.right = node;
        }
        node.parent = parentNode;
      }
      created.push(node);
    }
    return tree;
  }

  clear(): void {
    this._root = null;
    this.touch();
  }

  toArray(): T[] {
    return [...this.preorder()];
  }

  [Symbol.iterator](): IterableIterator<T> {
    return this.preorder();
  }

  validate(): true | string {
    if (this._root === null) {
      return true;
    }
    if (this._root.parent !== null) {
      return "root has a parent";
    }
    const seen = new Set<TreeNode<T>>();
    const stack: TreeNode<T>[] = [this._root];
    let count = 0;
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (seen.has(node)) {
        return "cycle detected in tree links";
      }
      seen.add(node);
      count++;
      if (node.value === undefined) {
        return `node at index ${count - 1} has an undefined value`;
      }
      if (node.left !== null) {
        if (node.left.parent !== node) {
          return `left child of node ${count - 1} has an incorrect parent link`;
        }
        stack.push(node.left);
      }
      if (node.right !== null) {
        if (node.right.parent !== node) {
          return `right child of node ${count - 1} has an incorrect parent link`;
        }
        stack.push(node.right);
      }
    }
    if (count !== this.size) {
      return "node count changed during validation";
    }
    return true;
  }
}
