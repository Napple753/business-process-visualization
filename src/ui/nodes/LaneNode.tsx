import type { Node, NodeProps } from "@xyflow/react";

export type LaneNodeData = {
  name: string;
  width: number;
  height: number;
  alt: boolean;
  /** Lane exists only on the other side; drawn faintly to keep columns aligned. */
  ghost: boolean;
  dropTarget: boolean;
};

export type LaneNodeType = Node<LaneNodeData, "lane">;

export function LaneNode({ data }: NodeProps<LaneNodeType>) {
  const classes = ["lane-node", data.alt && "alt", data.ghost && "ghost", data.dropTarget && "drop-target"];
  return (
    <div className={classes.filter(Boolean).join(" ")} style={{ width: data.width, height: data.height }}>
      <div className="lane-title">{data.name}</div>
    </div>
  );
}
