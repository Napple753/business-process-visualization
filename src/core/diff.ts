import { buildGraph, invert, projectSuccessors } from "./graph";
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
 * removals of other processes contract away. While the projections still differ,
 * the process with the most neighbour differences is taken as moved and dropped
 * from the projection. This yields a small set: swapping or relocating one process
 * reports that process only, not all of its old and new neighbours.
 */
function movedIds(asis: FlowModel, tobe: FlowModel, common: Set<string>): Set<string> {
  const ga = buildGraph(asis);
  const gb = buildGraph(tobe);
  const keep = new Set(common);
  const moved = new Set<string>();
  for (;;) {
    const sa = projectSuccessors(ga, keep);
    const sb = projectSuccessors(gb, keep);
    const pa = invert(sa);
    const pb = invert(sb);
    let worst: string | null = null;
    let worstScore = 0;
    for (const id of keep) {
      const score =
        symmetricDiff(sa.get(id), sb.get(id)).length + symmetricDiff(pa.get(id), pb.get(id)).length;
      if (score > worstScore) {
        worst = id;
        worstScore = score;
      }
    }
    if (worst === null) return moved;
    moved.add(worst);
    keep.delete(worst);
  }
}

function symmetricDiff(a: Set<string> | undefined, b: Set<string> | undefined): string[] {
  const x = a ?? new Set<string>();
  const y = b ?? new Set<string>();
  return [...[...x].filter((v) => !y.has(v)), ...[...y].filter((v) => !x.has(v))];
}

function sameField(a: Process, b: Process, field: (typeof OTHER_FIELDS)[number]): boolean {
  return JSON.stringify(a[field] ?? null) === JSON.stringify(b[field] ?? null);
}
