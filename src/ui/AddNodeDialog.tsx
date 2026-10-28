import { useState } from "react";
import { NODE_TYPES, type FlowModel, type NodeType, type Process } from "../core/model";
import { addLane, addPredecessor, addProcess, addSuccessor, insertBetween } from "../core/mutations";
import { idProblem, slugify, uniqueSlug } from "../core/slug";
import { useStore, type AddRequest } from "../state/store";
import { Dialog } from "./Dialog";
import { useSideName } from "./sideName";

export function AddNodeDialog({
  request,
  model,
  otherModel,
}: {
  request: AddRequest;
  model: FlowModel;
  otherModel: FlowModel | null;
}) {
  const { apply, requestAdd, select } = useStore.getState();
  const sideName = useSideName();
  const taken = model.processes.map((p) => p.id);
  // Processes of the other side that are missing here can be reused with the same id,
  // which keeps them aligned and matched in the comparison.
  const reusable = (otherModel?.processes ?? []).filter((p) => !taken.includes(p.id));

  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [idEdited, setIdEdited] = useState(false);
  const [type, setType] = useState<NodeType>("task");
  const [lane, setLane] = useState(request.lane ?? model.lanes[0]?.id ?? "");
  const [newLaneName, setNewLaneName] = useState("");

  const effectiveId = idEdited ? id : name ? uniqueSlug(name, taken) : "";
  const problem = name.trim() ? idProblem(effectiveId, taken) : null;
  const needsLane = model.lanes.length === 0;
  const valid = name.trim() && !problem && (needsLane ? newLaneName.trim() : lane);

  const reuse = (processId: string) => {
    const p = reusable.find((q) => q.id === processId);
    if (!p) return;
    setName(p.name);
    setId(p.id);
    setIdEdited(true);
    setType(p.type);
    if (model.lanes.some((l) => l.id === p.lane)) setLane(p.lane);
  };

  const submit = () => {
    if (!valid) return;
    const laneId = needsLane ? slugify(newLaneName) || "lane" : lane;
    const process: Process = { id: effectiveId, name: name.trim(), lane: laneId, type };
    apply(request.side, (m) => {
      const base = needsLane ? addLane(m, { id: laneId, name: newLaneName.trim() }) : m;
      const placement = request.placement;
      switch (placement.kind) {
        case "between":
          return insertBetween(base, placement.from, placement.to, process);
        case "after":
          return addSuccessor(base, placement.from, process);
        case "before":
          return addPredecessor(base, placement.to, process);
        case "first":
          return addProcess(base, process);
      }
    });
    requestAdd(null);
    select({ side: request.side, kind: "process", id: process.id });
  };

  return (
    <Dialog title={`Add process to ${sideName(request.side)}`} onClose={() => requestAdd(null)} onSubmit={submit}>
      {reusable.length > 0 && (
        <label className="field">
          <span>Reuse from {sideName(request.side === "asis" ? "tobe" : "asis")} (keeps the same ID)</span>
          <select value="" onChange={(e) => reuse(e.target.value)}>
            <option value="">— New process —</option>
            {reusable.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.id})
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        <span>Name</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Check stock" />
      </label>
      <label className="field">
        <span>ID (permanent, cannot be changed later)</span>
        <input
          className="mono"
          value={effectiveId}
          onChange={(e) => {
            setId(e.target.value);
            setIdEdited(true);
          }}
          placeholder="check-stock"
        />
        {problem && <span className="field-error">{problem}</span>}
      </label>
      <div className="row">
        <label className="field">
          <span>Type</span>
          <select value={type} onChange={(e) => setType(e.target.value as NodeType)}>
            {NODE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        {needsLane ? (
          <label className="field">
            <span>New swimlane</span>
            <input value={newLaneName} onChange={(e) => setNewLaneName(e.target.value)} placeholder="Sales" />
          </label>
        ) : (
          <label className="field">
            <span>Swimlane</span>
            <select value={lane} onChange={(e) => setLane(e.target.value)}>
              {model.lanes.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="actions">
        <button type="button" onClick={() => requestAdd(null)}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={!valid}>
          Add
        </button>
      </div>
    </Dialog>
  );
}
