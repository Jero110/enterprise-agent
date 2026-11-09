import type { KnowledgeLayer } from "@t3tools/contracts";
import { parse as parseYaml } from "yaml";

export const WIKI_VERSION_PATTERN = /^v\d+$/;

const LAYER_BY_DOMAIN: Readonly<Record<string, KnowledgeLayer>> = {
  ai: "ai",
  data: "data",
  metricas: "metrics",
  metrics: "metrics",
};

/** Converts one wiki page (Spanish front matter) into the hub's document format. */
export const wikiPageToDocument = (relativePath: string, raw: string): string => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  const body = match === null ? raw : raw.slice(match[0].length);
  let meta: Record<string, unknown> = {};
  try {
    const parsed: unknown = match === null ? {} : parseYaml(match[1]!);
    if (typeof parsed === "object" && parsed !== null) meta = parsed as Record<string, unknown>;
  } catch {
    // A page with unreadable front matter keeps its body and gets path-derived metadata.
  }
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const title = text(meta.titulo) || /^#\s+(.+)$/m.exec(body)?.[1]?.trim() || relativePath;
  const area =
    text(meta.area) ||
    (relativePath.startsWith("areas/") ? relativePath.split("/")[1]! : "general");
  const layer = LAYER_BY_DOMAIN[text(meta.dominio)] ?? "business";
  return [
    "---",
    `title: ${JSON.stringify(title)}`,
    `area: ${JSON.stringify(area)}`,
    `description: ${JSON.stringify(text(meta.descripcion))}`,
    `layer: ${layer}`,
    "private: false",
    "links: []",
    "---",
    "",
    body.replace(/^\r?\n/, ""),
  ].join("\n");
};
