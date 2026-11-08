import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProjectId, ProjectBoard, ProjectTask } from "@t3tools/contracts";
import { createContext, useContext, useState, type ReactNode } from "react";

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
}
const BoardContext = createContext<BoardActions | null>(null);
export function useProjectBoards<A>(select: (state: BoardActions) => A) {
  const state = useContext(BoardContext);
  if (state === null) throw new Error("Project board context is missing.");
  return select(state);
}

export function ProjectBoardProvider({
  environmentId,
  projectId,
  children,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly children: ReactNode;
}) {
  const query = useEnvironmentQuery(
    enterpriseEnvironment.projectBoard({ environmentId, input: { projectId } }),
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
        input: { projectId, revision: query.data.revision, boards: next },
      });
      if (result._tag === "Success") {
        saved = true;
      } else {
        setError(
          "Could not save the board. Refresh and try again; your browser copy is preserved.",
        );
      }
    } catch {
      setError("Could not reach the server. Refresh and try again.");
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
              ? "Saving…"
              : query.data === null
                ? "Loading…"
                : "Saved on this environment · Current project")}
        </span>
        <Button variant="ghost" size="xs" onClick={query.refresh}>
          Refresh
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
            Import browser boards into this project
          </Button>
        ) : null}
      </div>
      <fieldset
        disabled={
          !allowed || saving || query.isPending || query.data === null || query.error !== null
        }
        className="flex min-h-0 flex-1 flex-col disabled:opacity-60"
      >
        {children}
      </fieldset>
    </BoardContext>
  );
}
