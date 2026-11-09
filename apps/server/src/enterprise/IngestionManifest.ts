export type ManifestLayer = "business" | "metrics" | "data" | "ai" | null;

export interface ManifestClassification {
  readonly path: string;
  readonly area: string;
  readonly scope: string;
  readonly owner: string;
  readonly date: string;
  readonly description: string;
  readonly layer: ManifestLayer;
}

const columns = ["path", "tipo_fuente", "area_acceso", "owner", "fecha", "descripcion"];
const invalid = () => new Error("Invalid ingestion manifest.");

const rowsOf = (csv: string): ReadonlyArray<ReadonlyArray<string>> => {
  if (csv.length > 1_000_000) throw invalid();
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closed = false;
  const finish = () => {
    row.push(field);
    if (row.some((value) => value.trim())) rows.push(row);
    if (rows.length > 5_001) throw invalid();
    row = [];
    field = "";
    closed = false;
  };
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i]!;
    if (quoted) {
      if (char !== '"') field += char;
      else if (csv[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = false;
        closed = true;
      }
    } else if (char === '"' && field === "" && !closed) quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
      closed = false;
    } else if (char === "\n") finish();
    else if (char === "\r" && csv[i + 1] === "\n") {
      finish();
      i++;
    } else if (char === '"' || closed) throw invalid();
    else field += char;
    if (field.length > 2_000 || row.length > 6) throw invalid();
  }
  if (quoted) throw invalid();
  if (field !== "" || row.length > 0) finish();
  return rows;
};

const safePath = (value: string) =>
  value.length <= 500 &&
  !/[\\\r\n\0]/.test(value) &&
  value
    .split("/")
    .every((part) => part !== "" && part !== "." && part !== ".." && !part.startsWith("."));

const layerOf = (path: string, type: string, description: string): ManifestLayer => {
  if (["csv_dataset", "esquema_sql", "base_de_datos"].includes(type)) return "data";
  if (
    type === "transcript_agente" ||
    /(?:cx-assistant|\brag\b|retriever|\bllm\b)/i.test(`${path} ${description}`)
  )
    return "ai";
  if (/\b(?:kpi|kpis|metrics|m[eé]tricas?|indicadores?|lift)\b/i.test(`${path} ${description}`))
    return "metrics";
  if (
    [
      "documento_md",
      "meet",
      "org_accesos",
      "org_derechos",
      "org_directorio",
      "org_ownership",
    ].includes(type) &&
    /(?:playbook|pol[ií]tica|negocio|venta|promoci[oó]n|reuni[oó]n|comit[eé]|organizaci[oó]n|equipo|escalamiento|faq)/i.test(
      `${path} ${description}`,
    )
  )
    return "business";
  return null;
};

/** Paths are relative to the repository root (`raw/<manifest path>`); hints never grant proposal permissions. */
export const classifyIngestionManifest = (
  csv: string,
  sourcePaths: ReadonlyArray<string>,
  allowedAreas: ReadonlyArray<string>,
): ReadonlyArray<ManifestClassification> => {
  const [header, ...rows] = rowsOf(csv);
  if (
    !header ||
    header.length !== columns.length ||
    header
      .map((name, index) => (index === 0 ? name.replace(/^\uFEFF/, "") : name))
      .some((name, index) => name !== columns[index])
  )
    throw invalid();
  const selected = new Set(sourcePaths);
  const allowed = new Set(allowedAreas);
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    if (row.length !== columns.length) throw invalid();
    const [path, type, area, owner, date, description] = row.map((value) => value.trim()) as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    if (
      !safePath(path) ||
      seen.has(path) ||
      !type ||
      !area ||
      !owner ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date)
    )
      throw invalid();
    seen.add(path);
    if (
      path.startsWith("personal/") ||
      area === "personal" ||
      area.startsWith("personal/") ||
      type.includes("personal") ||
      !selected.has(`raw/${path}`) ||
      (area !== "general" && !allowed.has(area))
    )
      return [];
    return [
      {
        path: `raw/${path}`,
        area,
        scope: area === "general" ? "global" : area,
        owner,
        date,
        description,
        layer: layerOf(path, type, description),
      },
    ];
  });
};
