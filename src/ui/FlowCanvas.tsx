import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  type NodeChange,
  type ReactFlowInstance,
  type Viewport,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModelDiff } from "../core/diff";
import { buildGraph } from "../core/graph";
import { LANE_HEADER_HEIGHT, NODE_HEIGHT, NODE_WIDTH, positionOf, type Layout } from "../core/layout";
import { flowKey, type FlowModel, type Lane, type Side } from "../core/model";
import { connect, moveProcess, removeProcess, updateProcess } from "../core/mutations";
import { assignDecisionPorts, type Port } from "../core/ports";
import { useStore } from "../state/store";
import type { FlowStatus } from "./diffStyle";
import { FlowEdge, type FlowEdgeType } from "./edges/FlowEdge";
import { LaneNode, type LaneNodeType } from "./nodes/LaneNode";
import { ProcessNode, type ProcessNodeType } from "./nodes/ProcessNode";

const nodeTypes = { lane: LaneNode, process: ProcessNode };
const edgeTypes = { flow: FlowEdge };
const DROP_DISTANCE = 32;
const FIT_OPTIONS = { padding: 0.06, maxZoom: 1 };

export interface ViewportSync {
  instances: Map<Side, ReactFlowInstance>;
}

interface Props {
  side: Side;
  model: FlowModel;
  /** Lanes of the other side, used to label columns that exist only there. */
  otherLanes: Lane[];
  layout: Layout;
  diff: ModelDiff | null;
  sync: ViewportSync;
}

type DropTarget = { kind: "flow"; from: string; to: string } | { kind: "lane"; lane: string } | null;

export function FlowCanvas({ side, model, otherLanes, layout, diff, sync }: Props) {
  const selection = useStore((s) => s.selection);
  const pending = useStore((s) => s.pending);
  const { apply, select, setPending, requestAdd, notify } = useStore.getState();
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);

  const instanceRef = useRef<ReactFlowInstance | null>(null);
  const fittedWidth = useRef(layout.width);

  // Refit when columns are added or widened; growing taller keeps the user's viewport.
  useEffect(() => {
    if (layout.width === fittedWidth.current) return;
    fittedWidth.current = layout.width;
    requestAnimationFrame(() => void instanceRef.current?.fitView({ ...FIT_OPTIONS, duration: 200 }));
  }, [layout.width]);

  const graph = useMemo(() => buildGraph(model), [model]);
  const laneIds = useMemo(() => new Set(model.lanes.map((l) => l.id)), [model]);

  const remove = useCallback(
    (id: string) => {
      apply(side, (m) => removeProcess(m, id));
    },
    [apply, side],
  );

  const nodes = useMemo(() => {
    const height = layout.height + NODE_HEIGHT;
    const laneNames = new Map([...otherLanes, ...model.lanes].map((l) => [l.id, l.name]));
    const lanes: LaneNodeType[] = layout.lanes.map((col, i) => ({
      id: `lane:${col.id}`,
      type: "lane",
      position: { x: col.x, y: 0 },
      data: {
        name: laneNames.get(col.id) ?? col.id,
        width: col.width,
        height,
        alt: i % 2 === 1,
        ghost: !laneIds.has(col.id),
        dropTarget: dropTarget?.kind === "lane" && dropTarget.lane === col.id,
      },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: -1,
      style: { pointerEvents: "none" },
    }));

    const kindsFor = (id: string) => {
      const kinds = diff?.processes.get(id)?.kinds ?? [];
      return side === "asis" ? kinds.filter((k) => k !== "added") : kinds.filter((k) => k !== "removed");
    };

    const processes: ProcessNodeType[] = model.processes.flatMap((p) => {
      const pos = positionOf(layout, p.lane, p.id);
      if (!pos) return [];
      const position = drag?.id === p.id ? { x: drag.x, y: drag.y } : pos;
      return [
        {
          id: p.id,
          type: "process",
          position,
          selected: selection?.side === side && selection.kind === "process" && selection.id === p.id,
          data: {
            process: p,
            kinds: kindsFor(p.id),
            editable: true,
            hasPredecessors: (graph.pred.get(p.id)?.length ?? 0) > 0,
            hasSuccessors: (graph.succ.get(p.id)?.length ?? 0) > 0,
            onAddNext: () => requestAdd({ side, placement: { kind: "after", from: p.id }, lane: p.lane }),
            onAddBefore: () => requestAdd({ side, placement: { kind: "before", to: p.id }, lane: p.lane }),
            onMerge: () => setPending({ kind: "merge", side, from: p.id }),
            onDelete: () => remove(p.id),
          },
        },
      ];
    });
    return [...lanes, ...processes];
  }, [layout, model, otherLanes, laneIds, diff, side, drag, dropTarget, selection, graph, requestAdd, setPending, remove]);

  const ports = useMemo(
    () =>
      assignDecisionPorts(model, (id) => {
        const p = model.processes.find((q) => q.id === id);
        const pos = p && positionOf(layout, p.lane, p.id);
        return pos && { x: pos.x + NODE_WIDTH / 2, y: pos.y + NODE_HEIGHT / 2 };
      }),
    [model, layout],
  );

  const edges = useMemo((): FlowEdgeType[] => {
    const known = new Set(model.processes.map((p) => p.id));
    return model.flows
      .filter((f) => known.has(f.from) && known.has(f.to))
      .map((f) => {
        const key = flowKey(f);
        let status: FlowStatus | null = null;
        if (diff) {
          if (side === "asis" && diff.flows.removed.has(key)) status = "removed";
          else if (side === "tobe" && diff.flows.added.has(key)) status = "added";
          else if (diff.flows.relabeled.has(key)) status = "relabeled";
        }
        const isDropTarget = dropTarget?.kind === "flow" && dropTarget.from === f.from && dropTarget.to === f.to;
        return {
          id: key,
          type: "flow",
          source: f.from,
          target: f.to,
          sourceHandle: ports.get(key),
          selected: selection?.side === side && selection.kind === "flow" && flowKey(selection) === key,
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
          data: {
            label: f.label,
            port: ports.get(key) ?? null,
            status,
            editable: true,
            dropTarget: isDropTarget,
            onInsert: () => {
              const fromLane = model.processes.find((p) => p.id === f.from)?.lane;
              requestAdd({ side, placement: { kind: "between", from: f.from, to: f.to }, lane: fromLane });
            },
          },
        };
      });
  }, [model, diff, side, dropTarget, selection, requestAdd, ports]);

  const findDropTarget = (id: string, x: number, y: number): DropTarget => {
    const cx = x + NODE_WIDTH / 2;
    const cy = y + NODE_HEIGHT / 2;
    let best: DropTarget = null;
    let bestDistance = DROP_DISTANCE;
    for (const f of model.flows) {
      if (f.from === id || f.to === id) continue;
      const a = processPosition(f.from);
      const b = processPosition(f.to);
      if (!a || !b) continue;
      const port = ports.get(flowKey(f)) ?? "bottom";
      const [sx, sy] = exitPoint(a, port);
      const d = distanceToFlow(cx, cy, sx, sy, b.x + NODE_WIDTH / 2, b.y, port);
      if (d < bestDistance) {
        bestDistance = d;
        best = { kind: "flow", from: f.from, to: f.to };
      }
    }
    if (best) return best;
    const process = model.processes.find((p) => p.id === id);
    const column = layout.lanes.find((l) => cx >= l.x && cx < l.x + l.width && cy > LANE_HEADER_HEIGHT);
    if (process && column && column.id !== process.lane && laneIds.has(column.id)) {
      return { kind: "lane", lane: column.id };
    }
    return null;
  };

  const processPosition = (id: string) => {
    const p = model.processes.find((q) => q.id === id);
    return p ? positionOf(layout, p.lane, p.id) : undefined;
  };

  const onNodesChange = (changes: NodeChange[]) => {
    for (const change of changes) {
      if (change.type === "position" && change.position && change.dragging) {
        setDrag({ id: change.id, ...change.position });
        setDropTarget(findDropTarget(change.id, change.position.x, change.position.y));
      }
    }
  };

  const onNodeDragStop = (_: unknown, node: { id: string }) => {
    const target = drag ? findDropTarget(node.id, drag.x, drag.y) : null;
    setDrag(null);
    setDropTarget(null);
    if (!target) return;
    if (target.kind === "flow") {
      // Dropping into another lane's column also moves the process to that lane.
      const toLane = model.processes.find((p) => p.id === target.to)?.lane;
      const fromLane = model.processes.find((p) => p.id === target.from)?.lane;
      const current = model.processes.find((p) => p.id === node.id)?.lane;
      const column = drag && layout.lanes.find((l) => drag.x + NODE_WIDTH / 2 >= l.x && drag.x + NODE_WIDTH / 2 < l.x + l.width);
      const lane = column && column.id !== current && (column.id === toLane || column.id === fromLane) ? column.id : undefined;
      apply(side, (m) => moveProcess(m, node.id, target, lane));
    } else {
      apply(side, (m) => updateProcess(m, node.id, { lane: target.lane }));
    }
  };

  const onNodeClick = (_: unknown, node: { id: string; type?: string }) => {
    if (node.type !== "process") return;
    if (pending?.kind === "merge") {
      if (pending.side !== side) {
        notify({ level: "warning", text: "Pick a process on the same side." });
        return;
      }
      setPending(null);
      if (pending.from === node.id) return;
      apply(side, (m) => connect(m, pending.from, node.id));
      select({ side, kind: "flow", from: pending.from, to: node.id });
      return;
    }
    select({ side, kind: "process", id: node.id });
  };

  const onMove = (event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
    if (!event) return;
    for (const [other, instance] of sync.instances) {
      if (other !== side) void instance.setViewport(viewport);
    }
  };

  const mergingHere = pending?.kind === "merge" && pending.side === side;

  return (
    <>
      {mergingHere && (
        <div className="canvas-banner" role="status">
          Click the process to connect “{model.processes.find((p) => p.id === pending.from)?.name}” to.
          <button className="small" onClick={() => setPending(null)}>
            Cancel
          </button>
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onInit={(instance) => {
          instanceRef.current = instance as unknown as ReactFlowInstance;
          sync.instances.set(side, instance as unknown as ReactFlowInstance);
        }}
        fitView
        fitViewOptions={FIT_OPTIONS}
        onNodesChange={onNodesChange}
        onNodeDragStart={(_, node) => node.type === "process" && select({ side, kind: "process", id: node.id })}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        onEdgeClick={(_, edge) => select({ side, kind: "flow", from: edge.source, to: edge.target })}
        onPaneClick={() => {
          select(null);
          setPending(null);
        }}
        onMove={onMove}
        nodesConnectable={false}
        edgesFocusable={false}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </>
  );
}

function exitPoint(box: { x: number; y: number }, port: Port): [number, number] {
  if (port === "left") return [box.x, box.y + NODE_HEIGHT / 2];
  if (port === "right") return [box.x + NODE_WIDTH, box.y + NODE_HEIGHT / 2];
  return [box.x + NODE_WIDTH / 2, box.y + NODE_HEIGHT];
}

/**
 * Distance from a point to the elbow-shaped route of a flow: down, across, down from
 * a bottom exit, or across then down from a side exit.
 */
function distanceToFlow(px: number, py: number, sx: number, sy: number, tx: number, ty: number, port: Port): number {
  if (ty <= sy) return distanceToSegment(px, py, sx, sy, tx, ty);
  if (port !== "bottom") {
    return Math.min(distanceToSegment(px, py, sx, sy, tx, sy), distanceToSegment(px, py, tx, sy, tx, ty));
  }
  const my = (sy + ty) / 2;
  return Math.min(
    distanceToSegment(px, py, sx, sy, sx, my),
    distanceToSegment(px, py, sx, my, tx, my),
    distanceToSegment(px, py, tx, my, tx, ty),
  );
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
