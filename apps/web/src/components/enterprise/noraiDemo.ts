import type { EnvironmentId, KnowledgeGraph, KnowledgeProposal } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";
import { kavakCorpus } from "./noraiKavakCorpus";

// The sample is only shown when explicitly enabled in the development UI; it never enters the hub.
const noraiDemoKey = (environmentId: EnvironmentId) => `t3:norai-sample-map:${environmentId}`;

type Layer = KnowledgeGraph["nodes"][number]["layer"];
export type DemoNode = {
  -readonly [K in keyof KnowledgeGraph["nodes"][number]]: KnowledgeGraph["nodes"][number][K];
} & { isNew?: boolean; hub?: boolean };

type Hub = {
  slug: string;
  title: string;
  areaId: string;
  layer: Layer;
  description: string;
  links: readonly string[];
};

// The Kavak/Norai story (docs/plans/bucket-graph-demo.md); facts come from the kavak-kb answer key.
const hubs: readonly Hub[] = [
  {
    slug: "deliveries",
    title: "Entregas por ciudad",
    areaId: "ventas",
    layer: "metrics",
    description: "Venta = autos entregados. Nacional: 5,241–7,666 por mes.",
    links: ["sales-data", "fdv-results"],
  },
  {
    slug: "fdv-results",
    title: "Fin de Verano 2026 · resultados",
    areaId: "ventas",
    layer: "metrics",
    description: "13,547 entregas; 4,880 con la campaña (36.0%); lift diario +12.6% vs. jul–ago.",
    links: ["promotions-table", "fdv-campaign", "warehouse"],
  },
  {
    slug: "margin",
    title: "Margen del descuento",
    areaId: "ventas",
    layer: "metrics",
    description: "Descuento promedio por auto $13,047 MXN; tope $15,000 MXN.",
    links: ["fdv-campaign", "fdv-results"],
  },
  {
    slug: "cx-tickets",
    title: "Tickets CX de promoción",
    areaId: "cx",
    layer: "metrics",
    description: "147 tickets sobre Fin de Verano; CX debe transferir solo excepciones.",
    links: ["cx-tickets-data", "cx-playbooks", "fdv-campaign"],
  },
  {
    slug: "conversion",
    title: "Conversión Buen Fin 2026",
    areaId: "cx",
    layer: "metrics",
    description: "Seguimiento de la campaña nueva; el porcentaje de descuento sigue por definir.",
    links: ["buen-fin", "meets"],
  },
  {
    slug: "bot-quality",
    title: "Calidad del CX Assistant",
    areaId: "ingenieria",
    layer: "metrics",
    description: "Casos de evaluación: campañas vigentes, cita de fuente y abstención.",
    links: ["cx-assistant", "rag-skill"],
  },
  {
    slug: "kavak-collab",
    title: "Colaboración activa con Kavak",
    areaId: "general",
    layer: "business",
    description:
      "Hay una colaboración activa con Kavak y los bots ya tienen esta información. Sin porcentaje.",
    links: ["buen-fin", "company"],
  },
  {
    slug: "buen-fin",
    title: "Campaña Buen Fin 2026 con Kavak",
    areaId: "cx",
    layer: "business",
    description:
      "Del 13 al 16 de noviembre; descuento porcentual por definir. María lleva el plan de CX.",
    links: ["kavak-collab", "meets", "planner", "decisions", "fdv-campaign"],
  },
  {
    slug: "fdv-campaign",
    title: "Fin de Verano 2026 · 5% (finalizada)",
    areaId: "ventas",
    layer: "business",
    description:
      "5% sobre precio de lista, tope $15,000 MXN, 2026-09-01 a 2026-10-31. Owner: Magdalena (Ventas). Campaña anterior, a retirar del contexto vigente.",
    links: ["promotions-table", "fdv-results", "access"],
  },
  {
    slug: "warranty",
    title: "Política de garantía y devoluciones",
    areaId: "general",
    layer: "business",
    description: "v2 (desde 2026-03-01): 7 días / 300 km; reemplaza a v1 (5 días / 250 km).",
    links: ["cx-playbooks", "cx-assistant"],
  },
  {
    slug: "cx-playbooks",
    title: "Playbooks de CX",
    areaId: "cx",
    layer: "business",
    description: "Garantía, devoluciones, escalamiento y FAQ del bot.",
    links: ["warranty", "cx-assistant"],
  },
  {
    slug: "company",
    title: "Empresa, equipos y squads",
    areaId: "general",
    layer: "business",
    description: "Onboarding, glosario y mapa de equipos: cómo colaboran en una campaña.",
    links: ["access", "slack"],
  },
  {
    slug: "cx-assistant",
    title: "CX Assistant (bot RAG)",
    areaId: "ingenieria",
    layer: "ai",
    description:
      "Bot de atención con RAG. Mala práctica plantada: campaña vigente hardcodeada en el prompt.",
    links: ["rag-skill", "warranty", "agent-runs"],
  },
  {
    slug: "rag-skill",
    title: "Skill RAG · buenas prácticas (Francisco)",
    areaId: "personal",
    layer: "ai",
    description:
      "10 prácticas de RAG: no hardcodear, cita, filtro de acceso, frescura, eval, abstención. Compartida de Francisco a María.",
    links: ["planner", "cx-assistant"],
  },
  {
    slug: "planner",
    title: "Agente de planificación de campañas",
    areaId: "cx",
    layer: "ai",
    description:
      "Convierte la reunión en plan y tareas; el diseño lee el % desde la tabla de Sales.",
    links: ["meets", "promotions-table", "access", "decisions"],
  },
  {
    slug: "access",
    title: "Accesos y Request access",
    areaId: "general",
    layer: "ai",
    description:
      "Iker no tiene acceso a Ventas: pide acceso y Magdalena (lead de Sales) lo aprueba.",
    links: ["promotions-table", "company"],
  },
  {
    slug: "decisions",
    title: "Registro de decisiones",
    areaId: "cx",
    layer: "ai",
    description:
      "Decisión: preparar el diseño de la promo Kavak, no lanzar todavía. María plan, Iker %, Francisco revisa.",
    links: ["meets", "buen-fin"],
  },
  {
    slug: "agent-runs",
    title: "Sesiones de agentes",
    areaId: "ventas",
    layer: "ai",
    description:
      "Sesiones que muestran fricción (definición de venta) y éxito (query semanal reutilizable).",
    links: ["deliveries", "cx-assistant"],
  },
  {
    slug: "promotions-table",
    title: "Tabla de promociones (Sales)",
    areaId: "ventas",
    layer: "data",
    description:
      "Fuente de verdad: sales.promotions. Campaña anterior de Kavak: 5.00% (2025-10-01 a 2025-10-31 en el fixture).",
    links: ["warehouse", "fdv-campaign"],
  },
  {
    slug: "warehouse",
    title: "Data warehouse kavak_dwh",
    areaId: "data",
    layer: "data",
    description: "Esquema, diccionario de datos, inventario (6,500 autos) y clientes.",
    links: ["promotions-table", "sales-data"],
  },
  {
    slug: "sales-data",
    title: "Ventas diarias",
    areaId: "ventas",
    layer: "data",
    description: "Día × ciudad × canal × promo_id, 2025-11 a 2026-10.",
    links: ["warehouse", "deliveries"],
  },
  {
    slug: "cx-tickets-data",
    title: "Tickets de CX",
    areaId: "cx",
    layer: "data",
    description: "Tickets de atención con y sin promoción.",
    links: ["cx-tickets"],
  },
  {
    slug: "meets",
    title: "Transcripts de Meet",
    areaId: "cx",
    layer: "data",
    description:
      "Kickoff Buen Fin y planificación Kavak: María, Iker y Francisco; comité comercial, retro y sync.",
    links: ["planner", "decisions"],
  },
  {
    slug: "slack",
    title: "Canales de Slack",
    areaId: "general",
    layer: "data",
    description:
      "#general, #cx, #ingenieria y #random. Incluye el rumor “creo que fue 10%” (sin fuente).",
    links: ["company"],
  },
];

// [pattern on the corpus path, hub it belongs to]; the first match wins.
const docHubs: ReadonlyArray<readonly [RegExp, string]> = [
  [/^ventas\/(postmortem|modelo)/, "fdv-results"],
  [/^ventas\/promociones/, "promotions-table"],
  [/^ventas\/ventas/, "sales-data"],
  [/^agentes\/.*(brenda)/, "agent-runs"],
  [/^agentes\//, "agent-runs"],
  [/^codebase\/|^ingenieria\//, "cx-assistant"],
  [/^cx\/tickets/, "cx-tickets-data"],
  [/^cx\//, "cx-playbooks"],
  [/^data\//, "warehouse"],
  [/politica-garantia/, "warranty"],
  [/boletin/, "fdv-campaign"],
  [/^general\//, "company"],
  [/^meet\//, "meets"],
  [/^org\//, "access"],
  [/rag-buenas/, "rag-skill"],
  [/^personal\//, "planner"],
  [/^slack\//, "slack"],
];
const extraDocs: ReadonlyArray<readonly [string, string, string, string]> = [
  [
    "demo/01-meet-kickoff-buen-fin.vtt",
    "meets",
    "cx",
    "Kickoff del Buen Fin 2026: Francisco, María e Iker planifican la promo con Kavak.",
  ],
  [
    "fixtures/kavak-planning.meet.txt",
    "meets",
    "cx",
    "Meet de planificación: María lleva el plan; Iker busca el % en Sales; Francisco revisa la solicitud esta tarde.",
  ],
  [
    "fixtures/kavak-promotions.sql",
    "promotions-table",
    "ventas",
    "sales.promotions: campaña anterior de Kavak con discount_percent 5.00.",
  ],
];

const leafNouns: Record<Layer, readonly string[]> = {
  metrics: [
    "reporte semanal",
    "tablero",
    "meta",
    "pronóstico",
    "variación",
    "cohorte",
    "benchmark",
    "alerta",
  ],
  business: [
    "brief",
    "acuerdo",
    "playbook",
    "checklist",
    "minuta",
    "propuesta",
    "cronograma",
    "FAQ",
  ],
  ai: ["skill", "prompt", "evaluación", "guardrail", "flujo", "resumen", "decisión", "runbook"],
  data: ["export", "snapshot", "tabla", "extracto", "notas de reunión", "hoja", "log", "esquema"],
};

const slugOf = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const docTitle = (path: string) => {
  const base = (path.split("/").pop() ?? path).replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
  return base.charAt(0).toUpperCase() + base.slice(1);
};

// mulberry32: a fixed seed keeps the sample identical on every load and every device.
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

function buildSample(): DemoNode[] {
  const random = seeded(9);
  const nodes: DemoNode[] = [];
  const hubById = new Map(hubs.map((hub) => [hub.slug, hub]));
  const add = (node: Omit<DemoNode, "private" | "accessible">) =>
    nodes.push({ ...node, private: node.areaId !== "general", accessible: false });
  for (const hub of hubs)
    add({
      id: `sample:${hub.slug}`,
      title: hub.title,
      areaId: hub.areaId,
      layer: hub.layer,
      description: hub.description,
      links: hub.links.map((link) => `sample:${link}`),
      hub: true,
    });
  const real = new Map<string, string[]>();
  const addDoc = (path: string, hubSlug: string, areaId: string, description: string) => {
    const hub = hubById.get(hubSlug)!;
    const id = `sample:doc-${slugOf(path)}`;
    add({
      id,
      title: docTitle(path),
      areaId: areaId.startsWith("personal") ? "personal" : areaId,
      layer: hub.layer,
      description,
      links: [`sample:${hubSlug}`],
    });
    real.set(hubSlug, [...(real.get(hubSlug) ?? []), id]);
  };
  for (const [path, , area, description] of kavakCorpus) {
    const hubSlug = docHubs.find(([pattern]) => pattern.test(path))?.[1];
    if (hubSlug) addDoc(path, hubSlug, area, description);
  }
  for (const [path, hubSlug, area, description] of extraDocs)
    addDoc(path, hubSlug, area, description);
  // generic filler keeps the layers dense; it is the only invented content
  const filler: string[] = [];
  for (const hub of hubs) {
    const count = 8 + Math.floor(random() * 8);
    for (let k = 0; k < count; k++) {
      const noun = leafNouns[hub.layer][Math.floor(random() * leafNouns[hub.layer].length)]!;
      const id = `sample:${hub.slug}-${k + 1}`;
      filler.push(id);
      add({
        id,
        title: `${hub.title} · ${noun} ${k + 1}`,
        areaId: hub.areaId,
        layer: hub.layer,
        description: `${noun} de ${hub.title.toLowerCase()}`,
        links: [`sample:${hub.slug}`],
      });
    }
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const order: readonly Layer[] = ["metrics", "business", "ai", "data"];
  for (let c = 0; c < 140; c++) {
    const from = byId.get(filler[Math.floor(random() * filler.length)]!)!;
    const li = order.indexOf(from.layer);
    if (li === 3) continue;
    const pool = filler.filter((id) => byId.get(id)!.layer === order[li + 1]);
    const target = pool[Math.floor(random() * pool.length)]!;
    if (!from.links.includes(target)) from.links = [...from.links, target];
  }
  return nodes;
}

export const noraiDemoGraph: { nodes: DemoNode[] } = { nodes: buildSample() };

export type DemoProposal = {
  id: string;
  fileName: string;
  node: DemoNode;
  anchorTitle: string;
  status: "pending" | "applied" | "rejected";
  reason?: string;
  createdAt: string;
};
/** `added` holds approved nodes only; `proposals` is the mock Changes inbox. */
export type DemoState = { added: DemoNode[]; proposals: DemoProposal[] };
const emptyState: DemoState = { added: [], proposals: [] };

const noraiDemoAddedKey = (environmentId: EnvironmentId) =>
  `t3:norai-sample-added:${environmentId}`;

export const noraiDemoSteps = [
  "Reading the file",
  "Locating the right area and layer",
  "Creating the node",
  "Linking it to existing knowledge",
] as const;

const rules: ReadonlyArray<{ pattern: RegExp; anchor: string }> = [
  {
    pattern: /kavak|promo|promoci|descuento|discount|buen.?fin|fin.?de.?verano/i,
    anchor: "fdv-campaign",
  },
  { pattern: /meet|call|reuni|notes|nota|transcript|minuta|vtt/i, anchor: "meets" },
  { pattern: /rag|skill|prompt|agent|agente|llm/i, anchor: "rag-skill" },
  { pattern: /kpi|metric|entrega|delivery|revenue|dashboard/i, anchor: "deliveries" },
  { pattern: /garant|devoluci|warranty|policy|politica/i, anchor: "warranty" },
  { pattern: /csv|xlsx|sql|table|tabla|export|data/i, anchor: "promotions-table" },
];
const fallbackAnchor = "kavak-collab";

const titleOf = (fileName: string) => {
  const base =
    fileName
      .replace(/\.[^./]+$/, "")
      .replace(/[-_]+/g, " ")
      .trim() || "New document";
  return base.charAt(0).toUpperCase() + base.slice(1);
};

/** Adds exactly one node next to the hub it belongs to; every existing node is returned untouched. */
export function addIngestedNode(
  nodes: ReadonlyArray<DemoNode>,
  fileName: string,
): { nodes: DemoNode[]; added: DemoNode & { isNew: true } } {
  const anchorId = `sample:${rules.find((rule) => rule.pattern.test(fileName))?.anchor ?? fallbackAnchor}`;
  const anchor = nodes.find((node) => node.id === anchorId) ?? nodes[0]!;
  const taken = new Set(nodes.map((node) => node.id));
  const slug =
    fileName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "file";
  let id = `sample:ingested-${slug}`;
  for (let n = 2; taken.has(id); n++) id = `sample:ingested-${slug}-${n}`;
  const added = {
    id,
    title: titleOf(fileName),
    areaId: anchor.areaId,
    layer: anchor.layer,
    description: `Ingested from ${fileName}`,
    links: [anchor.id],
    private: anchor.areaId !== "general",
    accessible: false,
    isNew: true,
  } as const;
  return { nodes: [...nodes, added], added };
}

export const demoNodes = (state: DemoState) => [...noraiDemoGraph.nodes, ...state.added];

const DEMO_EVENT = "norai-demo-ready";
const stateKey = (environmentId: EnvironmentId) => noraiDemoAddedKey(environmentId);
const notify = () => window.dispatchEvent(new Event(DEMO_EVENT));

export function loadDemoState(environmentId: EnvironmentId): DemoState {
  return parseDemoState(sessionStorage.getItem(stateKey(environmentId)));
}

function parseDemoState(raw: string | null): DemoState {
  try {
    const parsed = JSON.parse(raw ?? "null");
    return {
      added: Array.isArray(parsed?.added) ? parsed.added : [],
      proposals: Array.isArray(parsed?.proposals) ? parsed.proposals : [],
    };
  } catch {
    return emptyState;
  }
}

function saveDemoState(environmentId: EnvironmentId, state: DemoState) {
  try {
    sessionStorage.setItem(stateKey(environmentId), JSON.stringify(state));
  } catch {}
  notify();
}

const snapshots = new Map<string, DemoState>();
/** Mock map state for the dev/demo flow, shared by Ingest, Changes and the map through sessionStorage. */
export function useDemoState(environmentId: EnvironmentId): { active: boolean; state: DemoState } {
  const raw = useSyncExternalStore(
    (listener) => {
      window.addEventListener(DEMO_EVENT, listener);
      return () => window.removeEventListener(DEMO_EVENT, listener);
    },
    () =>
      (sessionStorage.getItem(noraiDemoKey(environmentId)) === "ready" ? "1" : "0") +
      (sessionStorage.getItem(stateKey(environmentId)) ?? ""),
    () => "0",
  );
  if (!snapshots.has(raw)) snapshots.set(raw, parseDemoState(raw.slice(1) || null));
  return { active: import.meta.env.DEV && raw[0] === "1", state: snapshots.get(raw)! };
}

/** The mock agent decides where the file goes and files a pending proposal; the graph is untouched. */
export function proposeDemoFile(environmentId: EnvironmentId, fileName: string): DemoProposal {
  const state = loadDemoState(environmentId);
  const known = [...demoNodes(state), ...state.proposals.map((proposal) => proposal.node)];
  const { added } = addIngestedNode(known, fileName);
  const anchor = known.find((node) => node.id === added.links[0]);
  const proposal: DemoProposal = {
    id: `demo-${added.id.slice("sample:".length)}`,
    fileName,
    node: added,
    anchorTitle: anchor?.title ?? "",
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  saveDemoState(environmentId, { ...state, proposals: [...state.proposals, proposal] });
  sessionStorage.setItem(noraiDemoKey(environmentId), "ready");
  notify();
  return proposal;
}

/** Approve adds exactly one NEW node; reject leaves the graph as it was. */
export function decideDemoProposal(
  environmentId: EnvironmentId,
  id: string,
  action: "approve" | "reject",
  reason?: string,
) {
  const state = loadDemoState(environmentId);
  const target = state.proposals.find(
    (proposal) => proposal.id === id && proposal.status === "pending",
  );
  if (!target) return;
  saveDemoState(environmentId, {
    added: action === "approve" ? [...state.added, { ...target.node, isNew: true }] : state.added,
    proposals: state.proposals.map((proposal) =>
      proposal === target
        ? {
            ...proposal,
            status: action === "approve" ? "applied" : "rejected",
            ...(reason ? { reason } : {}),
          }
        : proposal,
    ),
  });
}

export function clearDemoNew(environmentId: EnvironmentId) {
  const state = loadDemoState(environmentId);
  if (state.added.some((node) => node.isNew))
    saveDemoState(environmentId, {
      ...state,
      added: state.added.map((node) => ({ ...node, isNew: false })),
    });
}

export function resetDemo(environmentId: EnvironmentId) {
  sessionStorage.removeItem(noraiDemoKey(environmentId));
  sessionStorage.removeItem(stateKey(environmentId));
  notify();
}

const layerNames = { metrics: "Metrics", business: "Business", ai: "AI", data: "Data" } as const;

/** Mock proposals shaped like the real inbox so Changes renders them with its own components. */
export function demoKnowledgeProposals(state: DemoState): KnowledgeProposal[] {
  return state.proposals.map(({ id, fileName, node, anchorTitle, status, reason, createdAt }) => ({
    id,
    kind: "create",
    scope: node.areaId,
    path: `${node.areaId}/${node.layer}/${node.id.slice("sample:".length)}.md`,
    content: [
      `# ${node.title}`,
      "",
      `- Placed in: ${layerNames[node.layer]} layer · ${node.areaId} area`,
      `- Linked to: ${anchorTitle}`,
      `- Source file: ${fileName}`,
    ].join("\n"),
    reason: `The agent read ${fileName} and placed it next to “${anchorTitle}” in the ${layerNames[node.layer]} layer.`,
    evidence: [fileName],
    proposedBy: "norai.agent@norai.local",
    createdAt,
    status: status === "pending" ? "pending" : status === "applied" ? "applied" : "rejected",
    baseContentHash: "",
    baseVersion: "",
    targetVersion: "",
    reviewers: [],
    canDecide: true,
    ...(status === "pending" ? {} : { resolvedBy: "you", resolvedAt: createdAt }),
    ...(reason ? { rejectionReason: reason } : {}),
  }));
}
