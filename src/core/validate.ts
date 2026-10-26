import { buildGraph } from "./graph";
import { flowKey, ID_PATTERN, type FlowModel } from "./model";

export type Severity = "error" | "warning";

export interface Issue {
  severity: Severity;
  message: string;
  /** Process id the issue is about, when there is one. */
  target?: string;
}

export function validateModel(model: FlowModel): Issue[] {
  const issues: Issue[] = [];
  const laneIds = new Set(model.lanes.map((l) => l.id));
  const processIds = new Set(model.processes.map((p) => p.id));

  for (const lane of model.lanes) {
    if (!ID_PATTERN.test(lane.id)) issues.push(error(`Swimlane id "${lane.id}" is not a valid slug.`));
  }

  for (const p of model.processes) {
    if (!ID_PATTERN.test(p.id)) issues.push(error(`Process id "${p.id}" is not a valid slug.`, p.id));
    if (!laneIds.has(p.lane)) issues.push(error(`Process "${p.id}" refers to unknown swimlane "${p.lane}".`, p.id));
  }

  const seen = new Set<string>();
  for (const f of model.flows) {
    if (!processIds.has(f.from)) issues.push(error(`Flow refers to unknown process "${f.from}".`));
    if (!processIds.has(f.to)) issues.push(error(`Flow refers to unknown process "${f.to}".`));
    if (f.from === f.to) issues.push(error(`Flow from "${f.from}" to itself.`, f.from));
    const key = flowKey(f);
    if (seen.has(key)) issues.push(warning(`Duplicate flow ${f.from} -> ${f.to}.`, f.from));
    seen.add(key);
  }

  const graph = buildGraph(model);
  for (const p of model.processes) {
    const ins = graph.pred.get(p.id)!.length;
    const outs = graph.succ.get(p.id)!.length;
    if (model.processes.length > 1 && ins === 0 && outs === 0) {
      issues.push(warning(`Process "${p.id}" is not connected.`, p.id));
      continue;
    }
    if (p.type === "start" && ins > 0) issues.push(warning(`Start "${p.id}" has incoming flows.`, p.id));
    if (p.type === "end" && outs > 0) issues.push(warning(`End "${p.id}" has outgoing flows.`, p.id));
    if (p.type === "decision" && outs < 2) issues.push(warning(`Decision "${p.id}" has fewer than 2 outgoing flows.`, p.id));
  }

  if (model.processes.length > 0 && !model.processes.some((p) => p.type === "start")) {
    issues.push(warning("No start process."));
  }
  if (model.processes.length > 0 && !model.processes.some((p) => p.type === "end")) {
    issues.push(warning("No end process."));
  }
  return issues;
}

function error(message: string, target?: string): Issue {
  return { severity: "error", message, target };
}

function warning(message: string, target?: string): Issue {
  return { severity: "warning", message, target };
}
