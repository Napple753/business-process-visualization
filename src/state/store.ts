import type { Document } from "yaml";
import { create } from "zustand";
import type { FlowModel, Side } from "../core/model";
import type { MutationResult } from "../core/mutations";
import { parseFlowYaml } from "../core/parse";
import { serializeFlowYaml } from "../core/serialize";
import { baseName, getFileSystem, type FileSystem } from "../io/fs";
import {
  adoptTobe,
  createProcess,
  createTobe,
  discardTobe,
  resolveWorkspaceRoot,
  scanWorkspace,
  type ProcessEntry,
} from "../io/workspace";

const HISTORY_LIMIT = 200;
const LAST_FOLDER_KEY = "lastFolder";

export interface SideState {
  path: string;
  /** Text last read from or written to disk; used to tell our own writes from external ones. */
  diskText: string;
  doc: Document | null;
  model: FlowModel | null;
  errors: string[];
  past: FlowModel[];
  future: FlowModel[];
  dirty: boolean;
  /** The file changed on disk while there were unsaved edits. */
  conflict: boolean;
}

export type Selection =
  | { side: Side; kind: "process"; id: string }
  | { side: Side; kind: "flow"; from: string; to: string }
  | null;

/** A two-step edit waiting for the user to pick a target process. */
export type Pending = { kind: "merge"; side: Side; from: string } | null;

/** Where a process created through the add dialog goes. */
export type AddPlacement =
  | { kind: "between"; from: string; to: string }
  | { kind: "after"; from: string }
  | { kind: "before"; to: string }
  | { kind: "first" };

export interface AddRequest {
  side: Side;
  placement: AddPlacement;
  lane?: string;
}

export interface Notice {
  level: "info" | "warning" | "error";
  text: string;
}

export type ViewMode = "compare" | Side;

interface AppState {
  fs: FileSystem | null;
  root: string | null;
  entries: ProcessEntry[];
  current: { entry: ProcessEntry; sides: Partial<Record<Side, SideState>> } | null;
  view: ViewMode;
  selection: Selection;
  pending: Pending;
  addRequest: AddRequest | null;
  notice: Notice | null;
  activeSide: Side;

  init(): Promise<void>;
  openFolder(): Promise<void>;
  closeFolder(): Promise<void>;
  refreshEntries(): Promise<void>;
  createProcess(name: string, title: string): Promise<void>;
  createTobe(entry: ProcessEntry): Promise<void>;
  /** Replaces the flow of the open process with its To-Be. */
  adoptTobe(): Promise<void>;
  discardTobe(): Promise<void>;
  openProcess(id: string): Promise<void>;
  closeProcess(): void;
  setView(view: ViewMode): void;
  select(selection: Selection): void;
  setPending(pending: Pending): void;
  requestAdd(request: AddRequest | null): void;
  notify(notice: Notice | null): void;
  apply(side: Side, edit: (model: FlowModel) => FlowModel | MutationResult): void;
  undo(side?: Side): void;
  redo(side?: Side): void;
  save(): Promise<void>;
  reloadSide(side: Side): Promise<void>;
  keepMine(side: Side): void;
  handleExternalChange(paths: string[]): Promise<void>;
}

let stopWatching: (() => void) | null = null;

export const useStore = create<AppState>((set, get) => ({
  fs: null,
  root: null,
  entries: [],
  current: null,
  view: "compare",
  selection: null,
  pending: null,
  addRequest: null,
  notice: null,
  activeSide: "tobe",

  async init() {
    const fs = await getFileSystem();
    set({ fs });
    const last = await fs.loadSetting(LAST_FOLDER_KEY);
    if (last && (await fs.exists(last).catch(() => false))) await setRoot(last);
  },

  async openFolder() {
    const fs = get().fs!;
    const picked = await fs.pickFolder();
    if (!picked) return;
    const root = await resolveWorkspaceRoot(fs, picked);
    if (!root) {
      get().notify({ level: "error", text: `No "business-processes" folder found in ${picked}.` });
      return;
    }
    await setRoot(root);
  },

  async closeFolder() {
    stopWatching?.();
    stopWatching = null;
    await get().fs?.saveSetting(LAST_FOLDER_KEY, null);
    set({ root: null, entries: [], current: null, selection: null, pending: null });
  },

  async refreshEntries() {
    const { fs, root } = get();
    if (!fs || !root) return;
    try {
      set({ entries: await scanWorkspace(fs, root) });
    } catch (e) {
      get().notify({ level: "error", text: `Failed to read workspace: ${String(e)}` });
    }
  },

  async createProcess(name, title) {
    const { fs, root } = get();
    await createProcess(fs!, root!, name, title);
    await get().refreshEntries();
  },

  async createTobe(entry) {
    await createTobe(get().fs!, entry);
    await reopenIfCurrent(entry.id);
  },

  async adoptTobe() {
    const { fs, current } = get();
    if (!fs || !current?.sides.tobe || !(await confirmTobeChange(fs, current, "adopt"))) return;
    await adoptTobe(fs, current.entry);
    await reopenIfCurrent(current.entry.id);
    get().notify({ level: "info", text: `To-Be adopted as ${baseName(current.entry.paths.asis)}.` });
  },

  async discardTobe() {
    const { fs, current } = get();
    if (!fs || !current?.sides.tobe || !(await confirmTobeChange(fs, current, "discard"))) return;
    await discardTobe(fs, current.entry);
    await reopenIfCurrent(current.entry.id);
    get().notify({ level: "info", text: "To-Be discarded." });
  },

  async openProcess(id) {
    const { fs, entries } = get();
    const entry = entries.find((e) => e.id === id);
    if (!fs || !entry) return;
    const sides: Partial<Record<Side, SideState>> = {};
    for (const side of ["asis", "tobe"] as const) {
      const path = entry.paths[side];
      if (await fs.exists(path)) sides[side] = loadSide(path, await fs.readText(path));
    }
    const view = defaultView(sides);
    set({ current: { entry, sides }, view, selection: null, pending: null, activeSide: view === "asis" ? "asis" : "tobe" });
  },

  closeProcess() {
    set({ current: null, selection: null, pending: null });
    void get().refreshEntries();
  },

  setView(view) {
    set({
      view,
      selection: carrySelection(get().selection, view, get().current?.sides),
      pending: null,
      ...(view !== "compare" && { activeSide: view }),
    });
  },

  select(selection) {
    set({ selection, ...(selection && { activeSide: selection.side }) });
  },

  setPending(pending) {
    set({ pending });
  },

  requestAdd(addRequest) {
    set({ addRequest, pending: null });
  },

  notify(notice) {
    set({ notice });
  },

  apply(side, edit) {
    const current = get().current;
    const state = current?.sides[side];
    if (!current || !state?.model) return;
    const result = edit(state.model);
    const { model, warning }: MutationResult = "processes" in result ? { model: result } : result;
    if (model === state.model) {
      if (warning) get().notify({ level: "warning", text: warning });
      return;
    }
    updateSide(side, {
      model,
      past: [...state.past, state.model].slice(-HISTORY_LIMIT),
      future: [],
      dirty: true,
    });
    set({ activeSide: side, notice: warning ? { level: "warning", text: warning } : null });
    dropStaleSelection(side, model);
  },

  undo(side = get().activeSide) {
    const state = get().current?.sides[side];
    if (!state?.model || state.past.length === 0) return;
    const model = state.past[state.past.length - 1];
    updateSide(side, {
      model,
      past: state.past.slice(0, -1),
      future: [state.model, ...state.future],
      dirty: true,
    });
    dropStaleSelection(side, model);
  },

  redo(side = get().activeSide) {
    const state = get().current?.sides[side];
    if (!state?.model || state.future.length === 0) return;
    const [model, ...future] = state.future;
    updateSide(side, { model, past: [...state.past, state.model], future, dirty: true });
    dropStaleSelection(side, model);
  },

  async save() {
    const { fs, current } = get();
    if (!fs || !current) return;
    for (const side of ["asis", "tobe"] as const) {
      const state = current.sides[side];
      if (!state?.model || !state.dirty) continue;
      const text = serializeFlowYaml(state.model, state.doc ?? undefined);
      try {
        await fs.writeText(state.path, text);
      } catch (e) {
        get().notify({ level: "error", text: `Failed to save ${state.path}: ${String(e)}` });
        return;
      }
      // Re-parse so that the next save builds on the document that is now on disk.
      const reparsed = parseFlowYaml(text);
      updateSide(side, { diskText: text, doc: reparsed.doc, dirty: false, conflict: false });
    }
    get().notify({ level: "info", text: "Saved." });
    void get().refreshEntries();
  },

  async reloadSide(side) {
    const { fs, current } = get();
    const state = current?.sides[side];
    if (!fs || !state) return;
    const text = await fs.readText(state.path);
    updateSide(side, loadSide(state.path, text));
    const reloaded = get().current?.sides[side]?.model;
    if (reloaded) dropStaleSelection(side, reloaded);
  },

  keepMine(side) {
    updateSide(side, { conflict: false });
  },

  async handleExternalChange(paths) {
    await get().refreshEntries();
    const { fs, current } = get();
    if (!fs || !current) return;
    const touched = (p: string) => paths.some((changed) => normalize(changed) === normalize(p));
    const { entry } = current;
    if (![entry.paths.asis, entry.paths.tobe, entry.readme].some(touched)) return;

    const latest = get().entries.find((e) => e.id === entry.id);
    if (!latest) {
      get().notify({ level: "warning", text: "This process was removed on disk." });
      return;
    }
    useStore.setState({ current: { ...get().current!, entry: latest } });
    for (const side of ["asis", "tobe"] as const) {
      const state = current.sides[side];
      const path = entry.paths[side];
      // A side may have been created or removed, e.g. a To-Be added or adopted by git pull.
      if (!state) {
        if (await fs.exists(path)) setSide(side, loadSide(path, await fs.readText(path)));
        continue;
      }
      if (!touched(state.path)) continue;
      if (!(await fs.exists(state.path))) {
        if (state.dirty) get().notify({ level: "warning", text: `${baseName(state.path)} was deleted on disk.` });
        else removeSide(side);
        continue;
      }
      const text = await fs.readText(state.path);
      if (text === state.diskText) continue; // Our own save.
      if (state.dirty) updateSide(side, { conflict: true });
      else await get().reloadSide(side);
    }
  },
}));

async function setRoot(root: string) {
  const { fs } = useStore.getState();
  if (!fs) return;
  stopWatching?.();
  useStore.setState({ root, current: null, selection: null, pending: null });
  await fs.saveSetting(LAST_FOLDER_KEY, root);
  await useStore.getState().refreshEntries();
  try {
    stopWatching = await fs.watch(root, (paths) => void useStore.getState().handleExternalChange(paths));
  } catch (e) {
    useStore.getState().notify({ level: "warning", text: `File watching is unavailable: ${String(e)}` });
  }
}

function loadSide(path: string, text: string): SideState {
  const { model, doc, errors } = parseFlowYaml(text);
  return { path, diskText: text, doc, model, errors, past: [], future: [], dirty: false, conflict: false };
}

async function reopenIfCurrent(id: string) {
  await useStore.getState().refreshEntries();
  if (useStore.getState().current?.entry.id === id) await useStore.getState().openProcess(id);
}

async function confirmTobeChange(
  fs: FileSystem,
  current: NonNullable<AppState["current"]>,
  action: "adopt" | "discard",
): Promise<boolean> {
  if (current.sides.asis?.dirty || current.sides.tobe?.dirty) {
    useStore.getState().notify({ level: "warning", text: "Save or undo your changes first." });
    return false;
  }
  const { paths } = current.entry;
  return fs.confirm(
    action === "adopt"
      ? `Replace ${baseName(paths.asis)} with the To-Be and delete ${baseName(paths.tobe)}?`
      : `Delete ${baseName(paths.tobe)}?`,
  );
}

function defaultView(sides: Partial<Record<Side, SideState>>): ViewMode {
  return sides.asis && sides.tobe ? "compare" : sides.tobe ? "tobe" : "asis";
}

function updateSide(side: Side, patch: Partial<SideState>) {
  const current = useStore.getState().current;
  const state = current?.sides[side];
  if (!current || !state) return;
  useStore.setState({ current: { ...current, sides: { ...current.sides, [side]: { ...state, ...patch } } } });
}

function setSide(side: Side, state: SideState) {
  const current = useStore.getState().current;
  if (!current) return;
  useStore.setState({ current: { ...current, sides: { ...current.sides, [side]: state } } });
}

function removeSide(side: Side) {
  const { current, selection, pending, view } = useStore.getState();
  if (!current) return;
  const sides = { ...current.sides };
  delete sides[side];
  const nextView = view === "compare" || view === side ? defaultView(sides) : view;
  useStore.setState({
    current: { ...current, sides },
    view: nextView,
    ...(nextView !== "compare" && { activeSide: nextView }),
    selection: selection?.side === side ? null : selection,
    pending: pending?.side === side ? null : pending,
  });
}

function dropStaleSelection(side: Side, model: FlowModel) {
  const { selection } = useStore.getState();
  if (!selection || selection.side !== side) return;
  const stillThere =
    selection.kind === "process"
      ? model.processes.some((p) => p.id === selection.id)
      : model.flows.some((f) => f.from === selection.from && f.to === selection.to);
  if (!stillThere) useStore.setState({ selection: null });
}

/**
 * Keeps the selection across a view switch: a single-side view takes over the same
 * process or flow from the other side when it exists there.
 */
function carrySelection(
  selection: Selection,
  view: ViewMode,
  sides: Partial<Record<Side, SideState>> | undefined,
): Selection {
  if (!selection || view === "compare" || selection.side === view) return selection;
  const model = sides?.[view]?.model;
  if (!model) return null;
  const exists =
    selection.kind === "process"
      ? model.processes.some((p) => p.id === selection.id)
      : model.flows.some((f) => f.from === selection.from && f.to === selection.to);
  return exists ? { ...selection, side: view } : null;
}

function normalize(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}
