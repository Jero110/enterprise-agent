import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProjectBoard, ProjectTask } from "@t3tools/contracts";
import { createContext, useContext, useState, type ReactNode } from "react";

import { t } from "~/i18n";
import { randomUUID } from "~/lib/utils";
import { useProjectBoardStore } from "~/projectBoardStore";
import { enterpriseEnvironment } from "~/state/enterprise";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";

type Draft = Omit<ProjectTask, "id">;
interface BoardActions {
  boards: ReadonlyArray<ProjectBoard>;
  activeBoardId: string;
  selectBoard: (id: string) => void;
  addBoard: (name: string) => void;
  deleteBoard: (id: string) => void;
  addTask: (boardId: string, draft: Draft) => void;
  updateTask: (boardId: string, id: string, patch: Partial<Draft>) => void;
  deleteTask: (boardId: string, id: string) => void;
  moveTask: (
    boardId: string,
    id: string,
    to: { boardId: string; status: ProjectTask["status"] },
  ) => void;
}
const BoardContext = createContext<BoardActions | null>(null);
export function useProjectBoards<A>(select: (state: BoardActions) => A) {
  const state = useContext(BoardContext);
  if (state === null) throw new Error("Project board context is missing.");
  return select(state);
}

export function ProjectBoardProvider({
  environmentId,
  children,
}: {
  readonly environmentId: EnvironmentId;
  readonly children: ReactNode;
}) {
  const query = useEnvironmentQuery(
    enterpriseEnvironment.projectBoard({ environmentId, input: {} }),
  );
  const save = useAtomCommand(enterpriseEnvironment.saveProjectBoard);
  const allowed = useAtomValue(
    enterpriseEnvironment.saveProjectBoard.permissionAtom(environmentId),
  );
  const [activeBoardId, selectBoard] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const legacy = useProjectBoardStore((state) => state.boards);
  const [imported, setImported] = useState(false);
  const boards = query.data?.boards ?? [];
  const replace = async (next: ReadonlyArray<ProjectBoard>) => {
    if (query.data === null || !allowed || saving) return;
    setSaving(true);
    setError(null);
    let saved = false;
    try {
      const result = await save({
        environmentId,
        input: { revision: query.data.revision, boards: next },
      });
      if (result._tag === "Success") {
        saved = true;
      } else {
        setError(
          t("Could not save the board. Refresh and try again; your browser copy is preserved."),
        );
      }
    } catch {
      setError(t("Could not reach the server. Refresh and try again."));
    }
    setSaving(false);
    return saved;
  };
  const updateBoard = (id: string, update: (board: ProjectBoard) => ProjectBoard) => {
    void replace(boards.map((board) => (board.id === id ? update(board) : board)));
  };
  const state: BoardActions = {
    boards,
    activeBoardId,
    selectBoard,
    addBoard: (name) => {
      const id = randomUUID();
      void replace([...boards, { id, name, tasks: [] }]);
      selectBoard(id);
    },
    deleteBoard: (id) => {
      void replace(boards.filter((board) => board.id !== id));
    },
    addTask: (boardId, draft) =>
      updateBoard(boardId, (board) => ({
        ...board,
        tasks: [...board.tasks, { ...draft, id: randomUUID() }],
      })),
    updateTask: (boardId, id, patch) =>
      updateBoard(boardId, (board) => ({
        ...board,
        tasks: board.tasks.map((task) => (task.id === id ? { ...task, ...patch } : task)),
      })),
    moveTask: (boardId, id, to) => {
      const task = boards
        .find((board) => board.id === boardId)
        ?.tasks.find((entry) => entry.id === id);
      if (task === undefined) return;
      void replace(
        boards.map((board) => {
          const rest = board.tasks.filter((entry) => entry.id !== id);
          if (board.id === to.boardId) {
            return {
              ...board,
              tasks:
                board.id === boardId
                  ? board.tasks.map((entry) =>
                      entry.id === id ? { ...entry, status: to.status } : entry,
                    )
                  : [...rest, { ...task, status: to.status }],
            };
          }
          return board.id === boardId ? { ...board, tasks: rest } : board;
        }),
      );
    },
    deleteTask: (boardId, id) =>
      updateBoard(boardId, (board) => ({
        ...board,
        tasks: board.tasks.filter((task) => task.id !== id),
      })),
  };
  return (
    <BoardContext value={state}>
      <div className="flex items-center gap-2 px-6 py-2 text-xs text-muted-foreground">
        <span>
          {query.error ??
            error ??
            (saving
              ? t("Saving…")
              : query.data === null
                ? t("Loading…")
                : t("Saved on this environment · Your boards"))}
        </span>
        <Button variant="ghost" size="xs" onClick={query.refresh}>
          {t("Refresh")}
        </Button>
        {!imported && legacy.length > 0 && allowed && query.data !== null ? (
          <Button
            variant="ghost"
            size="xs"
            disabled={saving}
            onClick={() => {
              const copies = legacy.map((board) => ({
                ...board,
                id: randomUUID(),
                tasks: board.tasks.map((task) => ({ ...task, id: randomUUID() })),
              }));
              void replace([...boards, ...copies]).then((ok) => {
                if (ok) setImported(true);
              });
            }}
          >
            {t("Import browser boards into your boards")}
          </Button>
        ) : null}
      </div>
      <fieldset
        // Not query.isPending: the board polls every 10 s, and disabling on each refresh dimmed it
        // and dropped focus mid-typing. data === null still covers the first load.
        disabled={!allowed || saving || query.data === null || query.error !== null}
        className="flex min-h-0 flex-1 flex-col disabled:opacity-60"
      >
        {children}
      </fieldset>
    </BoardContext>
  );
}
