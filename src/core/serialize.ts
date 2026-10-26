import { Document, isMap, isScalar, isSeq, parseDocument, YAMLMap, YAMLSeq, type Node, type Pair } from "yaml";
import type { Flow, FlowModel, Lane, Process } from "./model";

/**
 * Writes the model back into YAML text.
 *
 * When the original document is given, it is updated in place so that comments,
 * key order and formatting of untouched entries survive. This keeps git diffs minimal.
 */
export function serializeFlowYaml(model: FlowModel, original?: Document): string {
  const doc = original ? (original.clone() as Document) : parseDocument("{}");
  if (!isMap(doc.contents)) doc.contents = doc.createNode({}) as YAMLMap;

  if (!doc.has("version")) prependVersion(doc);

  syncMap(doc, "swimlanes", model.lanes, laneFields);
  syncMap(doc, "processes", model.processes, processFields);
  syncFlows(doc, model.flows);

  return doc.toString({ lineWidth: 0, flowCollectionPadding: false });
}

type Fields = Record<string, unknown>;

function laneFields(l: Lane): Fields {
  return { name: l.name };
}

function processFields(p: Process): Fields {
  return {
    name: p.name,
    lane: p.lane,
    // "task" is the default; it is written only when the file already spells it out.
    type: p.type,
    description: p.description,
    systems: p.systems && p.systems.length > 0 ? p.systems : undefined,
    documents: p.documents && p.documents.length > 0 ? p.documents : undefined,
  };
}

function prependVersion(doc: Document) {
  const map = doc.contents as YAMLMap;
  const pair = doc.createPair("version", 1) as Pair;
  map.items.unshift(pair);
}

function syncMap<T extends { id: string }>(
  doc: Document,
  key: string,
  items: T[],
  toFields: (item: T) => Fields,
) {
  let map = doc.get(key, true);
  if (!isMap(map)) {
    map = new YAMLMap();
    doc.set(key, map);
  }
  const yamlMap = map as YAMLMap;
  const wanted = new Map(items.map((i) => [i.id, i]));

  // Drop removed entries.
  yamlMap.items = yamlMap.items.filter((pair) => wanted.has(keyOf(pair)));

  const existing = new Map(yamlMap.items.map((pair) => [keyOf(pair), pair]));
  for (const item of items) {
    const fields = toFields(item);
    const pair = existing.get(item.id);
    if (!pair) {
      yamlMap.items.push(doc.createPair(item.id, compact(fields, key === "processes")) as Pair);
      continue;
    }
    if (!isMap(pair.value)) {
      pair.value = doc.createNode(compact(fields, key === "processes"));
      continue;
    }
    syncFields(doc, pair.value, fields);
  }
}

function syncFields(doc: Document, map: YAMLMap, fields: Fields) {
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) {
      map.delete(k);
      continue;
    }
    if (k === "type" && v === "task" && !map.has(k)) continue;
    const current = map.get(k, true) as Node | undefined;
    if (current && sameValue(current, v)) continue;
    if (isScalar(current) && typeof v !== "object") {
      current.value = v;
    } else {
      map.set(k, doc.createNode(v, { flow: Array.isArray(v) }));
    }
  }
}

function syncFlows(doc: Document, flows: Flow[]) {
  let seq = doc.get("flows", true);
  if (!isSeq(seq)) {
    seq = new YAMLSeq();
    doc.set("flows", seq);
  }
  const yamlSeq = seq as YAMLSeq;
  // Reuse existing nodes (with their comments) for flows that still exist.
  const pool = new Map<string, Node[]>();
  for (const item of yamlSeq.items) {
    if (!isMap(item)) continue;
    const k = `${item.get("from")}->${item.get("to")}`;
    pool.set(k, [...(pool.get(k) ?? []), item as Node]);
  }
  yamlSeq.items = flows.map((f) => {
    const k = `${f.from}->${f.to}`;
    const reused = pool.get(k)?.shift();
    if (reused && isMap(reused)) {
      syncFields(doc, reused, { from: f.from, to: f.to, label: f.label });
      return reused;
    }
    return doc.createNode(compact({ from: f.from, to: f.to, label: f.label }, false));
  });
}

function compact(fields: Fields, omitDefaultType: boolean): Fields {
  const out: Fields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    if (omitDefaultType && k === "type" && v === "task") continue;
    out[k] = v;
  }
  return out;
}

function keyOf(pair: Pair): string {
  const k = pair.key as unknown;
  return isScalar(k) ? String(k.value) : String(k);
}

function sameValue(node: Node, v: unknown): boolean {
  return JSON.stringify(node.toJSON()) === JSON.stringify(v);
}
