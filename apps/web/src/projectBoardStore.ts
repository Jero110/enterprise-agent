import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

export const PROJECT_BOARD_STORAGE_KEY = "t3code:project-boards:v1";

export const PROJECT_TASK_STATUSES = ["backlog", "in_progress", "blocked", "complete"] as const;
export type ProjectTaskStatus = (typeof PROJECT_TASK_STATUSES)[number];

export const PROJECT_TASK_PRIORITIES = ["urgent", "high", "normal", "low"] as const;
export type ProjectTaskPriority = (typeof PROJECT_TASK_PRIORITIES)[number];

export const PROJECT_TASK_STATUS_LABELS: Record<ProjectTaskStatus, string> = {
  backlog: "Backlog",
  in_progress: "In progress",
  blocked: "Blocked",
  complete: "Complete",
};

export const PROJECT_TASK_PRIORITY_LABELS: Record<ProjectTaskPriority, string> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
};

export interface ProjectTask {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly status: ProjectTaskStatus;
  readonly priority: ProjectTaskPriority | null;
  /** Initials, e.g. "AM". */
  readonly assignees: ReadonlyArray<string>;
  readonly tags: ReadonlyArray<string>;
  /** `YYYY-MM-DD`. */
  readonly dueDate: string | null;
}

export interface ProjectBoard {
  readonly id: string;
  readonly name: string;
  readonly tasks: ReadonlyArray<ProjectTask>;
}

export type ProjectTaskDraft = Omit<ProjectTask, "id">;

interface ProjectBoardState {
  readonly boards: ReadonlyArray<ProjectBoard>;
  readonly activeBoardId: string;
  selectBoard: (boardId: string) => void;
  addBoard: (name: string) => void;
  renameBoard: (boardId: string, name: string) => void;
  deleteBoard: (boardId: string) => void;
  addTask: (boardId: string, task: ProjectTaskDraft) => void;
  updateTask: (boardId: string, taskId: string, patch: Partial<ProjectTaskDraft>) => void;
  deleteTask: (boardId: string, taskId: string) => void;
}

const newId = () => crypto.randomUUID();

function seedTask(
  status: ProjectTaskStatus,
  title: string,
  rest: Partial<Omit<ProjectTaskDraft, "status" | "title">> = {},
): ProjectTask {
  return {
    id: newId(),
    title,
    description: "",
    status,
    priority: null,
    assignees: [],
    tags: [],
    dueDate: null,
    ...rest,
  };
}

function seedBoards(): ProjectBoard[] {
  return [
    {
      id: newId(),
      name: "DS - PE",
      tasks: [
        seedTask("backlog", "QA métricas asesores", { assignees: ["GG"], tags: ["asesores"] }),
        seedTask("backlog", "data - panda", { assignees: ["AM"], priority: "normal", tags: ["pe"] }),
        seedTask("backlog", "terrenos - costos", { assignees: ["AM"], tags: ["pe"] }),
        seedTask("backlog", "Agente: DB Explorer", { assignees: ["GG"], priority: "low" }),
        seedTask("backlog", "Score de Leads"),
        seedTask("in_progress", "Analítica y Métricas de Monopolio", {
          assignees: ["AM", "GG", "IH"],
          priority: "high",
          tags: ["spike"],
        }),
        seedTask("in_progress", "QA berriozaval", {
          assignees: ["AM", "IH"],
          priority: "urgent",
          tags: ["catastro"],
        }),
        seedTask("in_progress", "medir error en estimación m2", {
          assignees: ["AM"],
          priority: "high",
          tags: ["catastro"],
        }),
        seedTask("in_progress", "liberación modelo lujo", { assignees: ["AM"], priority: "urgent" }),
        seedTask("in_progress", "continuación modelo de costos", {
          assignees: ["AM"],
          priority: "normal",
        }),
        seedTask("in_progress", "mapa de precios", { assignees: ["IH"], priority: "high" }),
        seedTask("in_progress", "liberar comparables 3 etapas", {
          assignees: ["IH"],
          priority: "high",
        }),
        seedTask("blocked", "venta de leads caso de estudio", {
          assignees: ["GG"],
          priority: "normal",
          dueDate: "2026-09-16",
        }),
        seedTask("blocked", "Homologación métricas hex Desarrollos y Asesores", {
          assignees: ["GG"],
        }),
        seedTask("blocked", "match de cuentas", {
          assignees: ["GG"],
          priority: "high",
          tags: ["catastro"],
        }),
        seedTask("blocked", "armar demo PE", { assignees: ["AM", "GG", "IH"], tags: ["pe"] }),
        seedTask("complete", "Metodología costos construcción", {
          assignees: ["AM"],
          priority: "normal",
          tags: ["pe"],
        }),
        seedTask("complete", "Incluir 'Avalúos' a shadow PE reentrenado", {
          assignees: ["GG"],
          priority: "high",
          tags: ["pe"],
        }),
        seedTask("complete", "Documentar tablas de Monopolio", {
          assignees: ["GG"],
          dueDate: "2026-10-13",
        }),
        seedTask("complete", "modelo pe comparable renta", { assignees: ["IH"], tags: ["pe"] }),
        seedTask("complete", "analizar datos berriozaval", {
          assignees: ["AM", "GG", "IH"],
          tags: ["catastro"],
        }),
        seedTask("complete", "encontrar tablas de valor berriozabal", {
          assignees: ["AM"],
          tags: ["catastro"],
        }),
        seedTask("complete", "ajustar precio por frente de manzana", {
          assignees: ["IH"],
          tags: ["catastro"],
        }),
        seedTask("complete", "Artefactos Reentreno PE"),
      ],
    },
  ];
}

const initialBoards = seedBoards();

function mapBoard(
  boards: ReadonlyArray<ProjectBoard>,
  boardId: string,
  update: (board: ProjectBoard) => ProjectBoard,
) {
  return boards.map((board) => (board.id === boardId ? update(board) : board));
}

export const useProjectBoardStore = create<ProjectBoardState>()(
  persist(
    (set) => ({
      boards: initialBoards,
      activeBoardId: initialBoards[0]!.id,
      selectBoard: (activeBoardId) => set({ activeBoardId }),
      addBoard: (name) => {
        const board: ProjectBoard = { id: newId(), name, tasks: [] };
        set((state) => ({ boards: [...state.boards, board], activeBoardId: board.id }));
      },
      renameBoard: (boardId, name) =>
        set((state) => ({ boards: mapBoard(state.boards, boardId, (b) => ({ ...b, name })) })),
      deleteBoard: (boardId) =>
        set((state) => {
          const boards = state.boards.filter((board) => board.id !== boardId);
          return {
            boards,
            activeBoardId:
              state.activeBoardId === boardId ? (boards[0]?.id ?? "") : state.activeBoardId,
          };
        }),
      addTask: (boardId, task) =>
        set((state) => ({
          boards: mapBoard(state.boards, boardId, (board) => ({
            ...board,
            tasks: [...board.tasks, { ...task, id: newId() }],
          })),
        })),
      updateTask: (boardId, taskId, patch) =>
        set((state) => ({
          boards: mapBoard(state.boards, boardId, (board) => ({
            ...board,
            tasks: board.tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task)),
          })),
        })),
      deleteTask: (boardId, taskId) =>
        set((state) => ({
          boards: mapBoard(state.boards, boardId, (board) => ({
            ...board,
            tasks: board.tasks.filter((task) => task.id !== taskId),
          })),
        })),
    }),
    {
      name: PROJECT_BOARD_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ boards: state.boards, activeBoardId: state.activeBoardId }),
    },
  ),
);
