import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  ProjectId,
  ProjectBoard,
  ProjectBoardSnapshot,
  ProjectTask,
} from "@t3tools/contracts";
import { createContext, useContext, useRef, useState, type ReactNode } from "react";

import { t } from "~/i18n";
import { randomUUID } from "~/lib/utils";
import { enterpriseEnvironment } from "~/state/enterprise";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";

type Draft = Omit<ProjectTask, "id">;
type Boards = ReadonlyArray<ProjectBoard>;
interface BoardActions {
  boards: Boards;
  /** The first read is still on its way: show a loading line, not the empty state. */
  loading: boolean;
  /** The first read failed; the status line above the board says so. */
  unavailable: boolean;
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
  // Edits show at once; the server copy takes over again once the query reaches the saved revision.
  const [optimistic, setOptimisticState] = useState<Boards | null>(null);
  const [awaitRevision, setAwaitRevision] = useState<number | null>(null);
  // Refs mirror that state for handlers: two edits in one tick must see each other.
  const optimisticRef = useRef<Boards | null>(null);
  const awaitRevisionRef = useRef<number | null>(null);
  // Newest snapshot this window saved; the query can lag behind a save that just returned.
  const latestRef = useRef<ProjectBoardSnapshot | null>(null);
  const inFlightRef = useRef(false);
  const pendingRef = useRef<Boards | null>(null);
  const setOptimistic = (next: Boards | null) => {
    optimisticRef.current = next;
    setOptimisticState(next);
  };
  const setAwaited = (revision: number | null) => {
    awaitRevisionRef.current = revision;
    setAwaitRevision(revision);
  };
  /** The optimistic copy stops counting once nothing is saving and the query holds the saved revision. */
  const superseded = (inFlight: boolean, awaited: number | null) =>
    !inFlight && awaited !== null && query.data !== null && query.data.revision >= awaited;

  const boards =
    (superseded(saving, awaitRevision) ? null : optimistic) ?? query.data?.boards ?? [];
  const baseRevision = (): number | null => {
    const latest = latestRef.current;
    if (latest !== null && (query.data === null || latest.revision >= query.data.revision)) {
      return latest.revision;
    }
    return query.data?.revision ?? null;
  };
  const fail = (message: string) => {
    pendingRef.current = null;
    latestRef.current = null;
    setOptimistic(null);
    setAwaited(null);
    setError(message);
  };
  const send = async (first: Boards) => {
    inFlightRef.current = true;
    setSaving(true);
    let current: Boards | null = first;
    while (current !== null) {
      pendingRef.current = null;
      const revision = baseRevision();
      if (revision === null) break;
      try {
        const result = await save({
          environmentId,
          input: { projectId, revision, boards: current },
        });
        if (result._tag !== "Success") {
          fail(t("Could not save the board. Refresh and try again."));
          break;
        }
        latestRef.current = result.value;
        setAwaited(result.value.revision);
      } catch {
        fail(t("Could not reach the server. Refresh and try again."));
        break;
      }
      // An edit made while this save was in flight goes next, on top of the revision just saved.
      current = pendingRef.current;
    }
    inFlightRef.current = false;
    setSaving(false);
  };
  const replace = (update: (current: Boards) => Boards) => {
    if (query.data === null || !allowed) return;
    const live = superseded(inFlightRef.current, awaitRevisionRef.current)
      ? null
      : optimisticRef.current;
    const next = update(live ?? query.data.boards);
    setOptimistic(next);
    setError(null);
    if (inFlightRef.current) {
      pendingRef.current = next;
      return;
    }
    void send(next);
  };
  const updateBoard = (id: string, update: (board: ProjectBoard) => ProjectBoard) => {
    replace((current) => current.map((board) => (board.id === id ? update(board) : board)));
  };
  const loading = query.data === null && query.error === null;
  const state: BoardActions = {
    boards,
    loading,
    unavailable: query.data === null && query.error !== null,
    activeBoardId,
    selectBoard,
    addBoard: (name) => {
      const id = randomUUID();
      replace((current) => [...current, { id, name, tasks: [] }]);
      selectBoard(id);
    },
    deleteBoard: (id) => {
      replace((current) => current.filter((board) => board.id !== id));
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
  // The server's own error text is English and technical; people only need what to do next.
  const status =
    query.error !== null
      ? t("Could not reach the server. Refresh and try again.")
      : (error ??
        (saving ? t("Saving…") : loading ? "" : t("Saved on this environment · Current project")));
  return (
    <BoardContext value={state}>
      <div className="flex items-center gap-2 px-6 py-2 text-xs text-muted-foreground">
        <span>{status}</span>
        <Button variant="ghost" size="xs" onClick={query.refresh}>
          {t("Refresh")}
        </Button>
      </div>
      <fieldset
        // Never on a save or a poll: dimming the board on each edit dropped focus mid-typing.
        // data === null still covers the first load.
        disabled={!allowed || query.data === null}
        className="flex min-h-0 flex-1 flex-col disabled:opacity-60"
      >
        {children}
      </fieldset>
    </BoardContext>
  );
}
