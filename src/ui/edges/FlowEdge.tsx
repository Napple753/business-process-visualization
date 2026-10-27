import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type Edge, type EdgeProps } from "@xyflow/react";
import type { Port } from "../../core/ports";
import { FLOW_COLORS, type FlowStatus } from "../diffStyle";

export type FlowEdgeData = {
  label?: string;
  /** Exit vertex when the flow leaves a decision; its label is then drawn next to that vertex. */
  port: Port | null;
  status: FlowStatus | null;
  editable: boolean;
  dropTarget: boolean;
  onInsert: () => void;
};

export type FlowEdgeType = Edge<FlowEdgeData, "flow">;

// Offsets that put a decision's outcome label beside the vertex it leaves from.
const EXIT_LABEL_OFFSET: Record<Port, string> = {
  bottom: "translate(6px, 4px)",
  right: "translate(6px, calc(-100% - 3px))",
  left: "translate(calc(-100% - 6px), calc(-100% - 3px))",
};

export function FlowEdge(props: EdgeProps<FlowEdgeType>) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected, markerEnd } = props;
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 10,
  });
  const color = data?.status ? FLOW_COLORS[data.status] : undefined;
  const classes = ["edge-label", "nodrag", "nopan", selected && "selected", data?.dropTarget && "drop-target"];

  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={16}
        style={{
          stroke: data?.dropTarget ? "var(--accent)" : color,
          strokeWidth: data?.status || data?.dropTarget ? 2.5 : 1.5,
          strokeDasharray: data?.status === "removed" ? "6 4" : undefined,
        }}
      />
      <EdgeLabelRenderer>
        {data?.label && data.port && (
          <div
            className="edge-label nodrag nopan"
            style={{ transform: `translate(${sourceX}px, ${sourceY}px) ${EXIT_LABEL_OFFSET[data.port]}` }}
          >
            <span className="text" style={color ? { borderColor: color, color } : undefined}>
              {data.label}
            </span>
          </div>
        )}
        <div
          className={classes.filter(Boolean).join(" ")}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          {data?.label && !data.port && (
            <span className="text" style={color ? { borderColor: color, color } : undefined}>
              {data.label}
            </span>
          )}
          {data?.editable && (
            <button
              className="edge-plus"
              title="Insert a process here"
              onClick={(e) => {
                e.stopPropagation();
                data.onInsert();
              }}
            >
              +
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
