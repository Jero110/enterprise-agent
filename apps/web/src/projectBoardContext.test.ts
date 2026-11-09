import { projectComposerContextForProvider } from "@t3tools/shared/composerContextReferences";
import { describe, expect, it } from "vite-plus/test";

import { projectBoardContextForMessage, taskTitleMatchScore } from "./projectBoardContext";
import type { ProjectBoard, ProjectTask } from "./projectBoardStore";

function task(id: string, title: string, rest: Partial<ProjectTask> = {}): ProjectTask {
  return {
    id,
    title,
    description: "",
    status: "backlog",
    priority: null,
    assignees: [],
    tags: [],
    dueDate: null,
    ...rest,
  };
}

const board: ProjectBoard = {
  id: "b1",
  name: "DS - PE",
  tasks: [
    task("t1", "armar demo PE", { status: "blocked", assignees: ["AM"], tags: ["pe"] }),
    task("t2", "medir error en estimación m2", { status: "in_progress", tags: ["catastro"] }),
    task("t3", "match de cuentas", { tags: ["catastro"] }),
    task("t4", "modelo comparable renta", { tags: ["pe"] }),
  ],
};

const titles = (text: string) =>
  projectBoardContextForMessage(text, [board]).records.map((entry) => entry.label);

describe("projectBoardContextForMessage", () => {
  it.each([
    ["nothing on the board", "arregla el bug del login", []],
    [
      "a task title, ignoring case and accents",
      "cómo va MEDIR ERROR EN ESTIMACION M2?",
      ["DS - PE: medir error en estimación m2"],
    ],
    [
      "every task with a mentioned tag",
      "qué falta de catastro",
      ["DS - PE: medir error en estimación m2", "DS - PE: match de cuentas"],
    ],
    ["only whole words", "pero sin catastros", []],
    [
      "only the task whose title holds a tag",
      "en qué estado está armar demo PE?",
      ["DS - PE: armar demo PE"],
    ],
    ["the whole board by name", "resume DS - PE", ["Tablero DS - PE"]],
    ["the whole board by keyword", "qué hay en el tablero", ["Tablero DS - PE"]],
    ["the board's cards by request", "lee las tarjetas", ["Tablero DS - PE"]],
    ["the whole board by 'mi tablero'", "resume mi tablero", ["Tablero DS - PE"]],
    ["the whole board by 'kanban'", "abre el kanban", ["Tablero DS - PE"]],
    ["nothing for an everyday question about tasks", "¿qué tareas tengo hoy?", []],
    ["nothing for an everyday mention of projects", "mis proyectos de esta semana", []],
  ] as const)("attaches %s", (_case, text, expected) => {
    expect(titles(text)).toEqual(expected);
  });

  it("reaches the provider prompt as a context envelope", () => {
    const context = projectBoardContextForMessage("ayúdame con armar demo PE", [board]);
    const prompt = projectComposerContextForProvider({
      text: `ayúdame con armar demo PE\n\n${context.references}`,
      records: context.records,
    });
    expect(prompt).toContain('<context kind="project-task"');
    expect(prompt).toContain('"status":"Blocked"');
    expect(prompt).toContain('"assignees":["AM"]');
  });
});

const marketing: ProjectBoard = {
  id: "b2",
  name: "Marketing",
  tasks: [
    task("m1", "Buscar % de la promo de octubre"),
    task("m2", "Reporte de ventas semanal"),
    task("m3", "Campaña de Navidad"),
    task("m4", "Revisar contrato con la agencia"),
    task("m5", "Promociones de fin de año"),
  ],
};

const marketingTitles = (text: string, excluded?: ReadonlySet<string>) =>
  projectBoardContextForMessage(text, [marketing], excluded).items.map((item) => item.title);

describe("automatic task matching", () => {
  it.each([
    [
      "a loose Spanish question",
      "¿cómo va lo de la promo de octubre?",
      ["Buscar % de la promo de octubre"],
    ],
    ["plurals and accents", "ya salieron los reportes de VENTAS?", ["Reporte de ventas semanal"]],
    [
      "a short title by one of its words",
      "qué falta para la campana de navidad",
      ["Campaña de Navidad"],
    ],
    [
      "a partial word",
      "cómo vamos con las promociones de octubre",
      ["Buscar % de la promo de octubre"],
    ],
    ["part of a title", "¿ya quedaron las promos de fin?", ["Promociones de fin de año"]],
    ["nothing for filler words alone", "hola, ¿qué tareas tengo hoy?", []],
    ["nothing for one shared word of a long title", "mándame el reporte", []],
  ] as const)("attaches %s", (_case, text, expected) => {
    expect(marketingTitles(text)).toEqual(expected);
  });

  it("ranks a named task above a loose match", () => {
    expect(
      taskTitleMatchScore("buscar % de la promo de octubre", "Buscar % de la promo de octubre"),
    ).toBeGreaterThan(taskTitleMatchScore("promo de octubre", "Buscar % de la promo de octubre"));
    expect(marketingTitles("promociones: la promo de octubre y Promociones de fin de año")).toEqual(
      ["Promociones de fin de año", "Buscar % de la promo de octubre"],
    );
  });

  it("caps the tasks at five", () => {
    const many: ProjectBoard = {
      id: "b3",
      name: "Ops",
      tasks: Array.from({ length: 8 }, (_, index) =>
        task(`o${index}`, `inventario bodega ${index}`),
      ),
    };
    const context = projectBoardContextForMessage("revisa el inventario de la bodega", [many]);
    expect(context.records).toHaveLength(5);
    expect(context.items).toHaveLength(5);
  });

  it("leaves out the tasks the user removed", () => {
    const context = projectBoardContextForMessage("¿cómo va la promo de octubre?", [marketing]);
    const removed = new Set([context.items[0]!.contextId]);
    expect(marketingTitles("¿cómo va la promo de octubre?", removed)).toEqual([]);
    expect(
      projectBoardContextForMessage("¿cómo va la promo de octubre?", [marketing], removed),
    ).toEqual({
      references: "",
      records: [],
      items: [],
    });
  });

  it("ignores the context links already in the draft", () => {
    expect(marketingTitles("[x](t3-context:project-task/project-task_promo-octubre)")).toEqual([]);
  });
});
