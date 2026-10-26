import type { FlowModel } from "./model";

/** Adjacency view of a model; flows pointing to unknown ids are ignored. */
export interface Graph {
  ids: string[];
  succ: Map<string, string[]>;
  pred: Map<string, string[]>;
}

export function buildGraph(model: FlowModel): Graph {
  const ids = model.processes.map((p) => p.id);
  const known = new Set(ids);
  const succ = new Map(ids.map((id) => [id, [] as string[]]));
  const pred = new Map(ids.map((id) => [id, [] as string[]]));
  for (const f of model.flows) {
    if (!known.has(f.from) || !known.has(f.to)) continue;
    succ.get(f.from)!.push(f.to);
    pred.get(f.to)!.push(f.from);
  }
  return { ids, succ, pred };
}

/**
 * Projects the graph onto `keep`: every other node is contracted away, so an edge
 * a -> x -> b (x not kept) becomes a -> b. Returns successor sets of kept nodes.
 */
export function projectSuccessors(graph: Graph, keep: Set<string>): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const id of graph.ids) {
    if (!keep.has(id)) continue;
    const reached = new Set<string>();
    const seen = new Set<string>([id]);
    const stack = [...(graph.succ.get(id) ?? [])];
    while (stack.length > 0) {
      const next = stack.pop()!;
      if (seen.has(next)) continue;
      seen.add(next);
      if (keep.has(next)) reached.add(next);
      else stack.push(...(graph.succ.get(next) ?? []));
    }
    result.set(id, reached);
  }
  return result;
}

export function invert(succ: Map<string, Set<string>>): Map<string, Set<string>> {
  const pred = new Map<string, Set<string>>();
  for (const id of succ.keys()) pred.set(id, new Set());
  for (const [from, tos] of succ) {
    for (const to of tos) pred.get(to)?.add(from);
  }
  return pred;
}
