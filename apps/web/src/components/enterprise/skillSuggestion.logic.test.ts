import type { ServerProviderSkill } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  mentionsSkill,
  noteWithoutSkillCommand,
  rankSkillsForMessage,
} from "./skillSuggestion.logic";

function skill(name: string, description?: string): ServerProviderSkill {
  return {
    name,
    path: `/home/me/.claude/skills/${name}/SKILL.md`,
    enabled: true,
    ...(description === undefined ? {} : { description }),
  } as ServerProviderSkill;
}

describe("mentionsSkill", () => {
  it("notices a skill mentioned in Spanish or English", () => {
    expect(mentionsSkill("Te quiero mandar una skill")).toBe(true);
    expect(mentionsSkill("¿Te comparto mis skills?")).toBe(true);
    expect(mentionsSkill("Te envío una habilidad para reportes")).toBe(true);
    expect(mentionsSkill("Habilidades nuevas")).toBe(true);
    expect(mentionsSkill("I want to send you a Skill")).toBe(true);
  });

  it("notices the /skill command", () => {
    expect(mentionsSkill("/skill")).toBe(true);
    expect(mentionsSkill("mira esto /skill")).toBe(true);
  });

  it("stays quiet for ordinary messages and words that only contain skill", () => {
    expect(mentionsSkill("")).toBe(false);
    expect(mentionsSkill("¿Comemos a las 2?")).toBe(false);
    expect(mentionsSkill("He is very skillful")).toBe(false);
    expect(mentionsSkill("Es muy hábil")).toBe(false);
  });
});

describe("noteWithoutSkillCommand", () => {
  it("drops the /skill command and keeps the rest as the note", () => {
    expect(noteWithoutSkillCommand("/skill para tus reportes")).toBe("para tus reportes");
    expect(noteWithoutSkillCommand("Mira esta /skill  que hice")).toBe("Mira esta que hice");
    expect(noteWithoutSkillCommand("/skill")).toBe("");
  });

  it("leaves plain text alone", () => {
    expect(noteWithoutSkillCommand("Te mando una skill para ventas")).toBe(
      "Te mando una skill para ventas",
    );
  });
});

describe("rankSkillsForMessage", () => {
  const skills = [
    skill("pdf-tools", "Read and fill PDF forms"),
    skill("reporte-ventas", "Arma el reporte semanal de ventas"),
    skill("deploy"),
  ];

  it("puts skills that match the message first", () => {
    expect(
      rankSkillsForMessage(skills, "Te mando una skill para el reporte de ventas").map(
        (entry) => entry.name,
      ),
    ).toEqual(["reporte-ventas", "pdf-tools", "deploy"]);
  });

  it("weighs the name above the description and ignores accents", () => {
    const ranked = rankSkillsForMessage(
      [skill("notas", "Hace un pdf de la junta"), skill("pdf-tools")],
      "compartir la skill de PDF",
    );
    expect(ranked.map((entry) => entry.name)).toEqual(["pdf-tools", "notas"]);
    expect(
      rankSkillsForMessage(skills, "habilidad de reporte semanal").map((entry) => entry.name)[0],
    ).toBe("reporte-ventas");
  });

  it("keeps the usual order when nothing matches", () => {
    expect(rankSkillsForMessage(skills, "/skill").map((entry) => entry.name)).toEqual([
      "pdf-tools",
      "reporte-ventas",
      "deploy",
    ]);
  });
});

describe("rankSkillsForMessage across languages", () => {
  it("puts an English-named skill first for a Spanish word with the same stem or topic", () => {
    const skills = [
      skill("contribution-triage", "Close ineligible pull requests"),
      skill("copywriting", "Write marketing copy for landing pages"),
      skill("presentations", "Build slide decks"),
      skill("spreadsheets", "Edit Excel workbooks"),
    ];
    expect(
      rankSkillsForMessage(skills, "te mando una skill para hacer presentaciones")[0]?.name,
    ).toBe("presentations");
    expect(rankSkillsForMessage(skills, "una skill para hojas de cálculo")[0]?.name).toBe(
      "spreadsheets",
    );
    expect(rankSkillsForMessage(skills, "skill para textos de ventas")[0]?.name).toBe(
      "copywriting",
    );
  });
});
