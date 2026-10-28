import { useViewport } from "@xyflow/react";
import { LANE_HEADER_HEIGHT, type LaneColumn } from "../core/layout";

export interface LaneHeader extends LaneColumn {
  name: string;
  /** Lane exists only on the other side. */
  ghost: boolean;
}

/**
 * Lane titles drawn over the canvas. They follow the viewport horizontally and with
 * zoom, but stick to the top of the pane once the lanes scroll up past it.
 */
export function LaneHeaders({ lanes }: { lanes: LaneHeader[] }) {
  const { x, y, zoom } = useViewport();
  return (
    <div
      className="lane-headers"
      style={{ transform: `translate(${x}px, ${Math.max(y, 0)}px) scale(${zoom})` }}
      aria-hidden="true"
    >
      {lanes.map((lane) => (
        <div
          key={lane.id}
          className={lane.ghost ? "lane-title ghost" : "lane-title"}
          style={{ left: lane.x, width: lane.width, height: LANE_HEADER_HEIGHT }}
        >
          {lane.name}
        </div>
      ))}
    </div>
  );
}
