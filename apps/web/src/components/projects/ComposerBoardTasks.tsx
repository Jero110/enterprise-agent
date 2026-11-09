import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { SquareKanbanIcon, XIcon } from "lucide-react";

import { t } from "~/i18n";
import { projectBoardContextForMessage } from "~/projectBoardContext";
import { enterpriseEnvironment } from "~/state/enterprise";
import { useEnvironmentQuery } from "~/state/query";
import { dismissBoardContext, useBoardContextDismissals } from "./boardContextDismissals";

/**
 * The board tasks this draft will carry to the agent, shown while typing so nothing attaches
 * unseen; × keeps one out. Mounting it also keeps the project's board loaded (and polled), so
 * the send path finds the same tasks without the board dialog having been opened.
 */
export function ComposerBoardTasks(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | null;
  readonly draftKey: string;
  readonly prompt: string;
}) {
  const board = useEnvironmentQuery(
    props.projectId === null
      ? null
      : enterpriseEnvironment.projectBoard({
          environmentId: props.environmentId,
          input: { projectId: props.projectId },
        }),
  );
  const dismissed = useBoardContextDismissals(props.draftKey);
  const { items } = projectBoardContextForMessage(
    props.prompt,
    board.data?.boards ?? [],
    new Set(dismissed),
  );
  if (items.length === 0) return null;
  return (
    <div
      className="mb-2 flex flex-wrap items-center gap-1.5 text-xs"
      data-chat-composer-board-tasks="true"
    >
      <span className="flex items-center gap-1 text-muted-foreground">
        <SquareKanbanIcon aria-hidden className="size-3.5" />
        {t("Tasks that attach:")}
      </span>
      {items.map((item) => (
        <span
          key={item.contextId}
          className="flex max-w-56 items-center gap-0.5 rounded-full border border-primary/30 bg-primary/5 py-0.5 ps-2 pe-0.5"
        >
          <span className="min-w-0 truncate">
            {item.kind === "board" ? t("Board {name}", { name: item.title }) : item.title}
          </span>
          <button
            type="button"
            aria-label={t("Don't attach {name}", { name: item.title })}
            className="flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-primary/10 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            onClick={() => dismissBoardContext(props.draftKey, item.contextId)}
          >
            <XIcon aria-hidden className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
}
