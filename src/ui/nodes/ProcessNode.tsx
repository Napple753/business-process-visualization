import { Handle, NodeToolbar, Position, type Node, type NodeProps } from "@xyflow/react";
import type { ChangeKind } from "../../core/diff";
import type { Process } from "../../core/model";
import { CHANGE_COLORS, CHANGE_LABELS, CHANGE_PRIORITY } from "../diffStyle";

export type ProcessNodeData = {
  process: Process;
  kinds: ChangeKind[];
  editable: boolean;
  hasPredecessors: boolean;
  hasSuccessors: boolean;
  onAddNext: () => void;
  onAddBefore: () => void;
  onMerge: () => void;
  onDelete: () => void;
};

export type ProcessNodeType = Node<ProcessNodeData, "process">;

export function ProcessNode({ data, selected }: NodeProps<ProcessNodeType>) {
  const { process, kinds } = data;
  const main = CHANGE_PRIORITY.find((k) => kinds.includes(k));
  const classes = [
    "process-node",
    process.type,
    selected && "selected",
    main && "has-diff",
    kinds.includes("removed") && "removed",
  ];
  const meta = [...(process.systems ?? []), ...(process.documents ?? [])].join(", ");

  return (
    <div
      className={classes.filter(Boolean).join(" ")}
      style={main ? ({ "--diff-color": CHANGE_COLORS[main] } as React.CSSProperties) : undefined}
      title={process.description ? `${process.name}\n\n${process.description}` : process.name}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <div className="shape" />
      <span className="label">{process.name}</span>
      {kinds.length > 0 && (
        <div className="chips">
          {CHANGE_PRIORITY.filter((k) => kinds.includes(k)).map((k) => (
            <span key={k} className="chip" style={{ background: CHANGE_COLORS[k] }}>
              {CHANGE_LABELS[k]}
            </span>
          ))}
        </div>
      )}
      {meta && <span className="meta">{meta}</span>}
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
      {data.editable && (
        <NodeToolbar position={Position.Top} offset={16}>
          <div className="node-toolbar" onMouseDown={(e) => e.stopPropagation()}>
            {!data.hasPredecessors && (
              <button className="small" onClick={data.onAddBefore} title="Add a process before this one">
                + Before
              </button>
            )}
            <button
              className="small"
              onClick={data.onAddNext}
              title={data.hasSuccessors ? "Add a parallel branch after this process" : "Add the next process"}
            >
              {data.hasSuccessors ? "+ Branch" : "+ Next"}
            </button>
            <button className="small" onClick={data.onMerge} title="Connect this process to an existing one">
              Merge into…
            </button>
            <button className="small danger" onClick={data.onDelete} title="Delete (Del)">
              Delete
            </button>
          </div>
        </NodeToolbar>
      )}
    </div>
  );
}
