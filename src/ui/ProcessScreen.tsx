import { ReactFlowProvider } from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { diffModels } from "../core/diff";
import { layoutModels, type Layout } from "../core/layout";
import type { FlowModel, Side } from "../core/model";
import { disconnect, removeProcess } from "../core/mutations";
import { validateModel } from "../core/validate";
import { useStore, type SideState, type ViewMode } from "../state/store";
import { AddNodeDialog } from "./AddNodeDialog";
import { NoticeBar } from "./App";
import { FlowCanvas, type ViewportSync } from "./FlowCanvas";
import { PropertiesPanel } from "./PropertiesPanel";

const SIDE_NAMES: Record<Side, string> = { asis: "As-Is", tobe: "To-Be" };

export function ProcessScreen() {
  const current = useStore((s) => s.current)!;
  const view = useStore((s) => s.view);
  const addRequest = useStore((s) => s.addRequest);
  const fs = useStore((s) => s.fs)!;
  const { closeProcess, setView, save, undo, redo, createTobe, notify } = useStore.getState();
  const { asis, tobe } = current.sides;

  const models = useMemo(() => {
    const m: Partial<Record<Side, FlowModel>> = {};
    if (asis?.model) m.asis = asis.model;
    if (tobe?.model) m.tobe = tobe.model;
    return m;
  }, [asis?.model, tobe?.model]);

  const diff = useMemo(
    () => (models.asis && models.tobe ? diffModels(models.asis, models.tobe) : null),
    [models],
  );
  const issues = useMemo(() => {
    const result: Partial<Record<Side, ReturnType<typeof validateModel>>> = {};
    for (const side of ["asis", "tobe"] as const) {
      const m = models[side];
      if (m) result[side] = validateModel(m);
    }
    return result;
  }, [models]);

  // Both sides share one layout so that the same process sits at the same height.
  const [layout, setLayout] = useState<Layout | null>(null);
  useEffect(() => {
    let cancelled = false;
    const list = [models.asis, models.tobe].filter((m): m is FlowModel => !!m);
    layoutModels(list)
      .then((l) => !cancelled && setLayout(l))
      .catch((e) => notify({ level: "error", text: `Layout failed: ${String(e)}` }));
    return () => {
      cancelled = true;
    };
  }, [models, notify]);

  const sync = useRef<ViewportSync>({ instances: new Map() }).current;
  useKeyboardShortcuts();

  const dirty = !!(asis?.dirty || tobe?.dirty);
  const back = async () => {
    if (dirty && !(await fs.confirm("Discard unsaved changes?"))) return;
    closeProcess();
  };

  const visibleSides: Side[] = view === "compare" ? ["asis", "tobe"] : [view];
  const canUndo = visibleSides.some((s) => (current.sides[s]?.past.length ?? 0) > 0);
  const canRedo = visibleSides.some((s) => (current.sides[s]?.future.length ?? 0) > 0);

  return (
    <>
      <header className="topbar">
        <button onClick={() => void back()} title="Back to the process list">
          ← Processes
        </button>
        <h1>{current.entry.title}</h1>
        <span className="muted mono">{current.entry.folder}/</span>
        <span className="spacer" />
        <ViewToggle view={view} hasAsis={!!asis} hasTobe={!!tobe} onChange={setView} />
        {!tobe && asis && (
          <button onClick={() => createTobe(current.entry).catch((e) => notify({ level: "error", text: String(e) }))}>
            Create To-Be from As-Is
          </button>
        )}
        <button onClick={() => undo()} disabled={!canUndo} title="Undo (Ctrl/Cmd+Z)">
          Undo
        </button>
        <button onClick={() => redo()} disabled={!canRedo} title="Redo (Ctrl/Cmd+Shift+Z)">
          Redo
        </button>
        <button className="primary" onClick={() => void save()} disabled={!dirty} title="Save (Ctrl/Cmd+S)">
          Save
        </button>
      </header>
      <NoticeBar />
      <div className="process-screen">
        <div className="panes">
          {visibleSides.map((side) => {
            const state = current.sides[side];
            const other = current.sides[side === "asis" ? "tobe" : "asis"];
            return (
              // Keyed by view so that each canvas fits its content again after switching.
              <section key={`${view}-${side}`} className="pane" aria-label={SIDE_NAMES[side]}>
                <PaneHeader side={side} state={state} />
                <div className="pane-body">
                  <PaneBody
                    side={side}
                    state={state}
                    layout={layout}
                    diff={view === "compare" ? diff : null}
                    otherModel={other?.model ?? null}
                    sync={sync}
                  />
                </div>
              </section>
            );
          })}
        </div>
        <PropertiesPanel models={models} diff={diff} issues={issues} view={view} />
      </div>
      {addRequest && models[addRequest.side] && (
        <AddNodeDialog
          request={addRequest}
          model={models[addRequest.side]!}
          otherModel={models[addRequest.side === "asis" ? "tobe" : "asis"] ?? null}
        />
      )}
    </>
  );
}

function ViewToggle({
  view,
  hasAsis,
  hasTobe,
  onChange,
}: {
  view: ViewMode;
  hasAsis: boolean;
  hasTobe: boolean;
  onChange: (view: ViewMode) => void;
}) {
  const options: { value: ViewMode; label: string; enabled: boolean }[] = [
    { value: "compare", label: "Compare", enabled: hasAsis && hasTobe },
    { value: "asis", label: "As-Is", enabled: hasAsis },
    { value: "tobe", label: "To-Be", enabled: hasTobe },
  ];
  return (
    <div className="segmented" role="group" aria-label="View">
      {options.map((o) => (
        <button
          key={o.value}
          className={view === o.value ? "active" : undefined}
          disabled={!o.enabled}
          aria-pressed={view === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function PaneHeader({ side, state }: { side: Side; state: SideState | undefined }) {
  return (
    <div className="pane-header">
      <span>{SIDE_NAMES[side]}</span>
      {state?.dirty && <span className="dirty">● Unsaved</span>}
    </div>
  );
}

function PaneBody({
  side,
  state,
  layout,
  diff,
  otherModel,
  sync,
}: {
  side: Side;
  state: SideState | undefined;
  layout: Layout | null;
  diff: ReturnType<typeof diffModels> | null;
  otherModel: FlowModel | null;
  sync: ViewportSync;
}) {
  const { reloadSide, keepMine, requestAdd } = useStore.getState();
  if (!state) return <div className="pane-message muted">This process has no {SIDE_NAMES[side]} flow.</div>;
  if (!state.model) {
    return (
      <div className="pane-message">
        <strong>{SIDE_NAMES[side]} could not be read. Fix the file and it will reload automatically.</strong>
        <ul className="issue-list">
          {state.errors.map((e, i) => (
            <li key={i} className="error">
              {e}
            </li>
          ))}
        </ul>
        <button onClick={() => void reloadSide(side)}>Reload</button>
      </div>
    );
  }
  return (
    <>
      {state.conflict && (
        <div className="notice warning" role="alert">
          <span>The file changed on disk while you were editing.</span>
          <span className="spacer" />
          <button className="small" onClick={() => void reloadSide(side)}>
            Reload from disk
          </button>
          <button className="small" onClick={() => keepMine(side)}>
            Keep my changes
          </button>
        </div>
      )}
      {state.model.processes.length === 0 && (
        <div className="canvas-banner">
          <span>This flow is empty.</span>
          <button className="small primary" onClick={() => requestAdd({ side, placement: { kind: "first" } })}>
            Add first process
          </button>
        </div>
      )}
      {layout && (
        <ReactFlowProvider>
          <FlowCanvas
            side={side}
            model={state.model}
            otherLanes={otherModel?.lanes ?? []}
            layout={layout}
            diff={diff}
            sync={sync}
          />
        </ReactFlowProvider>
      )}
    </>
  );
}

function useKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      if (s.addRequest) return;
      const mod = e.metaKey || e.ctrlKey;
      const inField = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur?.();
        void s.save();
        return;
      }
      if (inField) return;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        s.redo();
      } else if (e.key === "Escape") {
        s.setPending(null);
        s.select(null);
      } else if ((e.key === "Delete" || e.key === "Backspace") && s.selection) {
        e.preventDefault();
        const sel = s.selection;
        if (sel.kind === "process") s.apply(sel.side, (m) => removeProcess(m, sel.id));
        else s.apply(sel.side, (m) => disconnect(m, sel.from, sel.to));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
