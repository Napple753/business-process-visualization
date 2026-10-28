import type { Side } from "../core/model";
import { useStore } from "../state/store";

/** A process's flow is only called As-Is while there is a To-Be to compare it with. */
export function sideName(side: Side, hasTobe: boolean): string {
  return side === "tobe" ? "To-Be" : hasTobe ? "As-Is" : "Flow";
}

export function useSideName(): (side: Side) => string {
  const hasTobe = useStore((s) => !!s.current?.sides.tobe);
  return (side) => sideName(side, hasTobe);
}
