import ELK from "elkjs/lib/elk.bundled.js";
import type { FlowModel, Lane, Process } from "./model";

export const NODE_WIDTH = 180;
/** Minimum height of a process box; boxes grow to fit long names (see layoutModels). */
export const NODE_HEIGHT = 64;
const SLOT_GAP = 32;
const LANE_PADDING = 28;
const LAYER_GAP = 56;
export const LANE_HEADER_HEIGHT = 48;

export interface LaneColumn {
  id: string;
  x: number;
  width: number;
}

export interface Layout {
  /** Top-left corner of each process box, keyed by "lane/id" (see positionOf). */
  positions: Map<string, { x: number; y: number }>;
  /** Height of each process box, keyed by process id. */
  heights: Map<string, number>;
  /** Layer (row) index of each process. */
  layers: Map<string, number>;
  lanes: LaneColumn[];
  width: number;
  height: number;
}

const elk = new ELK();

/**
 * Lays out one or more models on a shared grid.
 *
 * Rows come from ELK's layered algorithm run on the union of all models (merged by
 * process id), so a process present in several models gets the same row in each and
 * a process present in only one lands on an intermediate row. Columns are swimlanes;
 * processes sharing a lane and a row are placed side by side in ELK's order.
 *
 * `measure` gives the height a process box needs; a process present in several models
 * takes the largest, and each row is as tall as its tallest box.
 */
export async function layoutModels(models: FlowModel[], measure?: (p: Process) => number): Promise<Layout> {
  const laneOrder = mergeLanes(models.map((m) => m.lanes));
  const known = new Set(models.flatMap((m) => m.processes.map((p) => p.id)));
  const nodeIds = [...known];
  const edgeKeys = new Set<string>();
  const edges: { id: string; sources: string[]; targets: string[] }[] = [];
  for (const m of models) {
    for (const f of m.flows) {
      const key = `${f.from}->${f.to}`;
      if (!known.has(f.from) || !known.has(f.to) || f.from === f.to || edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push({ id: key, sources: [f.from], targets: [f.to] });
    }
  }

  const result = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.crossingMinimization.semiInteractive": "false",
    },
    children: nodeIds.map((id) => ({ id, width: NODE_WIDTH, height: NODE_HEIGHT })),
    edges,
  });

  // ELK reports coordinates; recover discrete rows from distinct y values.
  const placed = (result.children ?? []).map((c) => ({ id: c.id, x: c.x ?? 0, y: c.y ?? 0 }));
  const rowYs = [...new Set(placed.map((p) => Math.round(p.y)))].sort((a, b) => a - b);
  const layers = new Map(placed.map((p) => [p.id, rowYs.indexOf(Math.round(p.y))]));
  const orderInRow = new Map(placed.map((p) => [p.id, p.x]));

  // Processes of each model per cell (lane and row). A process may sit in different
  // lanes on different sides; it then has a place in each.
  const cells = new Map<string, string[][]>();
  const cellKey = (lane: string, row: number) => `${lane}#${row}`;
  models.forEach((m, i) => {
    for (const p of m.processes) {
      const key = cellKey(p.lane, layers.get(p.id) ?? 0);
      const cell = cells.get(key) ?? models.map((): string[] => []);
      cell[i].push(p.id);
      cells.set(key, cell);
    }
  });

  // Slots within a cell: a process found there in several models takes the same slot in
  // each, in ELK's order. The other processes of each model fill the slots after them, so
  // processes found on only one side share slots instead of pushing each other apart.
  const byOrder = (a: string, b: string) => (orderInRow.get(a) ?? 0) - (orderInRow.get(b) ?? 0);
  const slotOf = new Map<string, number>();
  const slotCounts = new Map<string, number>();
  for (const [key, cell] of cells) {
    const counts = new Map<string, number>();
    for (const ids of cell) for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    const shared = [...counts].filter(([, n]) => n > 1).map(([id]) => id).sort(byOrder);
    shared.forEach((id, i) => slotOf.set(`${key}/${id}`, i));
    let count = shared.length;
    for (const ids of cell) {
      const own = ids.filter((id) => counts.get(id) === 1).sort(byOrder);
      own.forEach((id, i) => slotOf.set(`${key}/${id}`, shared.length + i));
      count = Math.max(count, shared.length + own.length);
    }
    slotCounts.set(key, count);
  }

  const lanes: LaneColumn[] = [];
  let x = 0;
  for (const laneId of laneOrder) {
    let slots = 1;
    for (const [key, count] of slotCounts) {
      if (key.startsWith(`${laneId}#`)) slots = Math.max(slots, count);
    }
    const width = LANE_PADDING * 2 + slots * NODE_WIDTH + (slots - 1) * SLOT_GAP;
    lanes.push({ id: laneId, x, width });
    x += width;
  }
  const laneX = new Map(lanes.map((l) => [l.id, l]));

  const heights = new Map<string, number>();
  for (const m of models) {
    for (const p of m.processes) {
      const h = Math.max(NODE_HEIGHT, measure?.(p) ?? NODE_HEIGHT);
      heights.set(p.id, Math.max(heights.get(p.id) ?? 0, h));
    }
  }
  const rowHeights = rowYs.map(() => NODE_HEIGHT);
  for (const [id, row] of layers) rowHeights[row] = Math.max(rowHeights[row], heights.get(id) ?? NODE_HEIGHT);
  const rowTops: number[] = [];
  let y = LANE_HEADER_HEIGHT + LAYER_GAP / 2;
  for (const h of rowHeights) {
    rowTops.push(y);
    y += h + LAYER_GAP;
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const [key, cell] of cells) {
    const [laneId, row] = key.split("#");
    const lane = laneX.get(laneId);
    if (!lane) continue;
    // Center the cell's slots inside the lane column.
    const count = slotCounts.get(key) ?? 1;
    const slotsWidth = count * NODE_WIDTH + (count - 1) * SLOT_GAP;
    const startX = lane.x + (lane.width - slotsWidth) / 2;
    const r = Number(row);
    for (const id of new Set(cell.flat())) {
      // Vertically center boxes shorter than their row.
      const h = heights.get(id) ?? NODE_HEIGHT;
      positions.set(`${laneId}/${id}`, {
        x: startX + (slotOf.get(`${key}/${id}`) ?? 0) * (NODE_WIDTH + SLOT_GAP),
        y: (rowTops[r] ?? 0) + ((rowHeights[r] ?? NODE_HEIGHT) - h) / 2,
      });
    }
  }

  return {
    positions,
    heights,
    layers,
    lanes,
    width: x,
    height: rowYs.length ? y - LAYER_GAP / 2 : LANE_HEADER_HEIGHT + NODE_HEIGHT + LAYER_GAP,
  };
}

export function positionOf(layout: Layout, lane: string, id: string) {
  return layout.positions.get(`${lane}/${id}`);
}

export function heightOf(layout: Layout, id: string) {
  return layout.heights.get(id) ?? NODE_HEIGHT;
}

/**
 * Merges lane lists preserving each list's order: lanes unknown so far are inserted
 * right after the lane that precedes them in their own list.
 */
export function mergeLanes(lists: Lane[][]): string[] {
  const order: string[] = [];
  for (const list of lists) {
    let anchor = -1;
    for (const lane of list) {
      const at = order.indexOf(lane.id);
      if (at >= 0) {
        anchor = at;
        continue;
      }
      order.splice(anchor + 1, 0, lane.id);
      anchor += 1;
    }
  }
  return order;
}
