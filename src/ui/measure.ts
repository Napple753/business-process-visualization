import { NODE_HEIGHT } from "../core/layout";
import type { Process } from "../core/model";

const cache = new Map<string, number>();
let probe: { root: HTMLDivElement; label: HTMLSpanElement } | null = null;

/**
 * Height a process box needs to show its whole name, measured with the same CSS as
 * the rendered node (see .process-node in styles.css).
 */
export function measureProcessHeight(p: Process): number {
  const key = `${p.type}\n${p.name}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  if (!probe) {
    const root = document.createElement("div");
    root.setAttribute("aria-hidden", "true");
    root.style.cssText = "position:absolute;left:-10000px;top:0;visibility:hidden;height:auto";
    const label = document.createElement("span");
    label.className = "label";
    root.append(label);
    document.body.append(root);
    probe = { root, label };
  }
  probe.root.className = `process-node ${p.type}`;
  probe.label.textContent = p.name;
  const text = probe.label.getBoundingClientRect().height;
  // A diamond's text area narrows towards its vertices, so it needs extra height.
  const height = Math.ceil(p.type === "decision" ? text * 2.4 + 12 : text + 24);
  const result = Math.max(NODE_HEIGHT, height);
  cache.set(key, result);
  return result;
}
