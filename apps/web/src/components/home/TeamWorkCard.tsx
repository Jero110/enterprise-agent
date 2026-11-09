import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { SquareKanbanIcon, UsersIcon } from "lucide-react";
import { memo, useState } from "react";

import { t } from "~/i18n";
import { enterpriseEnvironment, useEnterpriseStatus } from "~/state/enterprise";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { ProjectsBoardDialog } from "../projects/ProjectsBoardDialog";
import { Button } from "../ui/button";

const CARD_CLASS_NAME =
  "-mt-2 mx-auto hidden w-full min-w-0 flex-col gap-1.5 rounded-xl border border-border/70 bg-card/60 px-3 py-2.5 text-left shadow-xs sm:w-[calc(50%-0.25rem)] [@media(min-height:44rem)]:flex";

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
      <div className={CARD_CLASS_NAME} data-home-team-work>
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

  const tasks = board.data?.boards.flatMap((entry) => entry.tasks) ?? [];
  const inProgress = tasks.filter((task) => task.status === "in_progress").length;
  const blocked = tasks.filter((task) => task.status === "blocked").length;
  const teammateThreads = (shared.data ?? []).filter(
    (thread) => thread.ownerEmail !== identity.email && thread.parentThreadId === null,
  );

  const unreadMessages = (inbox.data ?? []).filter(
    (message) => !message.outgoing && message.status === "unread",
  ).length;

  return (
    <div className={CARD_CLASS_NAME} data-home-team-work>
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
      <p className="truncate text-muted-foreground text-xs tabular-nums">
        {tasks.length === 0 ? (
          t("No tasks yet")
        ) : (
          <>
            {countLabel(inProgress, "1 in progress", "{count} in progress")}
            {blocked > 0 ? (
              <>
                <span className="mx-1">·</span>
                <span className="font-medium text-warning-foreground">
                  {countLabel(blocked, "1 blocked", "{count} blocked")}
                </span>
              </>
            ) : null}
          </>
        )}
        <span className="mx-1">·</span>
        <UsersIcon aria-hidden className="me-1 inline size-3.5 align-[-0.15em]" />
        {teammateThreads.length === 0
          ? t("nothing shared yet")
          : countLabel(teammateThreads.length, "1 shared chat", "{count} shared chats")}
        {unreadMessages > 0 ? (
          <>
            <span className="mx-1">·</span>
            <span className="font-medium text-primary">
              {countLabel(unreadMessages, "1 new message", "{count} new messages")}
            </span>
          </>
        ) : null}
      </p>
      <ProjectsBoardDialog
        environmentId={environmentId}
        projectId={projectId}
        open={boardOpen}
        onOpenChange={setBoardOpen}
      />
    </div>
  );
});
