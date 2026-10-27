import { beforeEach, describe, expect, it } from "vitest";
import { updateProcess } from "../core/mutations";
import { useStore } from "./store";

// Outside Tauri the store uses the in-memory demo file system with the bundled examples.
const ASIS = "/demo/business-processes/shipping/asis.yaml";

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
