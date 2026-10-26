import { ID_PATTERN } from "./model";

export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Slug of `name` that does not collide with `taken` (adds -2, -3, ... when needed). */
export function uniqueSlug(name: string, taken: Iterable<string>, fallback = "process"): string {
  const used = new Set(taken);
  const base = slugify(name) || fallback;
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

export function idProblem(id: string, taken: Iterable<string>): string | null {
  if (id.length === 0) return "ID is required.";
  if (!ID_PATTERN.test(id)) return "Use lowercase letters, digits and single hyphens (e.g. receive-order).";
  if (new Set(taken).has(id)) return `"${id}" is already used.`;
  return null;
}
