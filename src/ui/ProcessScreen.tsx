import { ReactFlowProvider } from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { diffModels } from "../core/diff";
import { layoutModels, type Layout } from "../core/layout";
import type { FlowModel, Side } from "../core/model";
import { disconnect, removeProcess } from "../core/mutations";
import { validateModel } from "../core/validate";
import { baseName } from "../io/fs";
import { useStore, type SideState, type ViewMode } from "../state/store";
import { AddNodeDialog } from "./AddNodeDialog";
import { NoticeBar } from "./App";
import { FlowCanvas, pushViewport, sameViewport, type ViewportSync } from "./FlowCanvas";
import { PropertiesPanel } from "./PropertiesPanel";
import { measureProcessHeight } from "./measure";
import { useSideName } from "./sideName";

export function ProcessScreen() {
  const current = useStore((s) => s.current)!;
  const view = useStore((s) => s.view);
  const addRequest = useStore((s) => s.addRequest);
  const fs = useStore((s) => s.fs)!;
  const { closeProcess, setView, save, undo, redo, createTobe, adoptTobe, discardTobe, notify } = useStore.getState();
  const { asis, tobe } = current.sides;
  const sideName = useSideName();
  const report = (e: unknown) => notify({ level: "error", text: String(e) });

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
    layoutModels(list, measureProcessHeight)
      .then((l) => !cancelled && setLayout(l))
      .catch((e) => notify({ level: "error", text: `Layout failed: ${String(e)}` }));
    return () => {
      cancelled = true;
    };
  }, [models, notify]);

  const sync = useRef<ViewportSync>({
    instances: new Map(),
    viewport: null,
    started: new Map(),
    linked: true,
    applying: false,
    lastMoved: null,
  }).current;
  const [linked, setLinked] = useState(sync.linked);
  const toggleLinked = () => {
    sync.linked = !sync.linked;
    setLinked(sync.linked);
    if (!sync.linked) return;
    // Re-linking aligns the other pane with the one moved last.
    const from = sync.lastMoved && sync.instances.has(sync.lastMoved) ? sync.lastMoved : [...sync.instances.keys()][0];
    const source = from && sync.instances.get(from);
    if (source) pushViewport(sync, from, source.getViewport());
  };
  const switchView = (next: ViewMode) => {
    // Panes are recreated for the new view and continue from the viewport they were
    // last moved to; when untouched, from the one the current panes started with.
    const from = sync.lastMoved && sync.instances.has(sync.lastMoved) ? sync.lastMoved : [...sync.instances.keys()][0];
    const current = from && sync.instances.get(from)?.getViewport();
    const started = from && sync.started.get(from);
    if (current && !(started && sameViewport(current, started))) sync.viewport = current;
    setView(next);
  };
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
        <span className="muted mono">{current.entry.id}</span>
        <span className="spacer" />
        {asis && tobe && <ViewToggle view={view} onChange={switchView} />}
        {view === "compare" && (
          <button
            className={linked ? "toggle active" : "toggle"}
            aria-pressed={linked}
            onClick={toggleLinked}
            title="Scroll and zoom both sides together"
          >
            Link views
          </button>
        )}
        {!tobe && asis && (
          <button onClick={() => createTobe(current.entry).catch(report)} title="Copy this flow to plan changes">
            Create To-Be
          </button>
        )}
        {tobe && (
          <>
            <button
              onClick={() => adoptTobe().catch(report)}
              title={`Replace ${baseName(current.entry.paths.asis)} with the To-Be`}
            >
              Adopt To-Be
            </button>
            <button onClick={() => discardTobe().catch(report)} title="Delete the To-Be">
              Discard To-Be
            </button>
          </>
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
              // Keyed by view: panes are recreated on a switch and start from sync.viewport.
              <section key={`${view}-${side}`} className="pane" aria-label={sideName(side)}>
                <PaneHeader name={sideName(side)} state={state} />
                <div className="pane-body">
                  <PaneBody
                    side={side}
                    name={sideName(side)}
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

function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (view: ViewMode) => void }) {
  const options: { value: ViewMode; label: string }[] = [
    { value: "compare", label: "Compare" },
    { value: "asis", label: "As-Is" },
    { value: "tobe", label: "To-Be" },
  ];
  return (
    <div className="segmented" role="group" aria-label="View">
      {options.map((o) => (
        <button
          key={o.value}
          className={view === o.value ? "active" : undefined}
          aria-pressed={view === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function PaneHeader({ name, state }: { name: string; state: SideState | undefined }) {
  return (
    <div className="pane-header">
      <span>{name}</span>
      {state && <span className="muted mono">{baseName(state.path)}</span>}
      {state?.dirty && <span className="dirty">● Unsaved</span>}
    </div>
  );
}

function PaneBody({
  side,
  name,
  state,
  layout,
  diff,
  otherModel,
  sync,
}: {
  side: Side;
  name: string;
  state: SideState | undefined;
  layout: Layout | null;
  diff: ReturnType<typeof diffModels> | null;
  otherModel: FlowModel | null;
  sync: ViewportSync;
}) {
  const { reloadSide, keepMine, requestAdd } = useStore.getState();
  if (!state) return <div className="pane-message muted">This process has no {name}.</div>;
  if (!state.model) {
    return (
      <div className="pane-message">
        <strong>{name} could not be read. Fix the file and it will reload automatically.</strong>
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
