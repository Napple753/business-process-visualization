import { flowKey, type Flow, type FlowModel, type Lane, type Process } from "./model";

// All edits are pure: they return a new model and never mutate the input.
// Connections are always derived from the operation; users never draw wires.

export interface MutationResult {
  model: FlowModel;
  warning?: string;
}

export function addProcess(model: FlowModel, process: Process): FlowModel {
  return { ...model, processes: [...model.processes, process] };
}

/** A -> C becomes A -> X -> C. The flow label stays on the A side. */
export function insertBetween(model: FlowModel, from: string, to: string, process: Process): FlowModel {
  const index = model.flows.findIndex((f) => f.from === from && f.to === to);
  if (index < 0) throw new Error(`No flow ${from} -> ${to}`);
  const old = model.flows[index];
  const flows = [...model.flows];
  flows.splice(index, 1, { ...old, to: process.id }, { from: process.id, to });
  return { ...model, processes: [...model.processes, process], flows };
}

/** Adds X as a new successor of `from` (a branch when `from` already has successors). */
export function addSuccessor(model: FlowModel, from: string, process: Process, label?: string): FlowModel {
  const flow: Flow = { from, to: process.id, ...(label ? { label } : {}) };
  return { ...model, processes: [...model.processes, process], flows: insertFlowNear(model.flows, flow) };
}

/** Adds X as a new predecessor of `to`. */
export function addPredecessor(model: FlowModel, to: string, process: Process): FlowModel {
  const flow: Flow = { from: process.id, to };
  return { ...model, processes: [...model.processes, process], flows: insertFlowNear(model.flows, flow) };
}

/** Joins `from` into an existing process `to` (merge). */
export function connect(model: FlowModel, from: string, to: string, label?: string): FlowModel {
  if (from === to || model.flows.some((f) => f.from === from && f.to === to)) return model;
  const flow: Flow = { from, to, ...(label ? { label } : {}) };
  return { ...model, flows: insertFlowNear(model.flows, flow) };
}

export function disconnect(model: FlowModel, from: string, to: string): FlowModel {
  return { ...model, flows: model.flows.filter((f) => !(f.from === from && f.to === to)) };
}

/**
 * Removes a process. When it sits on a single path (one predecessor or one successor)
 * its neighbours are reconnected; otherwise reconnecting would be ambiguous, so the
 * flows are dropped and a warning is returned.
 */
export function removeProcess(model: FlowModel, id: string): MutationResult {
  const { flows, warning } = detach(model.flows, id);
  return { model: { ...model, processes: model.processes.filter((p) => p.id !== id), flows }, warning };
}

/**
 * Takes a process out of its current place (reconnecting neighbours) and inserts it
 * into the flow `from -> to`, optionally changing its lane.
 */
export function moveProcess(
  model: FlowModel,
  id: string,
  target: { from: string; to: string },
  lane?: string,
): MutationResult {
  if (target.from === id || target.to === id) return { model };
  const { flows, warning } = detach(model.flows, id);
  const index = flows.findIndex((f) => f.from === target.from && f.to === target.to);
  if (index < 0) return { model, warning: `Cannot move: flow ${target.from} -> ${target.to} disappeared.` };
  const old = flows[index];
  flows.splice(index, 1, { ...old, to: id }, { from: id, to: target.to });
  const processes = lane
    ? model.processes.map((p) => (p.id === id ? { ...p, lane } : p))
    : model.processes;
  return { model: { ...model, processes, flows: dedupe(flows) }, warning };
}

export function updateProcess(model: FlowModel, id: string, patch: Partial<Omit<Process, "id">>): FlowModel {
  return {
    ...model,
    processes: model.processes.map((p) => (p.id === id ? cleanProcess({ ...p, ...patch }) : p)),
  };
}

export function updateFlowLabel(model: FlowModel, from: string, to: string, label: string): FlowModel {
  return {
    ...model,
    flows: model.flows.map((f) => {
      if (f.from !== from || f.to !== to) return f;
      const { label: _old, ...rest } = f;
      return label ? { ...rest, label } : rest;
    }),
  };
}

export function addLane(model: FlowModel, lane: Lane): FlowModel {
  return { ...model, lanes: [...model.lanes, lane] };
}

export function renameLane(model: FlowModel, id: string, name: string): FlowModel {
  return { ...model, lanes: model.lanes.map((l) => (l.id === id ? { ...l, name } : l)) };
}

export function moveLane(model: FlowModel, id: string, delta: -1 | 1): FlowModel {
  const lanes = [...model.lanes];
  const i = lanes.findIndex((l) => l.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= lanes.length) return model;
  [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
  return { ...model, lanes };
}

export function removeLane(model: FlowModel, id: string): MutationResult {
  if (model.processes.some((p) => p.lane === id)) {
    return { model, warning: "Move or delete the processes in this swimlane first." };
  }
  return { model: { ...model, lanes: model.lanes.filter((l) => l.id !== id) } };
}

function detach(flows: Flow[], id: string): { flows: Flow[]; warning?: string } {
  const incoming = flows.filter((f) => f.to === id);
  const outgoing = flows.filter((f) => f.from === id);
  const rest = flows.filter((f) => f.from !== id && f.to !== id);
  if (incoming.length === 0 || outgoing.length === 0) return { flows: rest };
  if (incoming.length > 1 && outgoing.length > 1) {
    return {
      flows: rest,
      warning: `"${id}" had several incoming and outgoing flows; its neighbours were not reconnected.`,
    };
  }
  // Put bridging flows where the first incoming flow was, to keep the file order natural.
  const at = flows.indexOf(incoming[0]);
  const insertAt = rest.findIndex((f) => flows.indexOf(f) > at);
  const bridges: Flow[] = [];
  for (const i of incoming) {
    for (const o of outgoing) {
      if (i.from === o.to) continue;
      // Keep the label that described the decision on the incoming side.
      const label = i.label ?? (incoming.length === 1 ? o.label : undefined);
      bridges.push({ from: i.from, to: o.to, ...(label ? { label } : {}) });
    }
  }
  const result = [...rest];
  result.splice(insertAt < 0 ? result.length : insertAt, 0, ...bridges);
  return { flows: dedupe(result) };
}

/** Places a new flow after the last flow touching its source, keeping related lines together. */
function insertFlowNear(flows: Flow[], flow: Flow): Flow[] {
  let at = -1;
  flows.forEach((f, i) => {
    if (f.from === flow.from || f.to === flow.from) at = i;
  });
  const result = [...flows];
  result.splice(at < 0 ? result.length : at + 1, 0, flow);
  return result;
}

function dedupe(flows: Flow[]): Flow[] {
  const seen = new Set<string>();
  return flows.filter((f) => {
    const key = flowKey(f);
    if (seen.has(key) || f.from === f.to) return false;
    seen.add(key);
    return true;
  });
}

function cleanProcess(p: Process): Process {
  const out: Process = { id: p.id, name: p.name, lane: p.lane, type: p.type };
  if (p.description) out.description = p.description;
  if (p.systems && p.systems.length > 0) out.systems = p.systems;
  if (p.documents && p.documents.length > 0) out.documents = p.documents;
  return out;
}
