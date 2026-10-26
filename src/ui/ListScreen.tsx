import { useState } from "react";
import { idProblem, slugify } from "../core/slug";
import type { Issue } from "../core/validate";
import type { ProcessEntry } from "../io/workspace";
import { useStore } from "../state/store";
import { NoticeBar } from "./App";
import { Dialog } from "./Dialog";

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
              <th>As-Is</th>
              <th>To-Be</th>
              <th>Validation</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No processes yet. Create one with “New process”.
                </td>
              </tr>
            )}
            {entries.map((entry) => (
              <tr key={entry.folder} className="row" onClick={() => void openProcess(entry.folder)}>
                <td>
                  <div className="title">{entry.title}</div>
                  <div className="muted mono">{entry.folder}/</div>
                </td>
                <td>
                  <Presence present={entry.hasAsis} />
                </td>
                <td>
                  <TobeCell entry={entry} />
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <IssueCell
                    entry={entry}
                    expanded={expanded === entry.folder}
                    onToggle={() => setExpanded(expanded === entry.folder ? null : entry.folder)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
      {creating && <NewProcessDialog existing={entries.map((e) => e.folder)} onClose={() => setCreating(false)} />}
    </>
  );
}

function Presence({ present }: { present: boolean }) {
  return <span className={`badge ${present ? "yes" : "no"}`}>{present ? "Yes" : "None"}</span>;
}

function TobeCell({ entry }: { entry: ProcessEntry }) {
  const createTobe = useStore((s) => s.createTobe);
  const notify = useStore((s) => s.notify);
  if (entry.hasTobe || !entry.hasAsis) return <Presence present={entry.hasTobe} />;
  return (
    <button
      className="small"
      onClick={(e) => {
        e.stopPropagation();
        createTobe(entry).catch((err) => notify({ level: "error", text: String(err) }));
      }}
    >
      Create from As-Is
    </button>
  );
}

function IssueCell({ entry, expanded, onToggle }: { entry: ProcessEntry; expanded: boolean; onToggle: () => void }) {
  const all: (Issue & { side: string })[] = [
    ...entry.issues.asis.map((i) => ({ ...i, side: "As-Is" })),
    ...entry.issues.tobe.map((i) => ({ ...i, side: "To-Be" })),
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
  const [folder, setFolder] = useState("");
  const [folderEdited, setFolderEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const effectiveFolder = folderEdited ? folder : slugify(title);
  const problem = idProblem(effectiveFolder, existing);

  const submit = async () => {
    if (problem || !title.trim()) return;
    try {
      await createProcess(effectiveFolder, title.trim());
      onClose();
      await openProcess(effectiveFolder);
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
        <span>Folder (permanent ID)</span>
        <input
          className="mono"
          value={effectiveFolder}
          onChange={(e) => {
            setFolder(e.target.value);
            setFolderEdited(true);
          }}
          placeholder="sales-order"
        />
        {title && problem && <span className="field-error">{problem}</span>}
      </label>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        Creates README.md and asis.yaml. A To-Be flow can be created from the As-Is later.
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
