import { projectComposerContextForProvider } from "@t3tools/shared/composerContextReferences";
import { describe, expect, it } from "vitest";

import { projectBoardContextForMessage } from "./projectBoardContext";
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
  ],
};

const titles = (text: string) =>
  projectBoardContextForMessage(text, [board]).records.map((entry) => entry.label);

describe("projectBoardContextForMessage", () => {
  it.each([
    ["nothing on the board", "arregla el bug del login", []],
    ["a task title, ignoring case and accents", "cómo va MEDIR ERROR EN ESTIMACION M2?", ["DS - PE: medir error en estimación m2"]],
    ["every task with a mentioned tag", "qué falta de catastro", ["DS - PE: medir error en estimación m2", "DS - PE: match de cuentas"]],
    ["only whole words", "pero sin catastros", []],
    ["the whole board by name", "resume DS - PE", ["Tablero DS - PE"]],
    ["the whole board by keyword", "qué hay en el tablero", ["Tablero DS - PE"]],
  ])("attaches %s", (_case, text, expected) => {
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
