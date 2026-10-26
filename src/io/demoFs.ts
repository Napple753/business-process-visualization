import type { DirEntry, FileSystem } from "./fs";

const ROOT = "/demo/business-processes";

// Bundle the example workspace so the UI can run without Tauri.
const bundled = import.meta.glob("../../examples/business-processes/**/*.{yaml,md}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export function createDemoFs(): FileSystem {
  const files = new Map<string, string>();
  for (const [path, text] of Object.entries(bundled)) {
    files.set(path.replace("../../examples/business-processes", ROOT), text);
  }
  const dirs = new Set<string>([ROOT]);
  for (const path of files.keys()) dirs.add(path.slice(0, path.lastIndexOf("/")));

  return {
    kind: "demo",
    async pickFolder() {
      return "/demo";
    },
    async readDir(path) {
      const prefix = `${path.replace(/\/$/, "")}/`;
      const names = new Map<string, boolean>();
      for (const p of [...files.keys(), ...dirs]) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        if (!rest) continue;
        const [first, ...more] = rest.split("/");
        names.set(first, (names.get(first) ?? false) || more.length > 0 || dirs.has(prefix + first));
      }
      return [...names].map(([name, isDirectory]): DirEntry => ({ name, isDirectory }));
    },
    async readText(path) {
      const text = files.get(path);
      if (text === undefined) throw new Error(`File not found: ${path}`);
      return text;
    },
    async writeText(path, text) {
      files.set(path, text);
    },
    async exists(path) {
      return files.has(path) || dirs.has(path);
    },
    async mkdir(path) {
      dirs.add(path);
    },
    async watch() {
      return () => {};
    },
    async confirm(message) {
      return window.confirm(message);
    },
    async loadSetting(key) {
      try {
        return localStorage.getItem(`pw:${key}`);
      } catch {
        return null;
      }
    },
    async saveSetting(key, value) {
      try {
        if (value === null) localStorage.removeItem(`pw:${key}`);
        else localStorage.setItem(`pw:${key}`, value);
      } catch {
        // Settings are a convenience only.
      }
    },
  };
}
