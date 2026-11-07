function literalNode(literal: number): number {
  const variable = Math.abs(literal) - 1;
  return literal > 0 ? variable * 2 : variable * 2 + 1;
}

/**
 * 2-SAT by SCC on the implication graph. With n = `variables` and m clauses: O(n + m) time
 * and space (2n nodes, 2m arcs). Tarjan's SCC is ITERATIVE with an explicit frame stack, so
 * huge instances cannot overflow the call stack. Literals are 1-based and negative means
 * negated. Returns undefined when some variable shares an SCC with its negation, otherwise
 * a satisfying assignment chosen from SCC emission order (sink components first). `clauses`
 * is consumed once; validation of each clause is O(1).
 */
export function twoSat(
  clauses: Iterable<[number, number]>,
  variables: number,
): boolean[] | undefined {
  if (!Number.isInteger(variables) || variables < 0) {
    throw new RangeError("variables must be a non-negative integer");
  }
  const count = variables * 2;
  const adjacency: number[][] = [];
  for (let i = 0; i < count; i++) {
    adjacency.push([]);
  }
  for (const clause of clauses) {
    if (!Array.isArray(clause) || clause.length !== 2) {
      throw new TypeError("each clause must contain two literals");
    }
    for (const literal of clause) {
      if (!Number.isInteger(literal) || literal === 0) {
        throw new TypeError("literals must be non-zero integers");
      }
      if (Math.abs(literal) > variables) {
        throw new RangeError("literal refers to an unknown variable");
      }
    }
    const first = literalNode(clause[0]);
    const second = literalNode(clause[1]);
    adjacency[first ^ 1].push(second);
    adjacency[second ^ 1].push(first);
  }
  const discovery = new Int32Array(count);
  discovery.fill(-1);
  const low = new Int32Array(count);
  const component = new Int32Array(count);
  component.fill(-1);
  const onStack = new Uint8Array(count);
  const stack: number[] = [];
  let timer = 0;
  let componentId = 0;
  for (let root = 0; root < count; root++) {
    if (discovery[root] !== -1) {
      continue;
    }
    discovery[root] = timer;
    low[root] = timer;
    timer++;
    stack.push(root);
    onStack[root] = 1;
    const frames: Array<{ vertex: number; edge: number }> = [
      { vertex: root, edge: 0 },
    ];
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const entries = adjacency[frame.vertex];
      if (frame.edge < entries.length) {
        const next = entries[frame.edge++];
        if (discovery[next] === -1) {
          discovery[next] = timer;
          low[next] = timer;
          timer++;
          stack.push(next);
          onStack[next] = 1;
          frames.push({ vertex: next, edge: 0 });
        } else if (onStack[next] === 1 && discovery[next] < low[frame.vertex]) {
          low[frame.vertex] = discovery[next];
        }
        continue;
      }
      frames.pop();
      if (frames.length > 0) {
        const parent = frames[frames.length - 1].vertex;
        if (low[frame.vertex] < low[parent]) {
          low[parent] = low[frame.vertex];
        }
      }
      if (low[frame.vertex] === discovery[frame.vertex]) {
        while (true) {
          const member = stack.pop()!;
          onStack[member] = 0;
          component[member] = componentId;
          if (member === frame.vertex) {
            break;
          }
        }
        componentId++;
      }
    }
  }
  const assignment: boolean[] = [];
  for (let variable = 0; variable < variables; variable++) {
    const positive = variable * 2;
    const negative = positive + 1;
    if (component[positive] === component[negative]) {
      return undefined;
    }
    assignment.push(component[positive] < component[negative]);
  }
  return assignment;
}
