import { useEffect, useState } from "react";
import type { ModelDiff } from "../core/diff";
import { NODE_TYPES, type FlowModel, type NodeType, type Process, type Side } from "../core/model";
import {
  addLane,
  disconnect,
  moveLane,
  removeLane,
  removeProcess,
  renameLane,
  updateFlowLabel,
  updateProcess,
} from "../core/mutations";
import { uniqueSlug } from "../core/slug";
import type { Issue } from "../core/validate";
import { useStore, type ViewMode } from "../state/store";
import { CHANGE_COLORS, CHANGE_LABELS, CHANGE_PRIORITY, FLOW_COLORS } from "./diffStyle";

const SIDE_NAMES: Record<Side, string> = { asis: "As-Is", tobe: "To-Be" };

interface Props {
  models: Partial<Record<Side, FlowModel>>;
  diff: ModelDiff | null;
  issues: Partial<Record<Side, Issue[]>>;
  view: ViewMode;
}

export function PropertiesPanel({ models, diff, issues, view }: Props) {
  const selection = useStore((s) => s.selection);
  const activeSide = useStore((s) => s.activeSide);

  let body;
  if (selection?.kind === "process") {
    const model = models[selection.side];
    const process = model?.processes.find((p) => p.id === selection.id);
    body = process && model && (
      <ProcessProperties side={selection.side} model={model} process={process} models={models} diff={diff} />
    );
  } else if (selection?.kind === "flow") {
    const model = models[selection.side];
    const flow = model?.flows.find((f) => f.from === selection.from && f.to === selection.to);
    body = flow && model && <FlowProperties side={selection.side} model={model} from={flow.from} to={flow.to} label={flow.label} />;
  }
  const laneSide: Side = view === "compare" ? activeSide : view;

  return (
    <aside className="side-panel" aria-label="Properties">
      {body ?? (
        <>
          {models[laneSide] && <LaneEditor side={laneSide} model={models[laneSide]!} />}
          <section>
            <h3>How to edit</h3>
            <p className="muted" style={{ margin: 0, fontSize: 12, lineHeight: 1.5 }}>
              Hover a connector and click <b>+</b> to insert a process. Double-click a process to rename it. Select a
              process for branch, merge and delete
              actions. Drag a process onto another connector to move it there, or into another swimlane to change its
              lane. Ctrl/Cmd+S saves, Ctrl/Cmd+Z undoes.
            </p>
          </section>
        </>
      )}
      {diff && <Legend />}
      <IssueSection issues={issues} />
    </aside>
  );
}

function ProcessProperties({
  side,
  model,
  process,
  models,
  diff,
}: {
  side: Side;
  model: FlowModel;
  process: Process;
  models: Partial<Record<Side, FlowModel>>;
  diff: ModelDiff | null;
}) {
  const apply = useStore((s) => s.apply);
  const update = (patch: Partial<Omit<Process, "id">>) => apply(side, (m) => updateProcess(m, process.id, patch));
  const otherSide: Side = side === "asis" ? "tobe" : "asis";
  const other = models[otherSide]?.processes.find((p) => p.id === process.id);
  const kinds = diff?.processes.get(process.id)?.kinds ?? [];

  return (
    <section>
      <h3>Process · {SIDE_NAMES[side]}</h3>
      <label className="field">
        <span>ID</span>
        <input className="mono" value={process.id} readOnly />
      </label>
      <label className="field">
        <span>Name</span>
        <CommitInput value={process.name} onCommit={(name) => name.trim() && update({ name: name.trim() })} />
      </label>
      <label className="field">
        <span>Type</span>
        <select value={process.type} onChange={(e) => update({ type: e.target.value as NodeType })}>
          {NODE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Swimlane</span>
        <select value={process.lane} onChange={(e) => update({ lane: e.target.value })}>
          {model.lanes.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Description</span>
        <CommitInput
          multiline
          value={process.description ?? ""}
          onCommit={(description) => update({ description: description.trim() || undefined })}
        />
      </label>
      <label className="field">
        <span>Systems (comma separated)</span>
        <CommitInput value={(process.systems ?? []).join(", ")} onCommit={(v) => update({ systems: splitList(v) })} />
      </label>
      <label className="field">
        <span>Documents (comma separated)</span>
        <CommitInput
          value={(process.documents ?? []).join(", ")}
          onCommit={(v) => update({ documents: splitList(v) })}
        />
      </label>
      <div className="button-row">
        <button className="danger" onClick={() => apply(side, (m) => removeProcess(m, process.id))}>
          Delete process
        </button>
      </div>
      {diff && (
        <>
          <h3>Comparison</h3>
          {kinds.length === 0 ? (
            <span className="muted">No changes between As-Is and To-Be.</span>
          ) : (
            <div className="legend">
              {CHANGE_PRIORITY.filter((k) => kinds.includes(k)).map((k) => (
                <span key={k} className="chip" style={{ background: CHANGE_COLORS[k] }}>
                  {CHANGE_LABELS[k]}
                </span>
              ))}
            </div>
          )}
          {other && kinds.length > 0 && (
            <CompareTable side={side} mine={process} other={other} models={models} />
          )}
        </>
      )}
    </section>
  );
}

function CompareTable({
  side,
  mine,
  other,
  models,
}: {
  side: Side;
  mine: Process;
  other: Process;
  models: Partial<Record<Side, FlowModel>>;
}) {
  const [asis, tobe] = side === "asis" ? [mine, other] : [other, mine];
  const laneName = (s: Side, id: string) => models[s]?.lanes.find((l) => l.id === id)?.name ?? id;
  const rows: [string, string, string][] = [
    ["Name", asis.name, tobe.name],
    ["Lane", laneName("asis", asis.lane), laneName("tobe", tobe.lane)],
    ["Type", asis.type, tobe.type],
    ["Description", asis.description ?? "", tobe.description ?? ""],
    ["Systems", (asis.systems ?? []).join(", "), (tobe.systems ?? []).join(", ")],
    ["Documents", (asis.documents ?? []).join(", "), (tobe.documents ?? []).join(", ")],
  ];
  return (
    <table className="compare-table">
      <thead>
        <tr>
          <th />
          <th>As-Is</th>
          <th>To-Be</th>
        </tr>
      </thead>
      <tbody>
        {rows
          .filter(([, a, b]) => a !== b)
          .map(([label, a, b]) => (
            <tr key={label}>
              <th>{label}</th>
              <td>{a || "—"}</td>
              <td>{b || "—"}</td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}

function FlowProperties({
  side,
  model,
  from,
  to,
  label,
}: {
  side: Side;
  model: FlowModel;
  from: string;
  to: string;
  label?: string;
}) {
  const apply = useStore((s) => s.apply);
  const name = (id: string) => model.processes.find((p) => p.id === id)?.name ?? id;
  return (
    <section>
      <h3>Connector · {SIDE_NAMES[side]}</h3>
      <div>
        {name(from)} → {name(to)}
      </div>
      <label className="field">
        <span>Label (e.g. a decision outcome)</span>
        <CommitInput value={label ?? ""} onCommit={(v) => apply(side, (m) => updateFlowLabel(m, from, to, v.trim()))} />
      </label>
      <div className="button-row">
        <button className="danger" onClick={() => apply(side, (m) => disconnect(m, from, to))}>
          Remove connector
        </button>
      </div>
    </section>
  );
}

function LaneEditor({ side, model }: { side: Side; model: FlowModel }) {
  const apply = useStore((s) => s.apply);
  const [newLane, setNewLane] = useState("");
  const add = () => {
    const name = newLane.trim();
    if (!name) return;
    const id = uniqueSlug(name, model.lanes.map((l) => l.id), "lane");
    apply(side, (m) => addLane(m, { id, name }));
    setNewLane("");
  };
  return (
    <section>
      <h3>Swimlanes · {SIDE_NAMES[side]}</h3>
      {model.lanes.map((lane, i) => (
        <div key={lane.id} className="lane-row">
          <CommitInput
            value={lane.name}
            onCommit={(name) => name.trim() && apply(side, (m) => renameLane(m, lane.id, name.trim()))}
            title={lane.id}
          />
          <button className="small" disabled={i === 0} onClick={() => apply(side, (m) => moveLane(m, lane.id, -1))} title="Move left">
            ←
          </button>
          <button
            className="small"
            disabled={i === model.lanes.length - 1}
            onClick={() => apply(side, (m) => moveLane(m, lane.id, 1))}
            title="Move right"
          >
            →
          </button>
          <button className="small danger" onClick={() => apply(side, (m) => removeLane(m, lane.id))} title="Delete">
            ×
          </button>
        </div>
      ))}
      <form
        className="lane-row"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input value={newLane} onChange={(e) => setNewLane(e.target.value)} placeholder="New swimlane" />
        <button className="small" type="submit" disabled={!newLane.trim()}>
          Add
        </button>
      </form>
    </section>
  );
}

function Legend() {
  return (
    <section>
      <h3>Legend</h3>
      <div className="legend">
        {CHANGE_PRIORITY.map((k) => (
          <span key={k} className="chip" style={{ background: CHANGE_COLORS[k] }}>
            {CHANGE_LABELS[k]}
          </span>
        ))}
        <span className="chip" style={{ background: FLOW_COLORS.added }}>
          New connector
        </span>
        <span className="chip" style={{ background: FLOW_COLORS.removed }}>
          Removed connector
        </span>
      </div>
    </section>
  );
}

function IssueSection({ issues }: { issues: Partial<Record<Side, Issue[]>> }) {
  const select = useStore((s) => s.select);
  const all = (["asis", "tobe"] as const).flatMap((side) => (issues[side] ?? []).map((i) => ({ ...i, side })));
  return (
    <section>
      <h3>Validation</h3>
      {all.length === 0 ? (
        <span className="muted">No issues.</span>
      ) : (
        <ul className="issue-list">
          {all.map((issue, i) => (
            <li key={i} className={issue.severity}>
              {issue.target ? (
                <a href="#" onClick={(e) => (e.preventDefault(), select({ side: issue.side, kind: "process", id: issue.target! }))}>
                  {SIDE_NAMES[issue.side]}: {issue.message}
                </a>
              ) : (
                `${SIDE_NAMES[issue.side]}: ${issue.message}`
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Text input that reports its value on blur or Enter, so typing does not create one undo step per key. */
function CommitInput({
  value,
  onCommit,
  multiline,
  title,
}: {
  value: string;
  onCommit: (value: string) => void;
  multiline?: boolean;
  title?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  const props = {
    value: draft,
    title,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        commit();
      }
      if (e.key === "Escape") setDraft(value);
    },
  };
  return multiline ? <textarea {...props} /> : <input {...props} />;
}

function splitList(value: string): string[] | undefined {
  const items = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}
