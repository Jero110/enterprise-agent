import type { EnvironmentId, ThreadContextCard, ThreadKnowledgeScope } from "@t3tools/contracts";
import { Building2Icon, Layers3Icon, UserRoundIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { t } from "~/i18n";
import { cn } from "~/lib/utils";
import { enterpriseEnvironment } from "~/state/enterprise";
import { useEnvironmentQuery } from "~/state/query";

import { Checkbox } from "../ui/checkbox";
import { SHOW_KNOWLEDGE_GRAPH } from "./proposalGraph";

const LAYERS = ["metrics", "business", "arch", "data"] as const;
type KnowledgeNode = {
  id: string;
  title: string;
  layer: string;
  scope: Scope;
  path?: string;
  kind?: "source" | "document";
  owner?: string;
  connections?: string[];
};

function layerLabel(layer: string): string {
  if (layer === "arch") return t("AI architecture");
  return t(layer[0]?.toUpperCase() + layer.slice(1));
}

function KnowledgeDocument({
  environmentId,
  node,
  expanded = false,
}: {
  environmentId: EnvironmentId;
  node: KnowledgeNode;
  expanded?: boolean;
}) {
  const path = node.path;
  if (!path)
    return (
      <pre
        className={cn(
          "mt-3 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground",
          expanded ? "flex-1" : "max-h-52",
        )}
      >{`# ${node.title}\n\n> ${t("Preview document. No knowledge source is attached to this node yet.")}\n\n## ${layerLabel(node.layer)}\n\n${t("This is where the knowledge for {title} will appear.", { title: node.title })}`}</pre>
    );
  return <ActualKnowledgeDocument environmentId={environmentId} path={path} expanded={expanded} />;
}

function ActualKnowledgeDocument({
  environmentId,
  path,
  expanded,
}: {
  environmentId: EnvironmentId;
  path: string;
  expanded: boolean;
}) {
  const document = useEnvironmentQuery(
    enterpriseEnvironment.knowledgeGet({ environmentId, input: { path } }),
  );
  return (
    <pre
      className={cn(
        "mt-3 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground",
        expanded ? "flex-1" : "max-h-52",
      )}
    >
      {document.error ?? document.data?.content ?? t("Loading document…")}
    </pre>
  );
}

type Scope = ThreadKnowledgeScope | "individual";

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
  const [previewNodes, setPreviewNodes] = useState<KnowledgeNode[]>([]);
  const [hiddenLayers, setHiddenLayers] = useState<string[]>([]);
  const [selected, setSelected] = useState<KnowledgeNode | null>(null);
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
      if (event.data?.type === "knowledge-graph-ready") setPreviewNodes(event.data.nodes);
      if (event.data?.type === "knowledge-layers") setHiddenLayers(event.data.hidden);
      if (event.data?.type === "knowledge-node-selected") setSelected(event.data.node);
      if (event.data?.type === "knowledge-selection-cleared") {
        setSelected(null);
        setDocumentOpen(false);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frame]);
  const documents: KnowledgeNode[] = props.cards.flatMap((card) =>
    card.documents.map((doc) => ({
      id: `${card.scope}:${doc.path}`,
      title: doc.title,
      scope: card.scope,
      path: doc.path,
      kind: "document",
      layer: /metric|kpi|report/i.test(doc.path)
        ? "metrics"
        : /business|policy|customer/i.test(doc.path)
          ? "business"
          : /skill|agent|cli|mcp|architect/i.test(doc.path)
            ? "arch"
            : "data",
    })),
  );
  // Without the 3D map only real documents are listed; the map's sample nodes stay out.
  const nodes = SHOW_KNOWLEDGE_GRAPH ? [...previewNodes, ...documents] : documents;
  const org = useEnvironmentQuery(
    enterpriseEnvironment.org({ environmentId: props.environmentId, input: {} }),
  );
  const areaName = (areaId: string) =>
    org.data?.teams.find((team) => team.id === areaId)?.name ?? areaId;
  const enabledSkills = props.skills.filter((skill) => skill.enabled);
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
          const count =
            scope === "individual"
              ? enabledSkills.length
              : (props.cards.find((card) => card.scope === scope)?.documents.length ?? 0);
          const countLabel =
            scope === "individual"
              ? t("{count} skills", { count })
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
                    : t("Your skills and tools")}{" "}
                · {countLabel}
              </div>
            </button>
          );
        })}
      </div>
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
          <span className="text-xs text-muted-foreground">
            {t("Current context · preview nodes")}
          </span>
        </div>
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
                      {layerLabel(selected.layer)} ·{" "}
                      {selected.kind === "source" ? t("source") : t("document")}
                    </p>
                    <p className="text-xs font-medium">{selected.title}</p>
                  </div>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground"
                    onClick={() => {
                      setSelected(null);
                      frame.current?.contentWindow?.postMessage(
                        { type: "knowledge-clear-selection" },
                        "*",
                      );
                    }}
                  >
                    {t("Close")}
                  </button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {selected.kind === "source"
                    ? t("Source owned by {owner}.", { owner: selected.owner ?? t("your team") })
                    : selected.path
                      ? t("Knowledge document in your current context.")
                      : t("Preview document linked to this source.")}
                </p>
                {selected.connections && selected.connections.length > 0 && (
                  <details className="mt-2 text-xs text-muted-foreground">
                    <summary className="cursor-pointer">
                      {t("Connections")} · {selected.connections.length}
                    </summary>
                    <ul className="mt-1 max-h-24 overflow-auto pl-3">
                      {[...new Set(selected.connections)].map((name) => (
                        <li key={name} className="truncate py-0.5">
                          {name}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {selected.kind === "document" && selected.path && (
                  <button
                    type="button"
                    className="mt-3 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
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
                // Personal lists the device's skill ids; keep it folded so the list stays about company knowledge.
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
                  scope === "individual" &&
                  enabledSkills.map((skill) => (
                    <p key={skill.name} className="truncate px-4 py-1 text-xs">
                      {skill.name}
                    </p>
                  ))}
                {!SHOW_KNOWLEDGE_GRAPH &&
                  (scope === "individual"
                    ? enabledSkills.length === 0
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
                              setSelected(node);
                              // With no map to show the node's card, a document opens straight away.
                              if (!SHOW_KNOWLEDGE_GRAPH && node.path) setDocumentOpen(true);
                              if (!node.path)
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
            <KnowledgeDocument environmentId={props.environmentId} node={selected} expanded />
          </div>
        )}
    </div>
  );
}
