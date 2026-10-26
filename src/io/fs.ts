// File system access used by the app. The Tauri implementation is used in the
// desktop app; the demo implementation serves the bundled examples in a plain
// browser (handy for UI development) and keeps writes in memory.

export interface DirEntry {
  name: string;
  isDirectory: boolean;
}

export interface FileSystem {
  readonly kind: "tauri" | "demo";
  pickFolder(): Promise<string | null>;
  readDir(path: string): Promise<DirEntry[]>;
  readText(path: string): Promise<string>;
  writeText(path: string, text: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  /** Calls `onChange` with changed paths; returns a function that stops watching. */
  watch(path: string, onChange: (paths: string[]) => void): Promise<() => void>;
  confirm(message: string): Promise<boolean>;
  loadSetting(key: string): Promise<string | null>;
  saveSetting(key: string, value: string | null): Promise<void>;
}

export function joinPath(base: string, ...parts: string[]): string {
  const sep = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  return [base.replace(/[\\/]+$/, ""), ...parts].join(sep);
}

export function baseName(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? path;
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

let instance: Promise<FileSystem> | null = null;

export function getFileSystem(): Promise<FileSystem> {
  instance ??= isTauri()
    ? import("./tauriFs").then((m) => m.createTauriFs())
    : import("./demoFs").then((m) => m.createDemoFs());
  return instance;
}
