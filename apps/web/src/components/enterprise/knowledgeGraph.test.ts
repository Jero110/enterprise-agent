import html from "../../../public/context-graph/index.html?raw";
import * as NodeVM from "node:vm";
import { describe, expect, it, vi } from "vite-plus/test";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  addIngestedNode,
  decideDemoProposal,
  demoKnowledgeProposals,
  loadDemoState,
  noraiDemoGraph,
  proposeDemoFile,
} from "./noraiDemo";

function graphHarness() {
  const script = html.slice(
    html.lastIndexOf("<script>") + "<script>".length,
    html.lastIndexOf("</script>"),
  );
  const receive: Array<(event: { source: object; data: object }) => void> = [];
  const parent = { postMessage: vi.fn() };
  const elements = new Map<
    string,
    {
      textContent: string;
      innerHTML: string;
      value: string;
      classList: { add: () => void; remove: () => void };
      addEventListener: () => void;
      querySelectorAll: () => never[];
    }
  >();
  const element = (id: string) => {
    if (!elements.has(id))
      elements.set(id, {
        textContent: "",
        innerHTML: "",
        value: "",
        classList: { add() {}, remove() {} },
        addEventListener() {},
        querySelectorAll: () => [],
      });
    return elements.get(id)!;
  };
  const pause = vi.fn();
  const resume = vi.fn();
  const force = { distance: () => force, strength: () => force, distanceMax: () => force };
  const controls = { enableDamping: true, addEventListener() {} };
  const graph: object = new Proxy(
    {},
    {
      get: (_, name) => {
        if (name === "pauseAnimation") return pause;
        if (name === "resumeAnimation") return resume;
        if (name === "controls") return () => controls;
        if (name === "camera") return () => ({ up: { set() {} } });
        if (name === "d3Force") return (_key: string, value?: unknown) => (value ? graph : force);
        return () => graph;
      },
    },
  );
  const context = {
    ForceGraph3D: () => () => graph,
    document: { getElementById: element, querySelectorAll: () => [] },
    window: {
      parent,
      addEventListener: (_name: string, listener: (typeof receive)[number]) =>
        receive.push(listener),
    },
    addEventListener() {},
    setTimeout,
    clearTimeout,
  };
  NodeVM.runInNewContext(script, context);
  return {
    send: (data: object) => receive.forEach((listener) => listener({ source: parent, data })),
    inspect: (expression: string) => NodeVM.runInNewContext(expression, context),
    pause,
    resume,
  };
}

describe("embedded knowledge graph", () => {
  it("adds one NEW linked node without moving any existing node", () => {
    const ids = new Set(noraiDemoGraph.nodes.map((node) => node.id));
    expect(ids.size).toBe(noraiDemoGraph.nodes.length);
    expect(noraiDemoGraph.nodes.every((node) => node.links.every((link) => ids.has(link)))).toBe(
      true,
    );
    expect(addIngestedNode(noraiDemoGraph.nodes, "nota-promo-kavak.md").added.links).toEqual([
      "sample:fdv-campaign",
    ]);
    expect(noraiDemoGraph.nodes.length).toBeGreaterThan(300);
    expect(noraiDemoGraph.nodes.length).toBeLessThan(450);
    const { nodes, added } = addIngestedNode(noraiDemoGraph.nodes, "Q3-revenue-kpis.pdf");
    expect(nodes.slice(0, -1)).toEqual(noraiDemoGraph.nodes);
    expect(nodes).toHaveLength(noraiDemoGraph.nodes.length + 1);
    expect(added).toMatchObject({ isNew: true, layer: "metrics", links: ["sample:deliveries"] });
    expect(addIngestedNode(nodes, "Q3-revenue-kpis.pdf").added.id).not.toBe(added.id);

    const graph = graphHarness();
    graph.send({ type: "knowledge-nodes", nodes: noraiDemoGraph.nodes });
    const before = graph.inspect("JSON.stringify(nodes.map(n => [n.id, n.x, n.z]))");
    graph.send({ type: "knowledge-nodes", nodes });
    expect(
      graph.inspect(`JSON.stringify(nodes.filter(n => !n.isNew).map(n => [n.id, n.x, n.z]))`),
    ).toBe(before);
    expect(graph.inspect("nodes.filter(n => n.isNew).length")).toBe(1);
    expect(graph.inspect("hubs.length")).toBeGreaterThan(20);
    expect(graph.inspect("new Set(links.map(l => l.kind)).size")).toBe(3);
    expect(
      graph.inspect("links.some(l => l.source === 'sample:ingested-q3-revenue-kpis-pdf')"),
    ).toBe(true);
    expect(
      graph.inspect(
        "(() => { const a = nodes.find(n => n.isNew); return nodes.every(b => b === a || Math.hypot(a.x - b.x, a.z - b.z) > 0.5); })()",
      ),
    ).toBe(true);
  });

  it("keeps an ingested file pending in Changes until approved, and rejection never touches the graph", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    });
    vi.stubGlobal("window", { dispatchEvent: () => true });
    const env = "env" as EnvironmentId;
    try {
      const first = proposeDemoFile(env, "Q3-revenue-kpis.pdf");
      const second = proposeDemoFile(env, "promo-export.csv");
      expect(loadDemoState(env).added).toEqual([]);
      expect(demoKnowledgeProposals(loadDemoState(env)).map((p) => p.status)).toEqual([
        "pending",
        "pending",
      ]);
      decideDemoProposal(env, first.id, "approve");
      decideDemoProposal(env, second.id, "reject", "duplicate");
      const state = loadDemoState(env);
      expect(state.added.map((node) => node.id)).toEqual([first.node.id]);
      expect(state.added[0]).toMatchObject({ isNew: true, links: ["sample:deliveries"] });
      expect(state.proposals.map((p) => p.status)).toEqual(["applied", "rejected"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
