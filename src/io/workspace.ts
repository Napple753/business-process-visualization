import { parseFlowYaml } from "../core/parse";
import type { Side } from "../core/model";
import { validateModel, type Issue } from "../core/validate";
import { baseName, joinPath, type FileSystem } from "./fs";

export const WORKSPACE_DIR = "business-processes";

// A process is a set of files sharing one name: `<name>.yaml` is its flow (the As-Is
// while a To-Be exists), `<name>.tobe.yaml` the planned flow and `<name>.md` the notes.
const SUFFIXES: Record<Side, string> = { asis: ".yaml", tobe: ".tobe.yaml" };
const README_SUFFIX = ".md";

export function flowFileName(name: string, side: Side): string {
  return name + SUFFIXES[side];
}

export interface ProcessEntry {
  /** Path from the workspace root without suffix, e.g. "sales/order"; also the process identifier. */
  id: string;
  title: string;
  /** Where each side's file lives, whether or not it exists. */
  paths: Record<Side, string>;
  readme: string;
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

/** Collects processes from the root and its subfolders, which serve as categories. */
export async function scanWorkspace(fs: FileSystem, root: string): Promise<ProcessEntry[]> {
  const found = new Map<string, { dir: string; name: string; sides: Set<Side> }>();
  const walk = async (dir: string, prefix: string) => {
    for (const e of await fs.readDir(dir)) {
      if (e.name.startsWith(".")) continue;
      if (e.isDirectory) {
        await walk(joinPath(dir, e.name), `${prefix}${e.name}/`);
        continue;
      }
      const side = sideOf(e.name);
      if (!side) continue;
      const name = e.name.slice(0, -SUFFIXES[side].length);
      const id = prefix + name;
      const item = found.get(id) ?? { dir, name, sides: new Set<Side>() };
      item.sides.add(side);
      found.set(id, item);
    }
  };
  await walk(root, "");
  const entries = await Promise.all(
    [...found].map(([id, { dir, name, sides }]) => readEntry(fs, id, dir, name, sides)),
  );
  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

function sideOf(fileName: string): Side | null {
  if (fileName.endsWith(SUFFIXES.tobe)) return fileName.length > SUFFIXES.tobe.length ? "tobe" : null;
  if (fileName.endsWith(SUFFIXES.asis)) return fileName.length > SUFFIXES.asis.length ? "asis" : null;
  return null;
}

async function readEntry(fs: FileSystem, id: string, dir: string, name: string, sides: Set<Side>): Promise<ProcessEntry> {
  const paths = entryPaths(dir, name);
  const issues: Record<Side, Issue[]> = { asis: [], tobe: [] };
  for (const side of sides) {
    const { model, errors } = parseFlowYaml(await fs.readText(paths[side]));
    issues[side] = model
      ? validateModel(model)
      : errors.map((message): Issue => ({ severity: "error", message }));
  }
  const readme = joinPath(dir, name + README_SUFFIX);
  return {
    id,
    title: await readTitle(fs, readme, name),
    paths,
    readme,
    hasAsis: sides.has("asis"),
    hasTobe: sides.has("tobe"),
    issues,
  };
}

function entryPaths(dir: string, name: string): Record<Side, string> {
  return { asis: joinPath(dir, flowFileName(name, "asis")), tobe: joinPath(dir, flowFileName(name, "tobe")) };
}

async function readTitle(fs: FileSystem, readme: string, fallback: string): Promise<string> {
  if (!(await fs.exists(readme))) return fallback;
  const heading = (await fs.readText(readme)).match(/^#\s+(.+)$/m);
  return heading ? heading[1].trim() : fallback;
}

export async function createProcess(fs: FileSystem, root: string, name: string, title: string) {
  const paths = entryPaths(root, name);
  const readme = joinPath(root, name + README_SUFFIX);
  for (const path of [paths.asis, paths.tobe, readme]) {
    if (await fs.exists(path)) throw new Error(`"${baseName(path)}" already exists.`);
  }
  await fs.writeText(readme, readmeTemplate(title));
  await fs.writeText(paths.asis, FLOW_TEMPLATE);
}

export async function createTobe(fs: FileSystem, entry: ProcessEntry) {
  if (await fs.exists(entry.paths.tobe)) throw new Error("To-Be already exists.");
  await fs.writeText(entry.paths.tobe, await fs.readText(entry.paths.asis));
}

/** Makes the To-Be the process's flow, so the commit shows the change on one file. */
export async function adoptTobe(fs: FileSystem, entry: ProcessEntry) {
  await fs.writeText(entry.paths.asis, await fs.readText(entry.paths.tobe));
  await fs.remove(entry.paths.tobe);
}

export async function discardTobe(fs: FileSystem, entry: ProcessEntry) {
  await fs.remove(entry.paths.tobe);
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
