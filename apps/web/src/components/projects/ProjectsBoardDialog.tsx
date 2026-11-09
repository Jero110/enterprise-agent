import type { EnvironmentId } from "@t3tools/contracts";
import { ProjectBoardProvider, useProjectBoards } from "./ProjectBoardProvider";
import {
  CalendarIcon,
  FlagIcon,
  PlusIcon,
  SearchIcon,
  SquareKanbanIcon,
  TagIcon,
  Trash2Icon,
  UserRoundIcon,
} from "lucide-react";
import { useState, type CSSProperties, type DragEvent, type KeyboardEvent } from "react";

import { requestConfirmDialog } from "~/confirmDialog";
import { t } from "~/i18n";
import { cn } from "~/lib/utils";
import {
  PROJECT_TASK_PRIORITIES,
  PROJECT_TASK_PRIORITY_LABELS,
  PROJECT_TASK_STATUS_LABELS,
  PROJECT_TASK_STATUSES,
  type ProjectBoard,
  type ProjectTask,
  type ProjectTaskPriority,
  type ProjectTaskStatus,
} from "~/projectBoardStore";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const STATUS_STYLE: Record<ProjectTaskStatus, { pill: string; column: string }> = {
  backlog: {
    pill: "border border-border bg-background text-muted-foreground",
    column: "bg-muted/60",
  },
  in_progress: { pill: "bg-fuchsia-600 text-white", column: "bg-fuchsia-500/8" },
  blocked: { pill: "bg-red-500 text-white", column: "bg-red-500/8" },
  complete: { pill: "bg-emerald-500 text-white", column: "bg-emerald-500/8" },
};

const PRIORITY_COLOR: Record<ProjectTaskPriority, string> = {
  urgent: "text-destructive",
  high: "text-warning",
  normal: "text-info",
  low: "text-muted-foreground",
};

const PALETTE = ["#f97316", "#0ea5e9", "#52525b", "#a855f7", "#16a34a", "#e11d48", "#ca8a04"];

function paletteColor(key: string): string {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length]!;
}

const DUE_FORMAT = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

function formatDue(dueDate: string): string {
  const [year, month, day] = dueDate.split("-").map(Number);
  return DUE_FORMAT.format(new Date(year!, month! - 1, day!));
}

function isOverdue(task: ProjectTask): boolean {
  if (task.dueDate === null || task.status === "complete") return false;
  return task.dueDate < new Date().toISOString().slice(0, 10);
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function Avatars({ initials }: { readonly initials: ReadonlyArray<string> }) {
  if (initials.length === 0) {
    return (
      <span className="flex size-6 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground">
        <UserRoundIcon className="size-3.5" />
      </span>
    );
  }
  return (
    <span className="flex -space-x-1.5">
      {initials.map((initial) => (
        <span
          key={initial}
          className="flex size-6 items-center justify-center rounded-full text-3xs font-medium text-white ring-2 ring-background"
          style={{ backgroundColor: paletteColor(initial) }}
        >
          {initial.slice(0, 2).toUpperCase()}
        </span>
      ))}
    </span>
  );
}

function TaskCard(props: {
  readonly task: ProjectTask;
  readonly onOpen: () => void;
  readonly onMove: (to: { boardId: string; status: ProjectTaskStatus }) => void;
}) {
  const { task } = props;
  const boards = useProjectBoards((state) => state.boards);
  const activeBoardId = useProjectBoards((state) => state.activeBoardId);
  const current = boards.find((entry) => entry.id === activeBoardId) ?? boards[0];
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData("text/plain", task.id);
          event.dataTransfer.effectAllowed = "move";
        }}
        onClick={props.onOpen}
        className="w-full cursor-pointer rounded-lg border border-border/70 bg-card p-3 text-left shadow-xs transition-colors hover:border-border focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <p className="text-sm font-medium leading-snug text-foreground">{task.title}</p>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Avatars initials={task.assignees} />
          {task.dueDate !== null ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md border border-border/70 px-1.5 py-0.5",
                isOverdue(task) && "text-destructive",
              )}
            >
              <CalendarIcon className="size-3" />
              {formatDue(task.dueDate)}
            </span>
          ) : null}
          {task.priority !== null ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-border/70 px-1.5 py-0.5">
              <FlagIcon className={cn("size-3 fill-current", PRIORITY_COLOR[task.priority])} />
              {t(PROJECT_TASK_PRIORITY_LABELS[task.priority], undefined, "priority")}
            </span>
          ) : null}
          {task.tags.map((tag) => (
            <Badge
              key={tag}
              variant="label"
              style={{ "--label": paletteColor(tag) } as CSSProperties}
            >
              {tag}
            </Badge>
          ))}
        </div>
      </button>
      <select
        aria-label={t("Move to")}
        className="h-6 rounded-md border border-input bg-background px-1 text-xs text-muted-foreground"
        value=""
        onChange={(event) => {
          const [boardId, status] = event.target.value.split("|") as [string, ProjectTaskStatus];
          if (boardId) props.onMove({ boardId, status });
        }}
      >
        <option value="">{t("Move to…")}</option>
        {PROJECT_TASK_STATUSES.filter((status) => status !== task.status).map((status) => (
          <option key={status} value={`${current?.id}|${status}`}>
            {t(PROJECT_TASK_STATUS_LABELS[status])}
          </option>
        ))}
        {boards
          .filter((entry) => entry.id !== current?.id)
          .map((entry) => (
            <option key={entry.id} value={`${entry.id}|${task.status}`}>
              {t("Board")}: {entry.name}
            </option>
          ))}
      </select>
    </div>
  );
}

function BoardColumn(props: {
  readonly status: ProjectTaskStatus;
  readonly tasks: ReadonlyArray<ProjectTask>;
  readonly onOpenTask: (task: ProjectTask) => void;
  readonly onDropTask: (taskId: string) => void;
  readonly onMoveTask: (
    task: ProjectTask,
    to: { boardId: string; status: ProjectTaskStatus },
  ) => void;
  readonly onAddTask: (title: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const style = STATUS_STYLE[props.status];
  const submit = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") setAdding(false);
    if (event.key !== "Enter") return;
    const title = event.currentTarget.value.trim();
    if (title) props.onAddTask(title);
    event.currentTarget.value = "";
  };
  const drop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragOver(false);
    const taskId = event.dataTransfer.getData("text/plain");
    if (taskId) props.onDropTask(taskId);
  };
  return (
    <section
      aria-label={t(PROJECT_TASK_STATUS_LABELS[props.status])}
      className={cn(
        "flex max-h-full w-72 shrink-0 flex-col rounded-xl p-2",
        style.column,
        dragOver && "ring-2 ring-ring/60",
      )}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={drop}
    >
      <header className="flex items-center gap-2 px-1 pb-2 pt-1">
        <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold uppercase", style.pill)}>
          {t(PROJECT_TASK_STATUS_LABELS[props.status])}
        </span>
        <span className="text-xs text-muted-foreground">{props.tasks.length}</span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-0.5 pb-1">
        {props.tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            onOpen={() => props.onOpenTask(task)}
            onMove={(to) => props.onMoveTask(task, to)}
          />
        ))}
        {adding ? (
          <Input
            autoFocus
            size="sm"
            placeholder={t("Task name, Enter to add")}
            aria-label={t("New task in {column}", {
              column: t(PROJECT_TASK_STATUS_LABELS[props.status]),
            })}
            onKeyDown={submit}
            onBlur={() => setAdding(false)}
          />
        ) : (
          <Button
            className="justify-start"
            size="xs"
            variant="ghost-muted"
            onClick={() => setAdding(true)}
          >
            <PlusIcon />
            {t("Add Task")}
          </Button>
        )}
      </div>
    </section>
  );
}

const FIELD = "flex flex-col gap-1 text-xs font-medium text-muted-foreground";
const NATIVE_SELECT =
  "h-8 rounded-lg border border-input bg-background px-2 text-sm text-foreground dark:bg-input/32";

function TaskEditor(props: {
  readonly board: ProjectBoard;
  readonly task: ProjectTask;
  readonly onClose: () => void;
}) {
  const { board, task } = props;
  const updateTask = useProjectBoards((state) => state.updateTask);
  const deleteTask = useProjectBoards((state) => state.deleteTask);
  const update = (patch: Partial<ProjectTask>) => updateTask(board.id, task.id, patch);
  const remove = async () => {
    const confirmed =
      (await requestConfirmDialog(t('Delete "{title}"?', { title: task.title }), {
        variant: "destructive",
      })) ?? window.confirm(t('Delete "{title}"?', { title: task.title }));
    if (!confirmed) return;
    deleteTask(board.id, task.id);
    props.onClose();
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogPopup className="w-[min(520px,94vw)]" bottomStickOnMobile={false}>
        <div className="flex flex-col gap-4 p-6">
          <DialogTitle>{t("Edit task")}</DialogTitle>
          <label className={FIELD}>
            {t("Title")}
            <Input
              defaultValue={task.title}
              onBlur={(event) => {
                const title = event.currentTarget.value.trim();
                if (title && title !== task.title) update({ title });
              }}
            />
          </label>
          <label className={FIELD}>
            {t("Description")}
            <Textarea
              defaultValue={task.description}
              onBlur={(event) => update({ description: event.currentTarget.value })}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={FIELD}>
              {t("Status")}
              <select
                className={NATIVE_SELECT}
                value={task.status}
                onChange={(event) => update({ status: event.target.value as ProjectTaskStatus })}
              >
                {PROJECT_TASK_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {t(PROJECT_TASK_STATUS_LABELS[status])}
                  </option>
                ))}
              </select>
            </label>
            <label className={FIELD}>
              {t("Priority")}
              <select
                className={NATIVE_SELECT}
                value={task.priority ?? ""}
                onChange={(event) =>
                  update({
                    priority:
                      event.target.value === ""
                        ? null
                        : (event.target.value as ProjectTaskPriority),
                  })
                }
              >
                <option value="">{t("None", undefined, "priority")}</option>
                {PROJECT_TASK_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {t(PROJECT_TASK_PRIORITY_LABELS[priority], undefined, "priority")}
                  </option>
                ))}
              </select>
            </label>
            <label className={FIELD}>
              {t("Assignees (initials, comma separated)")}
              <Input
                defaultValue={task.assignees.join(", ")}
                onBlur={(event) => update({ assignees: splitList(event.currentTarget.value) })}
              />
            </label>
            <label className={FIELD}>
              {t("Due date")}
              <Input
                type="date"
                defaultValue={task.dueDate ?? ""}
                onBlur={(event) => update({ dueDate: event.currentTarget.value || null })}
              />
            </label>
          </div>
          <label className={FIELD}>
            <span className="inline-flex items-center gap-1">
              <TagIcon className="size-3" /> {t("Tags (comma separated)")}
            </span>
            <Input
              defaultValue={task.tags.join(", ")}
              onBlur={(event) => update({ tags: splitList(event.currentTarget.value) })}
            />
          </label>
          <div className="flex items-center justify-between pt-1">
            <Button size="sm" variant="destructive-outline" onClick={() => void remove()}>
              <Trash2Icon />
              {t("Delete")}
            </Button>
            <Button size="sm" onClick={props.onClose}>
              {t("Done")}
            </Button>
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

function BoardView() {
  const boards = useProjectBoards((state) => state.boards);
  const activeBoardId = useProjectBoards((state) => state.activeBoardId);
  const selectBoard = useProjectBoards((state) => state.selectBoard);
  const addBoard = useProjectBoards((state) => state.addBoard);
  const deleteBoard = useProjectBoards((state) => state.deleteBoard);
  const addTask = useProjectBoards((state) => state.addTask);
  const updateTask = useProjectBoards((state) => state.updateTask);
  const moveTask = useProjectBoards((state) => state.moveTask);
  const [query, setQuery] = useState("");
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [creatingBoard, setCreatingBoard] = useState(false);
  const board = boards.find((entry) => entry.id === activeBoardId) ?? boards[0];
  const editingTask = board?.tasks.find((task) => task.id === editingTaskId);
  const needle = query.trim().toLowerCase();
  const visibleTasks =
    board?.tasks.filter(
      (task) =>
        needle === "" ||
        task.title.toLowerCase().includes(needle) ||
        task.tags.some((tag) => tag.toLowerCase().includes(needle)) ||
        task.assignees.some((assignee) => assignee.toLowerCase().includes(needle)),
    ) ?? [];
  const removeBoard = async (target: ProjectBoard) => {
    const message = t('Delete board "{name}" and its {count} tasks?', {
      name: target.name,
      count: target.tasks.length,
    });
    const confirmed =
      (await requestConfirmDialog(message, { variant: "destructive" })) ?? window.confirm(message);
    if (confirmed) deleteBoard(target.id);
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/60 px-6 py-3">
        {creatingBoard ? (
          <Input
            autoFocus
            size="sm"
            className="w-56"
            placeholder={t("Board name, Enter to create")}
            aria-label={t("New board name")}
            onBlur={() => setCreatingBoard(false)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setCreatingBoard(false);
              if (event.key !== "Enter") return;
              const name = event.currentTarget.value.trim();
              if (name) addBoard(name);
              setCreatingBoard(false);
            }}
          />
        ) : (
          <select
            aria-label={t("Board")}
            className={NATIVE_SELECT}
            value={board?.id ?? ""}
            onChange={(event) => selectBoard(event.target.value)}
          >
            {boards.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        )}
        <Button size="xs" variant="ghost" onClick={() => setCreatingBoard(true)}>
          <PlusIcon />
          {t("New board")}
        </Button>
        {board ? (
          <Button size="xs" variant="ghost-destructive" onClick={() => void removeBoard(board)}>
            <Trash2Icon />
            {t("Delete board")}
          </Button>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <SearchIcon className="size-4 text-muted-foreground" />
          <Input
            size="sm"
            className="w-48"
            placeholder={t("Search tasks")}
            aria-label={t("Search tasks")}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </div>
      </div>
      {board ? (
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
          {PROJECT_TASK_STATUSES.map((status) => (
            <BoardColumn
              key={status}
              status={status}
              tasks={visibleTasks.filter((task) => task.status === status)}
              onOpenTask={(task) => setEditingTaskId(task.id)}
              onDropTask={(taskId) => updateTask(board.id, taskId, { status })}
              onMoveTask={(task, to) => {
                moveTask(board.id, task.id, to);
                if (to.boardId !== board.id) selectBoard(to.boardId);
              }}
              onAddTask={(title) =>
                addTask(board.id, {
                  title,
                  description: "",
                  status,
                  priority: null,
                  assignees: [],
                  tags: [],
                  dueDate: null,
                })
              }
            />
          ))}
        </div>
      ) : (
        <p className="p-6 text-sm text-muted-foreground">
          {t("No boards yet. Create one to start.")}
        </p>
      )}
      {board && editingTask ? (
        <TaskEditor
          key={editingTask.id}
          board={board}
          task={editingTask}
          onClose={() => setEditingTaskId(null)}
        />
      ) : null}
    </div>
  );
}

/** Project boards the user keeps here; mentioning a board, task or tag in a message gives the agent that context. */
export function ProjectsBoardButton({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t("Projects")}
              className="[-webkit-app-region:no-drag]"
              onClick={() => setOpen(true)}
            />
          }
        >
          <SquareKanbanIcon className="size-4" />
        </TooltipTrigger>
        <TooltipPopup side="bottom">{t("Projects")}</TooltipPopup>
      </Tooltip>
      <DialogPopup
        className="flex h-[min(860px,92dvh)] w-[min(1280px,96vw)] max-w-none flex-col overflow-hidden"
        bottomStickOnMobile={false}
      >
        <div className="shrink-0 border-b border-border/60 px-6 py-4">
          <DialogTitle>{t("Projects")}</DialogTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {t(
              "These are your boards on the connected server, the same in every project and private to your account. Ask your agent to read or move the cards. Browser boards can be imported; the original browser copy is kept.",
            )}
          </p>
        </div>
        {open && (
          <ProjectBoardProvider key={environmentId} environmentId={environmentId}>
            <BoardView />
          </ProjectBoardProvider>
        )}
      </DialogPopup>
    </Dialog>
  );
}
