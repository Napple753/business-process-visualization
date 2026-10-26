import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type Edge, type EdgeProps } from "@xyflow/react";
import { FLOW_COLORS, type FlowStatus } from "../diffStyle";

export type FlowEdgeData = {
  label?: string;
  status: FlowStatus | null;
  editable: boolean;
  dropTarget: boolean;
  onInsert: () => void;
};

export type FlowEdgeType = Edge<FlowEdgeData, "flow">;

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
        <div
          className={classes.filter(Boolean).join(" ")}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          {data?.label && (
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
