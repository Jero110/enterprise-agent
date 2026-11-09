import { describe, expect, it } from "@effect/vitest";
import { classifyIngestionManifest } from "./IngestionManifest.ts";

const header = "path,tipo_fuente,area_acceso,owner,fecha,descripcion";

const csv = [
  header,
  'cx/playbook.md,documento_md,cx,julian,2026-10-01,"Policy, returns and escalation"',
  'data/ventas.csv,csv_dataset,data,mateo,2026-10-02,"Daily deliveries, by city"',
  'ingenieria/cx-assistant/retriever.py,codigo,ingenieria,francisco,2026-10-03,"Retrieval code"',
  'ventas/kpis.md,documento_md,ventas,magdalena,2026-10-04,"KPI: weekly deliveries"',
  'general/notes.md,documento_md,general,sofia,2026-10-05,"Miscellaneous notes"',
  'personal/other/notes.md,notas_personales,personal/other,other,2026-10-05,"Private notes"',
  'risk/unknown.md,documento_md,risk,other,2026-10-05,"Other area"',
  'cx/unused.md,documento_md,cx,julian,2026-10-05,"Not fetched"',
].join("\r\n");

describe("classifyIngestionManifest", () => {
  it("links only staged nonpersonal raw files to manifest area, owner and evidence-backed layer", () => {
    expect(
      classifyIngestionManifest(
        csv,
        [
          "raw/cx/playbook.md",
          "raw/data/ventas.csv",
          "raw/ingenieria/cx-assistant/retriever.py",
          "raw/ventas/kpis.md",
          "raw/general/notes.md",
          "raw/personal/other/notes.md",
          "raw/risk/unknown.md",
          "raw/cx/missing.md",
        ],
        ["cx", "data", "ingenieria", "ventas"],
      ),
    ).toEqual([
      {
        path: "raw/cx/playbook.md",
        area: "cx",
        scope: "cx",
        owner: "julian",
        date: "2026-10-01",
        description: "Policy, returns and escalation",
        layer: "business",
      },
      {
        path: "raw/data/ventas.csv",
        area: "data",
        scope: "data",
        owner: "mateo",
        date: "2026-10-02",
        description: "Daily deliveries, by city",
        layer: "data",
      },
      {
        path: "raw/ingenieria/cx-assistant/retriever.py",
        area: "ingenieria",
        scope: "ingenieria",
        owner: "francisco",
        date: "2026-10-03",
        description: "Retrieval code",
        layer: "ai",
      },
      {
        path: "raw/ventas/kpis.md",
        area: "ventas",
        scope: "ventas",
        owner: "magdalena",
        date: "2026-10-04",
        description: "KPI: weekly deliveries",
        layer: "metrics",
      },
      {
        path: "raw/general/notes.md",
        area: "general",
        scope: "global",
        owner: "sofia",
        date: "2026-10-05",
        description: "Miscellaneous notes",
        layer: null,
      },
    ]);
  });
  it("rejects duplicate, traversal and malformed quoted manifest rows instead of trusting them", () => {
    const classify = (body: string) =>
      classifyIngestionManifest(`${header}\n${body}`, ["raw/cx/notes.md"], ["cx"]);
    expect(() =>
      classify(
        "cx/notes.md,documento_md,cx,ana,2026-01-01,Notes\ncx/notes.md,documento_md,cx,bob,2026-01-01,Other",
      ),
    ).toThrow();
    expect(() => classify("../cx/notes.md,documento_md,cx,ana,2026-01-01,Notes")).toThrow();
    expect(() => classify('cx/notes.md,documento_md,cx,ana,2026-01-01,"Unclosed')).toThrow();
  });
});
