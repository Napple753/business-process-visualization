import { NODE_WIDTH } from "./layout";
import { flowKey, type FlowModel } from "./model";

/** Vertex of a decision diamond that an outgoing flow leaves from. */
export type Port = "left" | "bottom" | "right";

const PORT_ORDER: Port[] = ["left", "bottom", "right"];

/**
 * Chooses the exit vertex of every flow leaving a decision, keyed by flow key.
 *
 * Each flow prefers the vertex facing its target (straight below: bottom, another
 * column: left or right). Flows are ordered by target x and given distinct vertices
 * in left-to-right order so that they never cross; among those assignments the one
 * honoring the most preferences wins, and on a tie the farther target gives way so the
 * nearest one keeps the straight line. With more than three flows the extra ones
 * share the bottom vertex.
 */
export function assignDecisionPorts(
  model: FlowModel,
  centerOf: (id: string) => { x: number; y: number } | undefined,
): Map<string, Port> {
  const ports = new Map<string, Port>();
  for (const decision of model.processes) {
    if (decision.type !== "decision") continue;
    const origin = centerOf(decision.id);
    if (!origin) continue;
    const outgoing = model.flows
      .filter((f) => f.from === decision.id)
      .map((f) => ({ key: flowKey(f), target: centerOf(f.to) }))
      .filter((o): o is { key: string; target: { x: number; y: number } } => !!o.target)
      .map((o) => ({ ...o, dx: o.target.x - origin.x, preferred: preferredPort(origin, o.target) }))
      .sort((a, b) => a.dx - b.dx || a.target.y - b.target.y);

    if (outgoing.length > PORT_ORDER.length) {
      for (const o of outgoing) ports.set(o.key, o.preferred);
      continue;
    }
    let best: Port[] = [];
    let bestCost = Infinity;
    for (const combo of orderedCombinations(outgoing.length)) {
      const cost = combo.reduce(
        (sum, port, i) => sum + (port === outgoing[i].preferred ? 0 : mismatchCost(origin, outgoing[i].target)),
        0,
      );
      if (cost < bestCost) {
        best = combo;
        bestCost = cost;
      }
    }
    outgoing.forEach((o, i) => ports.set(o.key, best[i]));
  }
  return ports;
}

function preferredPort(origin: { x: number; y: number }, target: { x: number; y: number }): Port {
  const dx = target.x - origin.x;
  if (Math.abs(dx) < NODE_WIDTH / 2) return target.y > origin.y ? "bottom" : "right";
  return dx > 0 ? "right" : "left";
}

/** Slightly above 1, and higher for nearer targets. */
function mismatchCost(origin: { x: number; y: number }, target: { x: number; y: number }): number {
  return 1 + 1 / (1 + Math.abs(target.x - origin.x) + Math.abs(target.y - origin.y));
}

/** Ports for `n` flows, keeping left-to-right order; combinations using bottom come first. */
function orderedCombinations(n: number): Port[][] {
  const all: Port[][] = [];
  const walk = (start: number, picked: Port[]) => {
    if (picked.length === n) {
      all.push(picked);
      return;
    }
    for (let i = start; i < PORT_ORDER.length; i++) walk(i + 1, [...picked, PORT_ORDER[i]]);
  };
  walk(0, []);
  return all.sort((a, b) => Number(b.includes("bottom")) - Number(a.includes("bottom")));
}
