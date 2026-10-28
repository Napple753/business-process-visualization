import { useState } from "react";
import { idProblem, slugify } from "../core/slug";
import type { Issue } from "../core/validate";
import type { ProcessEntry } from "../io/workspace";
import { useStore } from "../state/store";
import { NoticeBar } from "./App";
import { Dialog } from "./Dialog";
import { sideName } from "./sideName";

export function ListScreen() {
  const root = useStore((s) => s.root);
  const entries = useStore((s) => s.entries);
  const { openFolder, closeFolder, refreshEntries, openProcess } = useStore.getState();
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <>
      <header className="topbar">
        <h1>Process Workbench</h1>
        <span className="muted mono" title={root ?? ""}>
          {root}
        </span>
        <span className="spacer" />
        <button onClick={() => void refreshEntries()}>Reload</button>
        <button onClick={() => void openFolder()}>Open folder…</button>
        <button onClick={() => void closeFolder()}>Close</button>
        <button className="primary" onClick={() => setCreating(true)}>
          New process
        </button>
      </header>
      <NoticeBar />
      <main className="list-screen">
        <table className="process-table">
          <thead>
            <tr>
              <th>Process</th>
              <th>Flows</th>
              <th>Validation</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={3} className="muted">
                  No processes yet. Create one with “New process”.
                </td>
              </tr>
            )}
            {entries.map((entry) => (
              <tr key={entry.id} className="row" onClick={() => void openProcess(entry.id)}>
                <td>
                  <div className="title">{entry.title}</div>
                  <div className="muted mono">{entry.id}</div>
                </td>
                <td>
                  <FlowsCell entry={entry} />
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <IssueCell
                    entry={entry}
                    expanded={expanded === entry.id}
                    onToggle={() => setExpanded(expanded === entry.id ? null : entry.id)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
      {creating && <NewProcessDialog existing={entries.map((e) => e.id)} onClose={() => setCreating(false)} />}
    </>
  );
}

function FlowsCell({ entry }: { entry: ProcessEntry }) {
  const createTobe = useStore((s) => s.createTobe);
  const notify = useStore((s) => s.notify);
  return (
    <div className="flows-cell">
      {entry.hasAsis && <span className="badge yes">{sideName("asis", entry.hasTobe)}</span>}
      {entry.hasTobe && <span className="badge yes">To-Be</span>}
      {entry.hasAsis && !entry.hasTobe && (
        <button
          className="small"
          onClick={(e) => {
            e.stopPropagation();
            createTobe(entry).catch((err) => notify({ level: "error", text: String(err) }));
          }}
        >
          Create To-Be
        </button>
      )}
    </div>
  );
}

function IssueCell({ entry, expanded, onToggle }: { entry: ProcessEntry; expanded: boolean; onToggle: () => void }) {
  const all: (Issue & { side: string })[] = [
    ...entry.issues.asis.map((i) => ({ ...i, side: sideName("asis", entry.hasTobe) })),
    ...entry.issues.tobe.map((i) => ({ ...i, side: sideName("tobe", entry.hasTobe) })),
  ];
  const errors = all.filter((i) => i.severity === "error").length;
  const warnings = all.length - errors;
  if (all.length === 0) return <span className="badge yes">OK</span>;
  return (
    <div>
      <button className="small issue-summary" onClick={onToggle} aria-expanded={expanded}>
        {errors > 0 && <span className="errors">{errors} error{errors > 1 ? "s" : ""}</span>}
        {warnings > 0 && <span className="warnings">{warnings} warning{warnings > 1 ? "s" : ""}</span>}
      </button>
      {expanded && (
        <ul className="issue-list">
          {all.map((issue, i) => (
            <li key={i} className={issue.severity}>
              {issue.side}: {issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewProcessDialog({ existing, onClose }: { existing: string[]; onClose: () => void }) {
  const createProcess = useStore((s) => s.createProcess);
  const openProcess = useStore((s) => s.openProcess);
  const [title, setTitle] = useState("");
  const [name, setName] = useState("");
  const [nameEdited, setNameEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const effectiveName = nameEdited ? name : slugify(title);
  const problem = idProblem(effectiveName, existing);

  const submit = async () => {
    if (problem || !title.trim()) return;
    try {
      await createProcess(effectiveName, title.trim());
      onClose();
      await openProcess(effectiveName);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <Dialog title="New process" onClose={onClose} onSubmit={() => void submit()}>
      <label className="field">
        <span>Title</span>
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sales Order" />
      </label>
      <label className="field">
        <span>File name (permanent ID)</span>
        <input
          className="mono"
          value={effectiveName}
          onChange={(e) => {
            setName(e.target.value);
            setNameEdited(true);
          }}
          placeholder="sales-order"
        />
        {title && problem && <span className="field-error">{problem}</span>}
      </label>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        Creates {effectiveName || "name"}.yaml and {effectiveName || "name"}.md. A To-Be can be created from the flow later.
      </p>
      {error && <span className="field-error">{error}</span>}
      <div className="actions">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={!!problem || !title.trim()}>
          Create
        </button>
      </div>
    </Dialog>
  );
}
