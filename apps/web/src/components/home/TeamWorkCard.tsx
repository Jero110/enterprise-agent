import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { SquareKanbanIcon, UsersIcon } from "lucide-react";
import { memo, useState } from "react";

import { t } from "~/i18n";
import { enterpriseEnvironment, useEnterpriseStatus } from "~/state/enterprise";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { countUnreadIncoming } from "../enterprise/teamChats.logic";
import { ProjectsBoardDialog } from "../projects/ProjectsBoardDialog";
import { Button } from "../ui/button";
import { HOME_CARD_CLASS_NAME } from "./homeCard";

const SEPARATOR = <span className="mx-1">·</span>;

function countLabel(count: number, one: string, many: string): string {
  return count === 1 ? t(one) : t(many, { count });
}

/** The company side of the home screen: this project's board and what teammates share. */
export const TeamWorkCard = memo(function TeamWorkCard({
  environmentId,
  projectId,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { identity, isPending } = useEnterpriseStatus();
  const connected = identity !== null;
  const board = useEnvironmentQuery(
    connected ? enterpriseEnvironment.projectBoard({ environmentId, input: { projectId } }) : null,
  );
  const shared = useEnvironmentQuery(
    connected && primaryEnvironmentId !== null
      ? enterpriseEnvironment.teamThreads({ environmentId: primaryEnvironmentId, input: {} })
      : null,
  );
  const inbox = useEnvironmentQuery(
    connected && primaryEnvironmentId !== null
      ? enterpriseEnvironment.teamMessages({ environmentId: primaryEnvironmentId, input: {} })
      : null,
  );
  const [boardOpen, setBoardOpen] = useState(false);
  if (isPending) return null;

  if (!connected) {
    return (
      <div className={HOME_CARD_CLASS_NAME} data-home-team-work>
        <div className="flex items-center gap-2 font-medium text-foreground text-sm">
          <UsersIcon aria-hidden className="size-4 shrink-0 text-primary" />
          {t("Projects and team")}
        </div>
        <p className="text-muted-foreground text-xs">
          {t("Join your company's team to see its projects.")}
        </p>
      </div>
    );
  }

  const loading =
    (board.data === null && board.error === null) ||
    (shared.data === null && shared.error === null);
  const tasks = board.data?.boards.flatMap((entry) => entry.tasks) ?? [];
  const inProgress = tasks.filter((task) => task.status === "in_progress").length;
  const blocked = tasks.filter((task) => task.status === "blocked").length;
  // Every top-level shared chat, yours included, so the count matches the sidebar.
  const sharedThreads = (shared.data ?? []).filter((thread) => thread.parentThreadId === null);
  // The same count as the mail badge: anything a colleague sent you that you have not opened.
  const unreadMessages = countUnreadIncoming(inbox.data ?? []);

  return (
    <div className={HOME_CARD_CLASS_NAME} data-home-team-work>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 font-medium text-foreground text-sm">
          <SquareKanbanIcon aria-hidden className="size-4 shrink-0 text-primary" />
          {t("Projects and team")}
        </div>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="-my-1 -me-1.5"
          onClick={() => setBoardOpen(true)}
        >
          {t("Open board")}
        </Button>
      </div>
      {loading ? (
        <p className="truncate text-muted-foreground text-xs">{t("Loading…")}</p>
      ) : (
        <>
          <p className="truncate text-muted-foreground text-xs tabular-nums">
            {tasks.length === 0 ? (
              t("No tasks yet")
            ) : inProgress === 0 && blocked === 0 ? (
              countLabel(tasks.length, "1 task", "{count} tasks")
            ) : (
              <>
                {inProgress > 0
                  ? countLabel(inProgress, "1 in progress", "{count} in progress")
                  : null}
                {inProgress > 0 && blocked > 0 ? SEPARATOR : null}
                {blocked > 0 ? (
                  <span className="font-medium text-warning-foreground">
                    {countLabel(blocked, "1 blocked", "{count} blocked")}
                  </span>
                ) : null}
              </>
            )}
          </p>
          <p className="truncate text-muted-foreground text-xs tabular-nums">
            <UsersIcon aria-hidden className="me-1 inline size-3.5 align-[-0.15em]" />
            {unreadMessages > 0 ? (
              <>
                <span className="font-medium text-primary">
                  {countLabel(unreadMessages, "1 new message", "{count} new messages")}
                </span>
                {SEPARATOR}
              </>
            ) : null}
            {sharedThreads.length === 0
              ? unreadMessages > 0
                ? t("nothing shared yet")
                : t("Nothing shared yet")
              : countLabel(sharedThreads.length, "1 shared chat", "{count} shared chats")}
          </p>
        </>
      )}
      <ProjectsBoardDialog
        environmentId={environmentId}
        projectId={projectId}
        open={boardOpen}
        onOpenChange={setBoardOpen}
      />
    </div>
  );
});
