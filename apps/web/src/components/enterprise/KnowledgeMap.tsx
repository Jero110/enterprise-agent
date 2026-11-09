import type {
  EnvironmentId,
  KnowledgeGraph,
  ThreadContextCard,
  ThreadKnowledgeScope,
} from "@t3tools/contracts";
import { Building2Icon, Layers3Icon, UserRoundIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { t } from "~/i18n";
import { cn } from "~/lib/utils";
import { enterpriseEnvironment } from "~/state/enterprise";
import { useAtomValue } from "@effect/atom-react";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import { useEnvironmentQuery } from "~/state/query";

import { Checkbox } from "../ui/checkbox";
import { SHOW_KNOWLEDGE_GRAPH } from "./proposalGraph";
import { clearDemoNew, demoNodes, useDemoState, type DemoState } from "./noraiDemo";

const LAYERS = ["metrics", "business", "ai", "data"] as const;
type KnowledgeNode = KnowledgeGraph["nodes"][number] & {
  scope: Scope;
  path: string;
  kind: "document";
};

function layerLabel(layer: string): string {
  return layer === "ai" ? "AI" : t(layer[0]?.toUpperCase() + layer.slice(1));
}

function KnowledgeDocument({
  node,
  environmentId,
  areaName,
  refresh,
}: {
  node: KnowledgeNode;
  environmentId: EnvironmentId;
  areaName: string;
  refresh: () => void;
}) {
  const request = useAtomCommand(enterpriseEnvironment.knowledgeRequestAccess, {
    label: "request knowledge access",
  });
  const permitted = useAtomValue(
    enterpriseEnvironment.knowledgeRequestAccess.permissionAtom(environmentId),
  );
  const [busy, setBusy] = useState(false);
  const [requested, setRequested] = useState(false);
  return (
    <div className="min-h-0 overflow-auto">
      <p className="mt-3 text-sm">{node.description}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        {areaName} · {!node.accessible || node.private ? t("Private") : t("Shared")}
      </p>
      {node.accessible ? (
        <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-xs">
          {node.content ?? t("No content")}
        </pre>
      ) : (
        <div className="mt-3 space-y-3">
          <p>{t("This document is private to its area.")}</p>
          <Button
            size="sm"
            disabled={!permitted || busy || requested}
            onClick={async () => {
              if (!environmentId) return;
              setBusy(true);
              const result = await request({ environmentId, input: { path: node.id } });
              setBusy(false);
              if (result._tag === "Success") setRequested(true);
            }}
          >
            {requested ? t("Access requested") : t("Request access")}
          </Button>
          {requested && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {t("Waiting for the area lead. This document opens here after approval.")}
              </p>
              <Button size="xs" variant="outline" onClick={refresh}>
                {t("Check access")}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type Scope = ThreadKnowledgeScope | "individual";

// Dev builds always show the sample map beside the real nodes so every layer is populated.
const withSampleNodes = (real: KnowledgeGraph["nodes"] = [], demo: DemoState) =>
  import.meta.env.DEV ? [...real, ...demoNodes(demo)] : real;

export function KnowledgeMap(props: {
  readonly cards: ReadonlyArray<ThreadContextCard>;
  readonly environmentId: EnvironmentId;
  readonly skills: ReadonlyArray<{ name: string; enabled: boolean }>;
  readonly onToggle: (scope: ThreadKnowledgeScope, enabled: boolean, areaId?: string) => void;
  readonly canToggle: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [individual, setIndividual] = useState(true);
  const [ready, setReady] = useState(false);
  const { active: sampleMap, state: demoState } = useDemoState(props.environmentId);
  const graph = useEnvironmentQuery(
    enterpriseEnvironment.knowledgeGraph({ environmentId: props.environmentId, input: {} }),
  );
  const status = useEnvironmentQuery(
    enterpriseEnvironment.status({ environmentId: props.environmentId, input: {} }),
  );
  const [hiddenLayers, setHiddenLayers] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [documentOpen, setDocumentOpen] = useState(false);
  const enabled = (scope: Scope) =>
    scope === "individual"
      ? individual
      : (props.cards.find((card) => card.scope === scope)?.enabled ?? true);
  const scopes = { general: enabled("general"), area: enabled("area"), individual };
  const sync = (next: typeof scopes) =>
    frame.current?.contentWindow?.postMessage({ type: "knowledge-scopes", scopes: next }, "*");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- synchronize the embedded graph when the hub confirms or rejects a scope change
  useEffect(() => {
    if (ready)
      frame.current?.contentWindow?.postMessage(
        {
          type: "knowledge-scopes",
          scopes: { general: scopes.general, area: scopes.area, individual: scopes.individual },
        },
        "*",
      );
  }, [ready, scopes.general, scopes.area, scopes.individual, frame]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribe to messages from the embedded knowledge graph
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === "knowledge-graph-ready") setReady(true);
      if (event.data?.type === "knowledge-layers") setHiddenLayers(event.data.hidden);
      if (event.data?.type === "knowledge-node-selected") setSelectedId(event.data.node.id);
      if (event.data?.type === "knowledge-selection-cleared") {
        setSelectedId(null);
        setDocumentOpen(false);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frame]);
  const realNodes = graph.data?.nodes;
  const previewNodes = withSampleNodes(realNodes, demoState);
  const nodes: KnowledgeNode[] = previewNodes.map((node) => ({
    ...node,
    path: node.id,
    kind: "document",
    scope:
      node.areaId === "personal" ? "individual" : node.areaId === "general" ? "general" : "area",
  }));
  const selected = nodes.find((node) => node.id === selectedId);
  const newIds = new Set(
    sampleMap ? demoState.added.filter((node) => node.isNew).map((node) => node.id) : [],
  );
  const dismissNew = () => clearDemoNew(props.environmentId);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- send metadata only to the sandboxed graph
  useEffect(() => {
    if (ready)
      frame.current?.contentWindow?.postMessage(
        {
          type: "knowledge-nodes",
          nodes: withSampleNodes(realNodes, demoState).map(
            ({ id, title, areaId, layer, links, ...node }) => ({
              id,
              title,
              areaId,
              layer,
              links,
              isNew: "isNew" in node && node.isNew === true,
              hub: "hub" in node && node.hub === true,
            }),
          ),
        },
        "*",
      );
  }, [ready, realNodes, demoState, frame]);
  const org = useEnvironmentQuery(
    enterpriseEnvironment.org({ environmentId: props.environmentId, input: {} }),
  );
  const areaName = (areaId: string) =>
    org.data?.teams.find((team) => team.id === areaId)?.name ?? areaId;
  const personalNodes = nodes.filter((node) => node.scope === "individual");
  const areaDocuments = props.cards.find((card) => card.scope === "area")?.documents ?? [];
  const areas = [...new Map(areaDocuments.map((doc) => [doc.areaId, doc])).values()];
  const nodeEnabled = (node: KnowledgeNode) =>
    enabled(node.scope) &&
    (node.scope !== "area" ||
      !node.path ||
      areaDocuments.find((doc) => doc.path === node.path)?.enabled !== false);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-5 sm:px-8">
      <div className="grid gap-3 py-5 sm:grid-cols-3">
        {(["general", "area", "individual"] as const).map((scope) => {
          const Icon =
            scope === "general" ? Building2Icon : scope === "area" ? Layers3Icon : UserRoundIcon;
          const title =
            scope === "general"
              ? t("Company knowledge")
              : scope === "area"
                ? t("Area knowledge")
                : t("Personal knowledge");
          const count = sampleMap
            ? nodes.filter((node) => node.scope === scope).length
            : scope === "individual"
              ? personalNodes.length
              : (props.cards.find((card) => card.scope === scope)?.documents.length ?? 0);
          const countLabel =
            scope === "individual"
              ? count === 1
                ? t("{count} item", { count })
                : t("{count} items", { count })
              : count === 1
                ? t("{count} document", { count })
                : t("{count} documents", { count });
          return (
            <button
              key={scope}
              type="button"
              aria-pressed={enabled(scope)}
              disabled={scope !== "individual" && !props.canToggle}
              onClick={() => {
                const next = { ...scopes, [scope]: !enabled(scope) };
                sync(next);
                if (scope === "individual") setIndividual(next.individual);
                else props.onToggle(scope, next[scope]);
              }}
              className={cn(
                "rounded-xl border p-4 text-left transition-colors hover:border-foreground/30 focus-visible:outline-2 focus-visible:outline-ring",
                enabled(scope)
                  ? "border-border bg-background shadow-sm"
                  : "border-border/50 bg-muted/30 opacity-55",
              )}
            >
              <div className="flex items-center justify-between">
                <Icon className="size-4 text-muted-foreground" />
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex h-4 w-7 items-center rounded-full p-0.5 transition-colors",
                    enabled(scope) ? "bg-primary" : "bg-muted-foreground/30",
                  )}
                >
                  <span
                    className={cn(
                      "size-3 rounded-full bg-background transition-transform",
                      enabled(scope) && "translate-x-3",
                    )}
                  />
                </span>
              </div>
              <div className="mt-5 text-sm font-medium">{title}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {scope === "general"
                  ? t("Shared across the organization")
                  : scope === "area"
                    ? t("Owned by your teams")
                    : t("Your private skills and files")}{" "}
                ·{" "}
                {sampleMap || graph.data
                  ? countLabel
                  : graph.error
                    ? t("Unavailable")
                    : t("Loading…")}
              </div>
            </button>
          );
        })}
      </div>
      {graph.data && !sampleMap && personalNodes.length === 0 && (
        <p className="mb-4 text-xs text-muted-foreground">
          {status.data?.identity
            ? t("No personal items for {email} yet. Add a skill or file in Ingest.", {
                email: status.data.identity.email,
              })
            : status.error
              ? t("Could not verify your connected identity.")
              : t("Connect to your hub to see personal knowledge.")}
        </p>
      )}
      {areas.length > 0 && (
        <fieldset
          className="mb-4 flex flex-wrap gap-3"
          disabled={!props.canToggle || !enabled("area")}
        >
          <legend className="mb-2 text-xs text-muted-foreground">
            {t("Areas for this conversation")}
          </legend>
          {areas.map((area) => (
            <label key={area.areaId} className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={area.enabled ?? true}
                disabled={area.enabled === undefined}
                onCheckedChange={(checked) => props.onToggle("area", checked === true, area.areaId)}
              />
              {areaName(area.areaId)}
            </label>
          ))}
        </fieldset>
      )}
      {SHOW_KNOWLEDGE_GRAPH && (
        <div className="flex items-center justify-between border-t border-border/60 py-3">
          <div>
            <h3 className="text-sm font-medium">{t("Knowledge map")}</h3>
            <p className="text-xs text-muted-foreground">
              {t("Drag to orbit · scroll to zoom · select a node")}
            </p>
          </div>
          <span className="text-xs text-muted-foreground">{t("Current context")}</span>
        </div>
      )}
      {graph.error && !sampleMap && <p role="alert">{graph.error}</p>}
      {sampleMap && (
        <p className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
          {t("Sample map · the uploaded files have not been analyzed")}
          {newIds.size > 0 && (
            <>
              <span className="rounded-full bg-warning/16 px-2 py-0.5 font-medium text-warning-foreground">
                {t("{count} new", { count: String(newIds.size) })}
              </span>
              <button type="button" className="underline" onClick={dismissNew}>
                {t("Dismiss")}
              </button>
            </>
          )}
        </p>
      )}
      {graph.data?.nodes.length === 0 && !sampleMap && (
        <p className="py-4 text-sm text-muted-foreground">
          {t("No knowledge yet. Ask an admin to load a bucket in Ingest.")}
        </p>
      )}
      <div
        className={cn(
          "overflow-hidden rounded-xl border border-border/70",
          SHOW_KNOWLEDGE_GRAPH
            ? "grid min-h-[470px] flex-1 bg-zinc-25 lg:grid-cols-[minmax(0,1fr)_230px]"
            : "bg-background",
        )}
      >
        {SHOW_KNOWLEDGE_GRAPH && (
          <div className="relative min-h-[470px] overflow-hidden">
            {!ready && (
              <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">
                {t("Loading knowledge map…")}
              </div>
            )}
            <iframe
              ref={frame}
              title={t("Interactive 3D knowledge map")}
              sandbox="allow-scripts"
              src="/context-graph/index.html"
              className="relative size-full min-h-[470px] border-0"
              onLoad={() => {
                setReady(true);
                sync(scopes);
              }}
            />
            {selected && nodeEnabled(selected) && !hiddenLayers.includes(selected.layer) && (
              <div className="absolute right-4 top-14 z-10 max-h-[min(350px,65%)] w-[min(260px,90%)] overflow-auto rounded-xl border border-border bg-background/95 p-4 shadow-lg">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-3xs text-muted-foreground uppercase">
                      {layerLabel(selected.layer)} · {t("document")}
                    </p>
                    <p className="text-xs font-medium">
                      {selected.title}
                      {newIds.has(selected.id) && (
                        <span className="ml-2 rounded-full bg-warning/16 px-1.5 py-0.5 text-3xs font-medium text-warning-foreground">
                          {t("New")}
                        </span>
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground"
                    onClick={() => {
                      setSelectedId(null);
                      if (newIds.has(selected.id)) dismissNew();
                      frame.current?.contentWindow?.postMessage(
                        { type: "knowledge-clear-selection" },
                        "*",
                      );
                    }}
                  >
                    {t("Close")}
                  </button>
                </div>
                {sampleMap ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {selected.description} · {areaName(selected.areaId)} · {t("Sample map")}
                  </p>
                ) : (
                  <KnowledgeDocument
                    key={selected.id}
                    node={selected}
                    environmentId={props.environmentId}
                    areaName={areaName(selected.areaId)}
                    refresh={graph.refresh}
                  />
                )}
                {selected.accessible && !sampleMap && (
                  <button
                    type="button"
                    className="mt-3 rounded-md border px-2 py-1 text-xs"
                    onClick={() => setDocumentOpen(true)}
                  >
                    {t("Open document ↗")}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        <aside
          className={cn(
            "flex flex-col bg-background",
            SHOW_KNOWLEDGE_GRAPH &&
              "max-h-[530px] border-t border-border/70 lg:border-t-0 lg:border-l",
          )}
          aria-label={t("Knowledge by source and layer")}
        >
          <div
            className={cn(
              "border-b border-border/70 px-4 py-3 font-medium",
              SHOW_KNOWLEDGE_GRAPH ? "text-xs" : "text-sm",
            )}
          >
            {SHOW_KNOWLEDGE_GRAPH ? t("Knowledge") : t("What your assistant knows")}
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
            {(["general", "area", "individual"] as const).map((scope) => (
              <details
                key={scope}
                // Keep the personal inventory folded without changing the graph layout.
                open={!SHOW_KNOWLEDGE_GRAPH && scope !== "individual"}
                className={cn("py-2", !enabled(scope) && "opacity-40")}
              >
                <summary
                  className={cn(
                    "cursor-pointer px-2 font-semibold tracking-widest text-muted-foreground uppercase",
                    SHOW_KNOWLEDGE_GRAPH ? "text-3xs" : "text-xs",
                  )}
                >
                  {scope === "general"
                    ? t("Company")
                    : scope === "area"
                      ? t("Your areas")
                      : t("Personal")}
                </summary>
                {!SHOW_KNOWLEDGE_GRAPH &&
                  (scope === "individual"
                    ? personalNodes.length === 0
                    : !nodes.some((node) => node.scope === scope)) && (
                    <p className="px-4 py-1 text-xs text-muted-foreground">
                      {t("Nothing here yet")}
                    </p>
                  )}
                {LAYERS.map((layer) => {
                  const entries = nodes.filter(
                    (node) =>
                      node.scope === scope && node.layer === layer && !hiddenLayers.includes(layer),
                  );
                  return (
                    entries.length > 0 && (
                      <details key={layer} open={!SHOW_KNOWLEDGE_GRAPH} className="mt-2 pl-2">
                        <summary
                          className={cn(
                            "cursor-pointer px-2 text-muted-foreground",
                            SHOW_KNOWLEDGE_GRAPH ? "text-3xs" : "text-xs",
                          )}
                        >
                          {layerLabel(layer)}
                        </summary>
                        {entries.map((node) => (
                          <button
                            key={node.id}
                            type="button"
                            disabled={!nodeEnabled(node)}
                            className={cn(
                              "block w-full truncate rounded-md px-2 py-1 text-left text-xs hover:bg-muted",
                              selected?.id === node.id && "bg-muted font-medium",
                            )}
                            onClick={() => {
                              setSelectedId(node.id);
                              // With no map to show the node's card, a document opens straight away.
                              if (!SHOW_KNOWLEDGE_GRAPH) setDocumentOpen(true);
                              if (SHOW_KNOWLEDGE_GRAPH)
                                frame.current?.contentWindow?.postMessage(
                                  { type: "knowledge-focus", id: node.id },
                                  "*",
                                );
                            }}
                          >
                            {node.title}
                          </button>
                        ))}
                      </details>
                    )
                  );
                })}
              </details>
            ))}
          </div>
        </aside>
      </div>
      {documentOpen &&
        selected &&
        nodeEnabled(selected) &&
        !hiddenLayers.includes(selected.layer) && (
          <div className="absolute inset-0 z-10 flex flex-col bg-background px-5 py-5 sm:px-8">
            <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
              <div>
                <p className="text-xs text-muted-foreground">
                  {selected.scope} / {selected.layer} /{" "}
                  {selected.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md
                </p>
                <h3 className="mt-1 text-base font-medium">{selected.title}</h3>
              </div>
              <button
                type="button"
                className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
                onClick={() => setDocumentOpen(false)}
              >
                {SHOW_KNOWLEDGE_GRAPH ? t("Back to map") : t("Back")}
              </button>
            </div>
            <KnowledgeDocument
              key={selected.id}
              node={selected}
              environmentId={props.environmentId}
              areaName={areaName(selected.areaId)}
              refresh={graph.refresh}
            />
          </div>
        )}
    </div>
  );
}
