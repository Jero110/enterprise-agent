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
  it("starts empty and lays out real nodes in fixed area/layer clusters with only declared links", () => {
    using _timers = (() => {
      vi.useFakeTimers();
      return { [Symbol.dispose]: () => vi.useRealTimers() };
    })();
    const graph = graphHarness();
    expect(graph.inspect("nodes.length")).toBe(0);
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
    expect(graph.inspect("links.length")).toBe(1999);
    expect(graph.inspect("nodes.filter(n => n.hub).length")).toBe(4);
    expect(graph.inspect("nodes.every(n => Math.hypot(n.x, n.z) <= RAD)")).toBe(true);
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
  });
});
