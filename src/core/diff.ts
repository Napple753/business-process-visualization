import { buildGraph, projectSuccessors } from "./graph";
import { flowKey, type FlowModel, type Process } from "./model";

export type ChangeKind = "added" | "removed" | "renamed" | "moved" | "laneChanged" | "modified";

export interface ProcessDiff {
  id: string;
  kinds: ChangeKind[];
  /** Attribute names that changed besides name/lane (type, description, ...). */
  changedFields: string[];
}

export interface FlowDiff {
  /** Flow keys ("from->to") only present in As-Is. */
  removed: Set<string>;
  /** Flow keys only present in To-Be. */
  added: Set<string>;
  /** Flow keys present on both sides whose label changed. */
  relabeled: Set<string>;
}

export interface ModelDiff {
  processes: Map<string, ProcessDiff>;
  flows: FlowDiff;
}

const OTHER_FIELDS = ["type", "description", "systems", "documents"] as const;

export function diffModels(asis: FlowModel, tobe: FlowModel): ModelDiff {
  const a = new Map(asis.processes.map((p) => [p.id, p]));
  const b = new Map(tobe.processes.map((p) => [p.id, p]));
  const processes = new Map<string, ProcessDiff>();

  const common = new Set([...a.keys()].filter((id) => b.has(id)));
  const moved = movedIds(asis, tobe, common);

  for (const [id, pa] of a) {
    const pb = b.get(id);
    if (!pb) {
      processes.set(id, { id, kinds: ["removed"], changedFields: [] });
      continue;
    }
    const kinds: ChangeKind[] = [];
    if (pa.name !== pb.name) kinds.push("renamed");
    if (pa.lane !== pb.lane) kinds.push("laneChanged");
    if (moved.has(id)) kinds.push("moved");
    const changedFields = OTHER_FIELDS.filter((f) => !sameField(pa, pb, f));
    if (changedFields.length > 0) kinds.push("modified");
    processes.set(id, { id, kinds, changedFields: [...changedFields] });
  }
  for (const id of b.keys()) {
    if (!a.has(id)) processes.set(id, { id, kinds: ["added"], changedFields: [] });
  }

  const fa = new Map(asis.flows.map((f) => [flowKey(f), f]));
  const fb = new Map(tobe.flows.map((f) => [flowKey(f), f]));
  const flows: FlowDiff = { removed: new Set(), added: new Set(), relabeled: new Set() };
  for (const [k, f] of fa) {
    const other = fb.get(k);
    if (!other) flows.removed.add(k);
    else if ((other.label ?? "") !== (f.label ?? "")) flows.relabeled.add(k);
  }
  for (const k of fb.keys()) if (!fa.has(k)) flows.added.add(k);

  return { processes, flows };
}

/**
 * A common process is "moved" when its position in the flow changed.
 *
 * Both graphs are projected onto the common processes, so plain insertions or
 * removals of other processes contract away. A move both breaks old connections and
 * creates new ones; only adding (or only removing) connections is a new or dropped
 * branch/merge, not a move. While both kinds of change remain, the process involved
 * in the most of them is taken as moved and dropped from the projection. Relocating
 * or swapping a process therefore reports that process only, not its neighbours.
 */
function movedIds(asis: FlowModel, tobe: FlowModel, common: Set<string>): Set<string> {
  const ga = buildGraph(asis);
  const gb = buildGraph(tobe);
  const keep = new Set(common);
  const moved = new Set<string>();
  for (;;) {
    const ea = edgeSet(projectSuccessors(ga, keep));
    const eb = edgeSet(projectSuccessors(gb, keep));
    const lost = [...ea].filter((e) => !eb.has(e));
    const gained = [...eb].filter((e) => !ea.has(e));
    if (lost.length === 0 || gained.length === 0) return moved;
    const score = new Map<string, number>();
    for (const edge of [...lost, ...gained]) {
      for (const id of edge.split("->")) score.set(id, (score.get(id) ?? 0) + 1);
    }
    let worst = "";
    let worstScore = 0;
    for (const id of keep) {
      const value = score.get(id) ?? 0;
      if (value > worstScore) {
        worst = id;
        worstScore = value;
      }
    }
    moved.add(worst);
    keep.delete(worst);
  }
}

function edgeSet(succ: Map<string, Set<string>>): Set<string> {
  const edges = new Set<string>();
  for (const [from, tos] of succ) for (const to of tos) edges.add(`${from}->${to}`);
  return edges;
}

function sameField(a: Process, b: Process, field: (typeof OTHER_FIELDS)[number]): boolean {
  return JSON.stringify(a[field] ?? null) === JSON.stringify(b[field] ?? null);
}
