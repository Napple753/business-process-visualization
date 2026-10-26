// In-memory model of a single flow file (asis.yaml / tobe.yaml).
// Arrays keep the order found in the file; the order of lanes is the column order.

export const NODE_TYPES = ["start", "end", "task", "decision"] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export interface Lane {
  id: string;
  name: string;
}

export interface Process {
  id: string;
  name: string;
  lane: string;
  type: NodeType;
  description?: string;
  systems?: string[];
  documents?: string[];
}

export interface Flow {
  from: string;
  to: string;
  label?: string;
}

export interface FlowModel {
  version: 1;
  lanes: Lane[];
  processes: Process[];
  flows: Flow[];
}

export type Side = "asis" | "tobe";

export const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function emptyModel(): FlowModel {
  return { version: 1, lanes: [], processes: [], flows: [] };
}

export function flowKey(f: Pick<Flow, "from" | "to">): string {
  return `${f.from}->${f.to}`;
}

export function findProcess(model: FlowModel, id: string): Process | undefined {
  return model.processes.find((p) => p.id === id);
}
