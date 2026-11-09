import html from "../../../public/context-graph/index.html?raw";
import * as NodeVM from "node:vm";
import { describe, expect, it, vi } from "vite-plus/test";

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
      replaceChildren: () => void;
      append: (child: unknown) => void;
      hidden: boolean;
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
        replaceChildren() {},
        append() {},
        hidden: false,
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
    document: {
      getElementById: element,
      querySelectorAll: () => [],
      createElement: () => ({
        type: "",
        title: "",
        textContent: "",
        setAttribute() {},
        onclick: () => {},
      }),
    },
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
  it("starts empty and lays out real nodes in fixed area/layer clusters with only declared links", () => {
    using _timers = (() => {
      vi.useFakeTimers();
      return { [Symbol.dispose]: () => vi.useRealTimers() };
    })();
    const graph = graphHarness();
    expect(graph.inspect("nodes.length")).toBe(0);
    expect(graph.inspect('document.getElementById("empty-stage").hidden')).toBe(false);
    const nodes = Array.from({ length: 2000 }, (_, index) => ({
      id: `area/ledger/${index}.md`,
      title: `Real ${index}`,
      areaId: index % 2 ? "risk" : "ledger",
      layer: ["metrics", "business", "ai", "data"][index % 4],
      links: index ? [`area/ledger/${index - 1}.md`] : [],
      content: "Body must not enter the renderer",
      accessible: false,
    }));
    graph.send({ type: "knowledge-nodes", nodes });
    expect(graph.inspect("nodes.length")).toBe(2000);
    expect(graph.inspect('document.getElementById("empty-stage").hidden')).toBe(true);
    expect(graph.inspect("links.length")).toBe(1999);
    expect(graph.inspect("nodes.filter(n => n.hub).length")).toBe(0);
    expect(graph.inspect("nodes.every(n => Math.hypot(n.x, n.z) <= RAD)")).toBe(true);
    expect(
      graph.inspect(
        "LAYERS.every(layer => nodes.filter(n => n.layer === layer.id).some(n => Math.hypot(n.x, n.z) > 140))",
      ),
    ).toBe(true);
    expect(
      graph.inspect("nodes.every(n => n.x === n.fx && n.z === n.fz && n.fy === LAYERS[n.li].y)"),
    ).toBe(true);
    expect(graph.inspect("nodes.every(n => !('content' in n))")).toBe(true);
    vi.advanceTimersByTime(100);
    expect(graph.pause).toHaveBeenCalled();
    const resumes = graph.resume.mock.calls.length;
    vi.advanceTimersByTime(60_000);
    expect(graph.resume).toHaveBeenCalledTimes(resumes);
    expect(vi.getTimerCount()).toBe(0);
    graph.send({ type: "knowledge-nodes", nodes: [] });
    expect(graph.inspect("nodes.length + links.length")).toBe(0);
    expect(graph.inspect('document.getElementById("empty-stage").hidden')).toBe(false);
    graph.send({
      type: "knowledge-nodes",
      nodes: Array.from({ length: 187 }, (_, index) => ({
        id: `general/ai/${index}.md`,
        title: `Accepted ${index}`,
        areaId: "general",
        layer: "ai",
        links: [],
      })),
    });
    expect(graph.inspect("Math.max(...nodes.map(n => Math.hypot(n.x, n.z)))")).toBeGreaterThan(140);
    expect(graph.inspect("Math.min(...nodes.map(n => Math.hypot(n.x, n.z)))")).toBeLessThan(15);
    expect(graph.inspect("nodes.every(n => Math.hypot(n.x, n.z) < RAD)")).toBe(true);
    graph.send({
      type: "knowledge-nodes",
      nodes: ["cx", "ventas"].flatMap((areaId) =>
        Array.from({ length: 100 }, (_, index) => ({
          id: `${areaId}/business/${index}.md`,
          title: `${areaId} ${index}`,
          areaId,
          layer: "business",
          links: [],
        })),
      ),
    });
    expect(
      graph.inspect(
        'Math.hypot(nodes.find(n => n.areaId === "cx").x - nodes.find(n => n.areaId === "ventas").x, nodes.find(n => n.areaId === "cx").z - nodes.find(n => n.areaId === "ventas").z)',
      ),
    ).toBeGreaterThan(150);
    expect(graph.inspect("nodes.every(n => Math.hypot(n.x, n.z) < RAD)")).toBe(true);
  });

  it("keeps accepted CX Business and private Ventas Data Markdown as real linked documents", () => {
    const graph = graphHarness();
    graph.send({
      type: "knowledge-nodes",
      nodes: [
        {
          id: "areas/cx/experience.md",
          title: "CX",
          areaId: "cx",
          layer: "business",
          links: ["areas/ventas/sales.md"],
        },
        {
          id: "areas/ventas/sales.md",
          title: "Ventas",
          areaId: "ventas",
          layer: "data",
          links: [],
        },
      ],
    });
    expect(graph.inspect("nodes.map(n => [n.id, n.areaId, n.layer, describe(n).kind])")).toEqual([
      ["areas/cx/experience.md", "cx", "business", "document"],
      ["areas/ventas/sales.md", "ventas", "data", "document"],
    ]);
    expect(graph.inspect("links.map(l => [l.source, l.target])")).toEqual([
      ["areas/cx/experience.md", "areas/ventas/sales.md"],
    ]);
    expect(graph.inspect("nodes.every(n => !('content' in n))")).toBe(true);
    expect(graph.inspect("nodes.every(n => n.x === 0 && n.z === 0)")).toBe(true);
    expect(graph.inspect('activeArea = "cx"; nodes.filter(vis).map(n => n.id)')).toEqual([
      "areas/cx/experience.md",
    ]);
    expect(graph.inspect("activeArea = null; nodes.filter(vis).length")).toBe(2);
  });
});
