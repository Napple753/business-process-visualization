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
import { heightOf, LANE_HEADER_HEIGHT, NODE_HEIGHT, NODE_WIDTH, positionOf, type Layout } from "../core/layout";
import { flowKey, type FlowModel, type Lane, type Side } from "../core/model";
import { connect, moveProcess, removeProcess, updateProcess } from "../core/mutations";
import { assignDecisionPorts, type Port } from "../core/ports";
import { useStore } from "../state/store";
import type { FlowStatus } from "./diffStyle";
import { FlowEdge, type FlowEdgeType } from "./edges/FlowEdge";
import { LaneHeaders, type LaneHeader } from "./LaneHeaders";
import { LaneNode, type LaneNodeType } from "./nodes/LaneNode";
import { ProcessNode, type ProcessNodeType } from "./nodes/ProcessNode";

const nodeTypes = { lane: LaneNode, process: ProcessNode };
const edgeTypes = { flow: FlowEdge };
const DROP_DISTANCE = 32;
const FIT_OPTIONS = { padding: 0.06, maxZoom: 1 };
const REVEAL_MARGIN = 24;
/** How far past the swimlanes the viewport may scroll, in flow units. */
const EXTENT_MARGIN = 48;

/** Shared between the panes of one process screen. */
export interface ViewportSync {
  instances: Map<Side, ReactFlowInstance>;
  /** Viewport to start from when panes are recreated (view switch); null fits the content. */
  viewport: Viewport | null;
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
  const [editingId, setEditingId] = useState<string | null>(null);

  const instanceRef = useRef<ReactFlowInstance | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fittedWidth = useRef(layout.width);
  const startViewport = useRef(sync.viewport).current;

  useEffect(
    () => () => {
      if (sync.instances.get(side) === instanceRef.current) sync.instances.delete(side);
    },
    [sync, side],
  );

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

  const laneHeight = layout.height + NODE_HEIGHT;
  const headers = useMemo((): LaneHeader[] => {
    const laneNames = new Map([...otherLanes, ...model.lanes].map((l) => [l.id, l.name]));
    return layout.lanes.map((col) => ({ ...col, name: laneNames.get(col.id) ?? col.id, ghost: !laneIds.has(col.id) }));
  }, [layout, model, otherLanes, laneIds]);
  const translateExtent = useMemo(
    (): [[number, number], [number, number]] => [
      [-EXTENT_MARGIN, -EXTENT_MARGIN],
      [layout.width + EXTENT_MARGIN, laneHeight + EXTENT_MARGIN],
    ],
    [layout.width, laneHeight],
  );

  const nodes = useMemo(() => {
    const lanes: LaneNodeType[] = layout.lanes.map((col, i) => ({
      id: `lane:${col.id}`,
      type: "lane",
      position: { x: col.x, y: 0 },
      data: {
        width: col.width,
        height: laneHeight,
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
            height: heightOf(layout, p.id),
            kinds: kindsFor(p.id),
            editable: true,
            hasPredecessors: (graph.pred.get(p.id)?.length ?? 0) > 0,
            hasSuccessors: (graph.succ.get(p.id)?.length ?? 0) > 0,
            onAddNext: () => requestAdd({ side, placement: { kind: "after", from: p.id }, lane: p.lane }),
            onAddBefore: () => requestAdd({ side, placement: { kind: "before", to: p.id }, lane: p.lane }),
            onMerge: () => setPending({ kind: "merge", side, from: p.id }),
            onDelete: () => remove(p.id),
            editing: editingId === p.id,
            onRenameDone: (name: string | null) => {
              setEditingId(null);
              if (name !== null && name !== p.name) apply(side, (m) => updateProcess(m, p.id, { name }));
            },
          },
        },
      ];
    });
    return [...lanes, ...processes];
  }, [layout, laneHeight, model, laneIds, diff, side, drag, dropTarget, selection, graph, requestAdd, setPending, remove, apply, editingId]);

  const ports = useMemo(
    () =>
      assignDecisionPorts(model, (id) => {
        const p = model.processes.find((q) => q.id === id);
        const pos = p && positionOf(layout, p.lane, p.id);
        return pos && { x: pos.x + NODE_WIDTH / 2, y: pos.y + heightOf(layout, id) / 2 };
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
    const cy = y + heightOf(layout, id) / 2;
    let best: DropTarget = null;
    let bestDistance = DROP_DISTANCE;
    for (const f of model.flows) {
      if (f.from === id || f.to === id) continue;
      const a = processPosition(f.from);
      const b = processPosition(f.to);
      if (!a || !b) continue;
      const port = ports.get(flowKey(f)) ?? "bottom";
      const [sx, sy] = exitPoint(a, heightOf(layout, f.from), port);
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

  const onInit = (instance: ReactFlowInstance) => {
    instanceRef.current = instance;
    sync.instances.set(side, instance);
    if (!sync.viewport) return;
    // A pane created by a view switch continues from the previous viewport. Another
    // pane may already have adjusted it to reveal the selection, so read it again.
    void instance.setViewport(sync.viewport);
    const revealed = revealSelection(sync.viewport);
    if (revealed) {
      sync.viewport = revealed;
      for (const other of sync.instances.values()) void other.setViewport(revealed, { duration: 150 });
    }
  };

  /** Viewport scrolled just enough to show the selected process, or null when it is already visible. */
  const revealSelection = (viewport: Viewport): Viewport | null => {
    const sel = useStore.getState().selection;
    const el = containerRef.current;
    if (sel?.side !== side || sel.kind !== "process" || !el) return null;
    const pos = processPosition(sel.id);
    if (!pos) return null;
    const { x, y, zoom } = viewport;
    const shift = (start: number, end: number, size: number) => {
      if (end > size - REVEAL_MARGIN) return Math.max(size - REVEAL_MARGIN - end, REVEAL_MARGIN - start);
      if (start < REVEAL_MARGIN) return REVEAL_MARGIN - start;
      return 0;
    };
    const dx = shift(pos.x * zoom + x, (pos.x + NODE_WIDTH) * zoom + x, el.clientWidth);
    // Keep the box clear of the sticky lane headers.
    const top = LANE_HEADER_HEIGHT * zoom;
    const dy = shift(pos.y * zoom + y - top, (pos.y + heightOf(layout, sel.id)) * zoom + y - top, el.clientHeight - top);
    return dx || dy ? { x: x + dx, y: y + dy, zoom } : null;
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
        ref={containerRef}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onInit={(instance) => onInit(instance as unknown as ReactFlowInstance)}
        defaultViewport={startViewport ?? undefined}
        fitView={!startViewport}
        fitViewOptions={FIT_OPTIONS}
        onNodesChange={onNodesChange}
        onNodeDragStart={(_, node) => node.type === "process" && select({ side, kind: "process", id: node.id })}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={(_, node) => node.type === "process" && setEditingId(node.id)}
        onEdgeClick={(_, edge) => select({ side, kind: "flow", from: edge.source, to: edge.target })}
        onPaneClick={() => {
          setEditingId(null);
          select(null);
          setPending(null);
        }}
        onMove={onMove}
        // The wheel scrolls; Ctrl/Cmd + wheel (or a pinch) zooms. Double click renames a process.
        panOnScroll
        panOnScrollSpeed={1}
        zoomActivationKeyCode={["Meta", "Control"]}
        zoomOnDoubleClick={false}
        translateExtent={translateExtent}
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
        <LaneHeaders lanes={headers} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </>
  );
}

function exitPoint(box: { x: number; y: number }, height: number, port: Port): [number, number] {
  if (port === "left") return [box.x, box.y + height / 2];
  if (port === "right") return [box.x + NODE_WIDTH, box.y + height / 2];
  return [box.x + NODE_WIDTH / 2, box.y + height];
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
