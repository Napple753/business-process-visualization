import { Document, isMap, parseDocument } from "yaml";
import { z } from "zod";
import { NODE_TYPES, type FlowModel, type Process } from "./model";

const stringList = z.array(z.string());

const laneSchema = z.object({ name: z.string() });

const processSchema = z.object({
  name: z.string(),
  lane: z.string(),
  type: z.enum(NODE_TYPES).optional(),
  description: z.string().optional(),
  systems: stringList.optional(),
  documents: stringList.optional(),
});

const flowSchema = z.object({
  from: z.string(),
  to: z.string(),
  label: z.string().optional(),
});

const fileSchema = z.object({
  version: z.literal(1).optional(),
  swimlanes: z.record(z.string(), laneSchema).nullish(),
  processes: z.record(z.string(), processSchema).nullish(),
  flows: z.array(flowSchema).nullish(),
});

export interface ParseResult {
  /** Parsed model, or null when the file could not be interpreted at all. */
  model: FlowModel | null;
  /** The YAML document, kept so that saving can preserve comments and key order. */
  doc: Document;
  errors: string[];
}

export function parseFlowYaml(text: string): ParseResult {
  const doc = parseDocument(text, { keepSourceTokens: false });
  const errors = doc.errors.map((e) => `YAML: ${e.message}`);
  if (errors.length > 0) return { model: null, doc, errors };

  const raw = doc.toJS() ?? {};
  const result = fileSchema.safeParse(raw);
  if (!result.success) {
    return {
      model: null,
      doc,
      errors: result.error.issues.map((i) => `Schema: ${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }

  const data = result.data;
  // Key order is taken from the YAML map so that it matches the file exactly.
  const laneIds = orderedKeys(doc, "swimlanes");
  const processIds = orderedKeys(doc, "processes");

  const model: FlowModel = {
    version: 1,
    lanes: laneIds.map((id) => ({ id, name: data.swimlanes![id].name })),
    processes: processIds.map((id): Process => {
      const p = data.processes![id];
      return {
        id,
        name: p.name,
        lane: p.lane,
        type: p.type ?? "task",
        ...(p.description !== undefined && { description: p.description }),
        ...(p.systems !== undefined && { systems: p.systems }),
        ...(p.documents !== undefined && { documents: p.documents }),
      };
    }),
    flows: (data.flows ?? []).map((f) => ({
      from: f.from,
      to: f.to,
      ...(f.label !== undefined && { label: f.label }),
    })),
  };
  return { model, doc, errors: [] };
}

function orderedKeys(doc: Document, key: string): string[] {
  const node = doc.get(key, true);
  if (!isMap(node)) return [];
  return node.items.map((pair) => String((pair.key as { value?: unknown })?.value ?? pair.key));
}
