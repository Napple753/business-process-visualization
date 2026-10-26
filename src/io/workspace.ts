import { parseFlowYaml } from "../core/parse";
import type { Side } from "../core/model";
import { validateModel, type Issue } from "../core/validate";
import { baseName, joinPath, type FileSystem } from "./fs";

export const WORKSPACE_DIR = "business-processes";

export const FILE_NAMES: Record<Side, string> = { asis: "asis.yaml", tobe: "tobe.yaml" };

export interface ProcessEntry {
  /** Folder name; also the process identifier. */
  folder: string;
  path: string;
  title: string;
  hasAsis: boolean;
  hasTobe: boolean;
  issues: Record<Side, Issue[]>;
}

/** Accepts either the business-processes folder itself or a folder that contains it. */
export async function resolveWorkspaceRoot(fs: FileSystem, selected: string): Promise<string | null> {
  if (baseName(selected) === WORKSPACE_DIR) return selected;
  const nested = joinPath(selected, WORKSPACE_DIR);
  return (await fs.exists(nested)) ? nested : null;
}

export async function scanWorkspace(fs: FileSystem, root: string): Promise<ProcessEntry[]> {
  const dirs = (await fs.readDir(root)).filter((e) => e.isDirectory && !e.name.startsWith("."));
  const entries = await Promise.all(dirs.map((d) => readEntry(fs, joinPath(root, d.name))));
  return entries.sort((a, b) => a.folder.localeCompare(b.folder));
}

async function readEntry(fs: FileSystem, path: string): Promise<ProcessEntry> {
  const folder = baseName(path);
  const issues: Record<Side, Issue[]> = { asis: [], tobe: [] };
  const presence: Record<Side, boolean> = { asis: false, tobe: false };
  for (const side of ["asis", "tobe"] as const) {
    const file = joinPath(path, FILE_NAMES[side]);
    if (!(await fs.exists(file))) continue;
    presence[side] = true;
    const { model, errors } = parseFlowYaml(await fs.readText(file));
    issues[side] = model
      ? validateModel(model)
      : errors.map((message): Issue => ({ severity: "error", message }));
  }
  return {
    folder,
    path,
    title: await readTitle(fs, path, folder),
    hasAsis: presence.asis,
    hasTobe: presence.tobe,
    issues,
  };
}

async function readTitle(fs: FileSystem, path: string, fallback: string): Promise<string> {
  const readme = joinPath(path, "README.md");
  if (!(await fs.exists(readme))) return fallback;
  const heading = (await fs.readText(readme)).match(/^#\s+(.+)$/m);
  return heading ? heading[1].trim() : fallback;
}

export async function createProcessFolder(fs: FileSystem, root: string, folder: string, title: string) {
  const path = joinPath(root, folder);
  if (await fs.exists(path)) throw new Error(`"${folder}" already exists.`);
  await fs.mkdir(path);
  await fs.writeText(joinPath(path, "README.md"), readmeTemplate(title));
  await fs.writeText(joinPath(path, FILE_NAMES.asis), FLOW_TEMPLATE);
}

export async function copyAsisToTobe(fs: FileSystem, entry: ProcessEntry) {
  const target = joinPath(entry.path, FILE_NAMES.tobe);
  if (await fs.exists(target)) throw new Error("To-Be already exists.");
  await fs.writeText(target, await fs.readText(joinPath(entry.path, FILE_NAMES.asis)));
}

function readmeTemplate(title: string): string {
  return `# ${title}

## Overview

## Departments

## Related processes

## Notes
`;
}

const FLOW_TEMPLATE = `version: 1
swimlanes:
  owner:
    name: Owner
processes:
  start:
    name: Start
    lane: owner
    type: start
  end:
    name: End
    lane: owner
    type: end
flows:
  - from: start
    to: end
`;
