import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateProcess } from "../core/mutations";
import { useStore } from "./store";

// Outside Tauri the store uses the in-memory demo file system with the bundled examples.
const ROOT = "/demo/business-processes";
const ASIS = `${ROOT}/shipping.yaml`;

async function openShipping() {
  const s = useStore.getState();
  await s.init();
  await s.openFolder();
  await useStore.getState().openProcess("shipping");
}

describe("store", () => {
  beforeEach(async () => {
    await openShipping();
  });

  it("saves edits as minimal YAML changes", async () => {
    const fs = useStore.getState().fs!;
    const before = await fs.readText(ASIS);
    useStore.getState().apply("asis", (m) => updateProcess(m, "pack-items", { name: "Pack parcels" }));
    expect(useStore.getState().current!.sides.asis!.dirty).toBe(true);
    await useStore.getState().save();
    expect(await fs.readText(ASIS)).toBe(before.replace("name: Pack items", "name: Pack parcels"));
    expect(useStore.getState().current!.sides.asis!.dirty).toBe(false);
  });

  it("reloads external changes when there are no unsaved edits", async () => {
    const fs = useStore.getState().fs!;
    const text = (await fs.readText(ASIS)).replace("name: Deliver", "name: Deliver to customer");
    await fs.writeText(ASIS, text);
    await useStore.getState().handleExternalChange([ASIS]);
    const model = useStore.getState().current!.sides.asis!.model!;
    expect(model.processes.find((p) => p.id === "deliver")!.name).toBe("Deliver to customer");
  });

  it("flags a conflict instead of overwriting unsaved edits", async () => {
    const fs = useStore.getState().fs!;
    useStore.getState().apply("asis", (m) => updateProcess(m, "deliver", { name: "Mine" }));
    await fs.writeText(ASIS, (await fs.readText(ASIS)).replace("name: Deliver", "name: Theirs"));
    await useStore.getState().handleExternalChange([ASIS]);
    const side = useStore.getState().current!.sides.asis!;
    expect(side.conflict).toBe(true);
    expect(side.model!.processes.find((p) => p.id === "deliver")!.name).toBe("Mine");
  });

  it("undoes and redoes edits", () => {
    const s = useStore.getState();
    s.apply("asis", (m) => updateProcess(m, "deliver", { name: "Changed" }));
    useStore.getState().undo("asis");
    const name = () => useStore.getState().current!.sides.asis!.model!.processes.find((p) => p.id === "deliver")!.name;
    expect(name()).not.toBe("Changed");
    useStore.getState().redo("asis");
    expect(name()).toBe("Changed");
  });

  it("keeps the selection when switching to a side that has the same process", () => {
    const s = useStore.getState();
    s.setView("compare");
    s.select({ side: "asis", kind: "process", id: "pack-items" });
    useStore.getState().setView("tobe");
    expect(useStore.getState().selection).toEqual({ side: "tobe", kind: "process", id: "pack-items" });
    useStore.getState().select({ side: "tobe", kind: "flow", from: "pick-items", to: "print-label" });
    useStore.getState().setView("asis");
    // As-Is has no pick-items -> print-label flow, so the selection is dropped.
    expect(useStore.getState().selection).toBeNull();
  });
});

describe("workspace", () => {
  beforeEach(async () => {
    await openShipping();
    // The demo file system asks through window.confirm.
    vi.stubGlobal("window", { confirm: () => true });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("groups flat files by name into processes", () => {
    const entries = useStore.getState().entries;
    const summary = Object.fromEntries(entries.map((e) => [e.id, [e.title, e.hasAsis, e.hasTobe]]));
    expect(summary).toMatchObject({
      procurement: ["Procurement", true, false],
      "sales-order": ["Sales Order", true, true],
      shipping: ["Shipping", true, true],
    });
  });

  it("reads processes in subfolders as categories", async () => {
    const fs = useStore.getState().fs!;
    await fs.writeText(`${ROOT}/sales/returns.yaml`, await fs.readText(ASIS));
    await useStore.getState().refreshEntries();
    const entry = useStore.getState().entries.find((e) => e.id === "sales/returns");
    expect(entry).toMatchObject({ title: "returns", hasAsis: true, hasTobe: false });
    expect(entry!.paths.tobe).toBe(`${ROOT}/sales/returns.tobe.yaml`);
  });

  it("opens a process without a To-Be as a single flow", async () => {
    await useStore.getState().openProcess("procurement");
    const { current, view } = useStore.getState();
    expect(view).toBe("asis");
    expect(current!.sides.tobe).toBeUndefined();
  });

  it("adopts the To-Be as the process's flow", async () => {
    const s = useStore.getState();
    await s.createProcess("adopt-me", "Adopt me");
    const fs = s.fs!;
    expect(await fs.readText(`${ROOT}/adopt-me.md`)).toContain("# Adopt me");
    await useStore.getState().openProcess("adopt-me");
    await useStore.getState().createTobe(useStore.getState().current!.entry);
    expect(useStore.getState().view).toBe("compare");
    useStore.getState().apply("tobe", (m) => updateProcess(m, "end", { name: "Done" }));
    await useStore.getState().save();
    const tobeText = await fs.readText(`${ROOT}/adopt-me.tobe.yaml`);

    await useStore.getState().adoptTobe();
    expect(await fs.readText(`${ROOT}/adopt-me.yaml`)).toBe(tobeText);
    expect(await fs.exists(`${ROOT}/adopt-me.tobe.yaml`)).toBe(false);
    const { current, view } = useStore.getState();
    expect(view).toBe("asis");
    expect(current!.sides.tobe).toBeUndefined();
    expect(current!.sides.asis!.model!.processes.find((p) => p.id === "end")!.name).toBe("Done");
  });

  it("refuses to adopt or discard with unsaved edits", async () => {
    await useStore.getState().openProcess("sales-order");
    useStore.getState().apply("tobe", (m) => updateProcess(m, "receive-order", { name: "Unsaved" }));
    await useStore.getState().discardTobe();
    expect(await useStore.getState().fs!.exists(`${ROOT}/sales-order.tobe.yaml`)).toBe(true);
    expect(useStore.getState().notice?.level).toBe("warning");
  });

  it("drops a To-Be deleted on disk and falls back to the single flow", async () => {
    const s = useStore.getState();
    await s.createProcess("drop-me", "Drop me");
    await useStore.getState().openProcess("drop-me");
    await useStore.getState().createTobe(useStore.getState().current!.entry);
    const fs = s.fs!;
    await fs.remove(`${ROOT}/drop-me.tobe.yaml`);
    await useStore.getState().handleExternalChange([`${ROOT}/drop-me.tobe.yaml`]);
    const { current, view } = useStore.getState();
    expect(view).toBe("asis");
    expect(current!.sides.tobe).toBeUndefined();
    expect(current!.entry.hasTobe).toBe(false);
  });
});
