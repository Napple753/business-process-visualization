import type { Node, NodeProps } from "@xyflow/react";

export type LaneNodeData = {
  width: number;
  height: number;
  alt: boolean;
  /** Lane exists only on the other side; drawn faintly to keep columns aligned. */
  ghost: boolean;
  dropTarget: boolean;
};

export type LaneNodeType = Node<LaneNodeData, "lane">;

/** Lane background; its title is drawn by LaneHeaders so that it can stay in view. */
export function LaneNode({ data }: NodeProps<LaneNodeType>) {
  const classes = ["lane-node", data.alt && "alt", data.ghost && "ghost", data.dropTarget && "drop-target"];
  return <div className={classes.filter(Boolean).join(" ")} style={{ width: data.width, height: data.height }} />;
}
