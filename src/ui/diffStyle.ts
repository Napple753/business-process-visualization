import type { ChangeKind } from "../core/diff";

export const CHANGE_LABELS: Record<ChangeKind, string> = {
  added: "Added",
  removed: "Removed",
  renamed: "Renamed",
  moved: "Moved",
  laneChanged: "Lane changed",
  modified: "Modified",
};

export const CHANGE_COLORS: Record<ChangeKind, string> = {
  added: "var(--diff-added)",
  removed: "var(--diff-removed)",
  renamed: "var(--diff-renamed)",
  moved: "var(--diff-moved)",
  laneChanged: "var(--diff-lane)",
  modified: "var(--diff-modified)",
};

/** Kinds in order of visual priority; the first present one colors the node border. */
export const CHANGE_PRIORITY: ChangeKind[] = ["added", "removed", "moved", "laneChanged", "renamed", "modified"];

export const FLOW_COLORS = {
  added: "var(--diff-added)",
  removed: "var(--diff-removed)",
  relabeled: "var(--diff-renamed)",
} as const;

export type FlowStatus = keyof typeof FLOW_COLORS;
