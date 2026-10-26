import { ask, open } from "@tauri-apps/plugin-dialog";
import { exists, mkdir, readDir, readTextFile, watch, writeTextFile } from "@tauri-apps/plugin-fs";
import { load } from "@tauri-apps/plugin-store";
import type { FileSystem } from "./fs";

export function createTauriFs(): FileSystem {
  const store = load("settings.json", { autoSave: true, defaults: {} });
  return {
    kind: "tauri",
    async pickFolder() {
      const picked = await open({ directory: true, multiple: false, title: "Select a folder" });
      return typeof picked === "string" ? picked : null;
    },
    async readDir(path) {
      const entries = await readDir(path);
      return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory }));
    },
    readText: (path) => readTextFile(path),
    writeText: (path, text) => writeTextFile(path, text),
    exists: (path) => exists(path),
    mkdir: (path) => mkdir(path, { recursive: true }),
    async watch(path, onChange) {
      return watch(path, (event) => onChange(event.paths), { recursive: true, delayMs: 300 });
    },
    confirm: (message) => ask(message, { title: "Process Workbench", kind: "warning" }),
    async loadSetting(key) {
      const value = await (await store).get<string>(key);
      return value ?? null;
    },
    async saveSetting(key, value) {
      const s = await store;
      if (value === null) await s.delete(key);
      else await s.set(key, value);
    },
  };
}
