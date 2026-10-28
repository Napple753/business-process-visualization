import { describe, expect, it } from "vitest";
import { diffModels } from "./diff";
import { heightOf, layoutModels, mergeLanes, NODE_HEIGHT, positionOf } from "./layout";
import type { FlowModel, Process } from "./model";
import { insertBetween, moveProcess, removeProcess, updateProcess } from "./mutations";
import { parseFlowYaml } from "./parse";
import { assignDecisionPorts } from "./ports";
import { serializeFlowYaml } from "./serialize";
import { slugify, uniqueSlug } from "./slug";
import { validateModel } from "./validate";

const SAMPLE = `# Sales order flow
version: 1
swimlanes:
  sales: {name: Sales}
  manager: {name: Manager}
processes:
  # Entry point
  receive-order:
    name: Receive order
    lane: sales
    type: start
  approve-order:
    name: Approve order
    lane: manager
    type: decision
    systems: [ERP]
  register-order:
    name: Register order
    lane: sales
    type: end
flows:
  - from: receive-order
    to: approve-order
  - from: approve-order # approved path
    to: register-order
    label: Approved
`;

function chain(ids: string[], lane = "l"): FlowModel {
  return {
    version: 1,
    lanes: [{ id: lane, name: lane }],
    processes: ids.map((id) => ({ id, name: id, lane, type: "task" })),
    flows: ids.slice(1).map((id, i) => ({ from: ids[i], to: id })),
  };
}

function proc(id: string, lane = "l"): Process {
  return { id, name: id, lane, type: "task" };
}

describe("parse / serialize", () => {
  it("parses processes in file order with defaults", () => {
    const { model, errors } = parseFlowYaml(SAMPLE);
    expect(errors).toEqual([]);
    expect(model!.lanes.map((l) => l.id)).toEqual(["sales", "manager"]);
    expect(model!.processes.map((p) => p.id)).toEqual(["receive-order", "approve-order", "register-order"]);
    expect(model!.flows[1]).toEqual({ from: "approve-order", to: "register-order", label: "Approved" });
  });

  it("reports schema errors instead of throwing", () => {
    const { model, errors } = parseFlowYaml("processes:\n  a:\n    lane: x\n");
    expect(model).toBeNull();
    expect(errors[0]).toContain("processes.a.name");
  });

  it("round-trips unchanged models byte for byte", () => {
    const { model, doc } = parseFlowYaml(SAMPLE);
    expect(serializeFlowYaml(model!, doc)).toBe(SAMPLE);
  });

  it("keeps comments and produces minimal changes on rename", () => {
    const { model, doc } = parseFlowYaml(SAMPLE);
    const renamed = updateProcess(model!, "receive-order", { name: "Receive e-order" });
    const out = serializeFlowYaml(renamed, doc);
    expect(out).toBe(SAMPLE.replace("name: Receive order", "name: Receive e-order"));
  });

  it("writes inserted processes and flows", () => {
    const { model, doc } = parseFlowYaml(SAMPLE);
    const next = insertBetween(model!, "receive-order", "approve-order", proc("check-stock", "sales"));
    const out = serializeFlowYaml(next, doc);
    expect(out).toContain("# Entry point");
    expect(out).toContain("# approved path");
    const reparsed = parseFlowYaml(out).model!;
    expect(reparsed.flows.slice(0, 2)).toEqual([
      { from: "receive-order", to: "check-stock" },
      { from: "check-stock", to: "approve-order" },
    ]);
    expect(out).not.toContain("type: task");
  });

  it("serializes a model without an original document", () => {
    const out = serializeFlowYaml(chain(["a", "b"]));
    expect(parseFlowYaml(out).model).toEqual(chain(["a", "b"]));
  });
});

describe("validate", () => {
  it("flags unknown references", () => {
    const m = chain(["a", "b"]);
    m.flows.push({ from: "b", to: "zzz" });
    m.processes[0].lane = "nope";
    const messages = validateModel(m).filter((i) => i.severity === "error").map((i) => i.message);
    expect(messages.some((s) => s.includes("zzz"))).toBe(true);
    expect(messages.some((s) => s.includes("nope"))).toBe(true);
  });
});

describe("slug", () => {
  it("creates unique slugs", () => {
    expect(slugify("Receive Order (Web)")).toBe("receive-order-web");
    expect(uniqueSlug("Approve", ["approve", "approve-2"])).toBe("approve-3");
  });
});

describe("diff", () => {
  it("does not report pure insertion as moved", () => {
    const d = diffModels(chain(["p10", "p20", "p30"]), chain(["p10", "p15", "p20", "p30"]));
    expect(d.processes.get("p15")!.kinds).toEqual(["added"]);
    for (const id of ["p10", "p20", "p30"]) expect(d.processes.get(id)!.kinds).toEqual([]);
    expect([...d.flows.added].sort()).toEqual(["p10->p15", "p15->p20"]);
    expect([...d.flows.removed]).toEqual(["p10->p20"]);
  });

  it("reports only the relocated process as moved", () => {
    const d = diffModels(chain(["a", "b", "c", "d", "e"]), chain(["a", "c", "d", "b", "e"]));
    const moved = [...d.processes.values()].filter((p) => p.kinds.includes("moved")).map((p) => p.id);
    expect(moved).toEqual(["b"]);
  });

  it("does not report added or removed branches as moved", () => {
    const asis = chain(["a", "b", "c", "d"]);
    const tobe = structuredClone(asis);
    tobe.processes.push({ id: "x", name: "x", lane: "l", type: "task" });
    tobe.flows.push({ from: "b", to: "x" }, { from: "x", to: "d" });
    const moved = (d: ReturnType<typeof diffModels>) =>
      [...d.processes.values()].filter((p) => p.kinds.includes("moved"));
    expect(moved(diffModels(asis, tobe))).toEqual([]);
    expect(moved(diffModels(tobe, asis))).toEqual([]);
  });

  it("reports one process when two are swapped", () => {
    const d = diffModels(chain(["a", "b", "c", "d"]), chain(["a", "c", "b", "d"]));
    const moved = [...d.processes.values()].filter((p) => p.kinds.includes("moved"));
    expect(moved).toHaveLength(1);
  });

  it("detects rename, lane change and removal", () => {
    const asis = chain(["a", "b", "c"]);
    asis.lanes.push({ id: "m", name: "m" });
    const tobe = structuredClone(asis);
    tobe.processes[0].name = "A2";
    tobe.processes[1].lane = "m";
    tobe.processes.pop();
    tobe.flows.pop();
    const d = diffModels(asis, tobe);
    expect(d.processes.get("a")!.kinds).toContain("renamed");
    expect(d.processes.get("b")!.kinds).toContain("laneChanged");
    expect(d.processes.get("c")!.kinds).toEqual(["removed"]);
  });
});

describe("layout", () => {
  it("aligns common processes and puts inserted ones in between", async () => {
    const asis = chain(["p10", "p20", "p30"]);
    const tobe = chain(["p10", "p15", "p20", "p30"]);
    const layout = await layoutModels([asis, tobe]);
    const y = (id: string) => positionOf(layout, "l", id)!.y;
    expect(y("p10")).toBeLessThan(y("p15"));
    expect(y("p15")).toBeLessThan(y("p20"));
    expect(y("p20")).toBeLessThan(y("p30"));
  });

  it("places parallel branches side by side within a lane", async () => {
    const m: FlowModel = {
      version: 1,
      lanes: [{ id: "l", name: "l" }],
      processes: ["a", "b", "c", "d"].map((id) => proc(id)),
      flows: [
        { from: "a", to: "b" },
        { from: "a", to: "c" },
        { from: "b", to: "d" },
        { from: "c", to: "d" },
      ],
    };
    const layout = await layoutModels([m]);
    const b = positionOf(layout, "l", "b")!;
    const c = positionOf(layout, "l", "c")!;
    expect(b.y).toBe(c.y);
    expect(b.x).not.toBe(c.x);
    expect(positionOf(layout, "l", "d")!.y).toBeGreaterThan(b.y);
  });

  it("lets processes found on one side only share a slot", async () => {
    const asis = chain(["a", "x", "c"]);
    const tobe = chain(["a", "y", "c"]);
    const layout = await layoutModels([asis, tobe]);
    const x = positionOf(layout, "l", "x")!;
    const y = positionOf(layout, "l", "y")!;
    expect(x).toEqual(y);
    const single = await layoutModels([asis]);
    expect(layout.lanes[0].width).toBe(single.lanes[0].width);
  });

  it("grows rows to fit tall process boxes", async () => {
    const m = chain(["a", "b", "c"]);
    const layout = await layoutModels([m], (p) => (p.id === "b" ? 120 : 0));
    const y = (id: string) => positionOf(layout, "l", id)!.y;
    expect(heightOf(layout, "a")).toBe(NODE_HEIGHT);
    expect(heightOf(layout, "b")).toBe(120);
    expect(y("c") - y("b")).toBeGreaterThan(y("b") - y("a"));
    expect(y("c") - (y("b") + 120)).toBe(y("b") - (y("a") + NODE_HEIGHT));
  });

  it("keeps a process shared by both sides in the same slot", async () => {
    const branches = (extra: string): FlowModel => ({
      version: 1,
      lanes: [{ id: "l", name: "l" }],
      processes: ["a", "b", extra, "d"].map((id) => proc(id)),
      flows: [
        { from: "a", to: "b" },
        { from: "a", to: extra },
        { from: "b", to: "d" },
        { from: extra, to: "d" },
      ],
    });
    const layout = await layoutModels([branches("x"), branches("y")]);
    const single = await layoutModels([branches("x")]);
    expect(positionOf(layout, "l", "x")).toEqual(positionOf(layout, "l", "y"));
    expect(positionOf(layout, "l", "x")!.x).not.toBe(positionOf(layout, "l", "b")!.x);
    expect(layout.lanes[0].width).toBe(single.lanes[0].width);
  });

  it("merges lane orders", () => {
    const lanes = (ids: string[]) => ids.map((id) => ({ id, name: id }));
    expect(mergeLanes([lanes(["a", "b", "c"]), lanes(["a", "x", "c", "y"])])).toEqual(["a", "x", "b", "c", "y"]);
  });
});

describe("mutations", () => {
  it("reconnects neighbours on removal", () => {
    const { model } = removeProcess(chain(["a", "b", "c"]), "b");
    expect(model.flows).toEqual([{ from: "a", to: "c" }]);
  });

  it("warns when removal is ambiguous", () => {
    const m: FlowModel = {
      ...chain(["a", "b", "x", "c", "d"]),
      flows: [
        { from: "a", to: "x" },
        { from: "b", to: "x" },
        { from: "x", to: "c" },
        { from: "x", to: "d" },
      ],
    };
    const { model, warning } = removeProcess(m, "x");
    expect(model.flows).toEqual([]);
    expect(warning).toBeDefined();
  });

  it("moves a process onto another flow", () => {
    const { model } = moveProcess(chain(["a", "b", "c", "d"]), "b", { from: "c", to: "d" });
    expect(model.flows).toEqual([
      { from: "a", to: "c" },
      { from: "c", to: "b" },
      { from: "b", to: "d" },
    ]);
  });
});

describe("decision ports", () => {
  const decision = (targets: Record<string, { x: number; y: number }>): Map<string, string> => {
    const m: FlowModel = {
      version: 1,
      lanes: [{ id: "l", name: "l" }],
      processes: [{ ...proc("d"), type: "decision" }, ...Object.keys(targets).map((id) => proc(id))],
      flows: Object.keys(targets).map((to) => ({ from: "d", to })),
    };
    const centers: Record<string, { x: number; y: number }> = { d: { x: 0, y: 0 }, ...targets };
    return assignDecisionPorts(m, (id) => centers[id]);
  };

  it("leaves towards the target's direction", () => {
    const ports = decision({ below: { x: 0, y: 100 }, right: { x: 400, y: 100 } });
    expect(ports.get("d->below")).toBe("bottom");
    expect(ports.get("d->right")).toBe("right");
  });

  it("spreads flows that prefer the same vertex", () => {
    const ports = decision({ a: { x: 0, y: 100 }, b: { x: 20, y: 300 } });
    expect(new Set(ports.values()).size).toBe(2);
    expect(ports.get("d->a")).toBe("bottom");
  });

  it("uses all three vertices in left-to-right order", () => {
    const ports = decision({ l: { x: -400, y: 100 }, m: { x: 0, y: 100 }, r: { x: 400, y: 100 } });
    expect([ports.get("d->l"), ports.get("d->m"), ports.get("d->r")]).toEqual(["left", "bottom", "right"]);
  });
});
