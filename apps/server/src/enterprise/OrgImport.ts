import {
  EnterpriseError,
  type EnterpriseOrgChange,
  type EnterpriseOrgFiles,
  TeamMemberRole,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { parse as parseYaml } from "yaml";

import { GENERAL_AREA } from "../knowledge/KnowledgeRepo.ts";
import { type EnterpriseMember, type EnterpriseTeam, normalizeEmail } from "./EnterpriseStore.ts";

export interface OrgArea {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
}

export interface OrgPerson {
  readonly email: string;
  readonly displayName: string;
  readonly areaId: string;
  readonly role: TeamMemberRole;
  readonly reportsTo: string | null;
}

export interface OrgPlan {
  readonly areas: ReadonlyArray<OrgArea>;
  readonly people: ReadonlyArray<OrgPerson>;
}

const AreasFile = Schema.Struct({
  areas: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      description: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
  ),
});

const OrganizationFile = Schema.Struct({
  people: Schema.Array(
    Schema.Struct({
      email: Schema.String,
      name: Schema.String,
      area: Schema.String,
      role: TeamMemberRole,
      reportsTo: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
  ),
});

export const template = {
  areas: `# areas.yaml: one entry per area (team) of the company.
# id: lowercase letters, digits and dashes; "general" is reserved for company-wide knowledge.
areas:
  - id: payments
    name: Payments
    description: Card and transfer processing.
  - id: risk
    name: Risk
`,
  organization: `# organization.yaml: one entry per person.
# area: an id from areas.yaml.
# role: admin (manages the enterprise), lead (leads their area and approves access to it) or member.
#   Each area has at most one lead.
# reportsTo: the email of the person's manager; omit it at the top of the chart.
people:
  - email: maria@example.com
    name: María
    area: payments
    role: admin
  - email: ana@example.com
    name: Ana
    area: payments
    role: lead
    reportsTo: maria@example.com
  - email: bruno@example.com
    name: Bruno
    area: payments
    role: member
    reportsTo: ana@example.com
  - email: rosa@example.com
    name: Rosa
    area: risk
    role: lead
    reportsTo: maria@example.com
`,
} as const satisfies EnterpriseOrgFiles;

const fail = (code: EnterpriseError["code"], message: string) =>
  Effect.fail(new EnterpriseError({ code, message }));

const AREA_ID = /^[a-z0-9][a-z0-9-]*$/;
const EMAIL = /^[^\s@]+@[^\s@]+$/;

const readYaml = <S extends Schema.Decoder<unknown>>(file: string, text: string, schema: S) =>
  Effect.try({
    try: () => parseYaml(text) as unknown,
    catch: (error) =>
      new EnterpriseError({
        code: "org_invalid_yaml",
        message: `${file} is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
      }),
  }).pipe(
    Effect.flatMap((value) =>
      Schema.decodeUnknownEffect(schema)(value).pipe(
        Effect.mapError(
          (error) =>
            new EnterpriseError({
              code: "org_invalid",
              message: `${file} does not match the template: ${error.message}`,
            }),
        ),
      ),
    ),
  );

/** Reads both files and checks them against each other; nothing is stored. */
export const parse = Effect.fn("OrgImport.parse")(function* (files: EnterpriseOrgFiles) {
  const areasFile = yield* readYaml("areas.yaml", files.areas, AreasFile);
  const orgFile = yield* readYaml("organization.yaml", files.organization, OrganizationFile);

  const areas: Array<OrgArea> = [];
  for (const raw of areasFile.areas) {
    const id = raw.id.trim();
    const name = raw.name.trim();
    if (!AREA_ID.test(id) || id === GENERAL_AREA || name.length === 0)
      return yield* fail("org_invalid", `Area "${raw.id}" needs a valid id and a name.`);
    if (areas.some((area) => area.id === id))
      return yield* fail("org_invalid", `Area "${id}" is listed twice.`);
    const description = raw.description?.trim() ?? "";
    areas.push({ id, name, description: description.length === 0 ? null : description });
  }

  const people: Array<OrgPerson> = [];
  for (const raw of orgFile.people) {
    const email = normalizeEmail(raw.email);
    const displayName = raw.name.trim();
    if (!EMAIL.test(email) || displayName.length === 0)
      return yield* fail("org_invalid", `Person "${raw.email}" needs a valid email and a name.`);
    if (people.some((person) => person.email === email))
      return yield* fail("org_duplicate_email", `${email} is listed twice.`);
    const areaId = raw.area.trim();
    if (!areas.some((area) => area.id === areaId))
      return yield* fail(
        "org_unknown_area",
        `${email} is in "${areaId}", which is not in areas.yaml.`,
      );
    const lead = people.find((person) => person.areaId === areaId && person.role === "lead");
    if (raw.role === "lead" && lead !== undefined)
      return yield* fail(
        "org_duplicate_lead",
        `"${areaId}" has two leads: ${lead.email} and ${email}.`,
      );
    const reportsTo = raw.reportsTo == null ? null : normalizeEmail(raw.reportsTo);
    people.push({
      email,
      displayName,
      areaId,
      role: raw.role,
      reportsTo: reportsTo === "" ? null : reportsTo,
    });
  }

  const byEmail = new Map(people.map((person) => [person.email, person]));
  for (const person of people) {
    if (person.reportsTo !== null && !byEmail.has(person.reportsTo))
      return yield* fail(
        "org_unknown_person",
        `${person.email} reports to ${person.reportsTo}, who is not in organization.yaml.`,
      );
    const seen = new Set([person.email]);
    for (let next = person.reportsTo; next !== null; next = byEmail.get(next)?.reportsTo ?? null) {
      if (seen.has(next))
        return yield* fail("org_reports_to_cycle", `reportsTo loops back through ${person.email}.`);
      seen.add(next);
    }
  }
  return { areas, people } satisfies OrgPlan;
});

/** What applying the plan would change; active members missing from the plan are removed. */
export const diff = (
  plan: OrgPlan,
  current: {
    readonly teams: ReadonlyArray<EnterpriseTeam>;
    readonly members: ReadonlyArray<EnterpriseMember>;
  },
): ReadonlyArray<EnterpriseOrgChange> => {
  const changes: Array<EnterpriseOrgChange> = [];
  const teams = new Map(current.teams.map((team) => [team.id, team]));
  for (const area of plan.areas) {
    const team = teams.get(area.id);
    const fields = [
      ...(team?.name === area.name ? [] : ["name"]),
      ...((team?.description ?? null) === area.description ? [] : ["description"]),
    ];
    if (team === undefined)
      changes.push({ kind: "area", change: "added", id: area.id, name: area.name, fields: [] });
    else if (fields.length > 0)
      changes.push({ kind: "area", change: "changed", id: area.id, name: area.name, fields });
  }
  const planned = new Set(plan.areas.map((area) => area.id));
  for (const team of current.teams) {
    if (!planned.has(team.id))
      changes.push({ kind: "area", change: "removed", id: team.id, name: team.name, fields: [] });
  }

  const active = new Map(
    current.members
      .filter((member) => member.authorized && !member.revoked)
      .map((member) => [member.email, member]),
  );
  for (const person of plan.people) {
    const member = active.get(person.email);
    const base = { kind: "person", id: person.email, name: person.displayName } as const;
    if (member === undefined) {
      changes.push({ ...base, change: "added", fields: [] });
      continue;
    }
    const fields = [
      ...(member.displayName === person.displayName ? [] : ["name"]),
      ...(member.teamId === person.areaId ? [] : ["area"]),
      ...(member.role === person.role ? [] : ["role"]),
      ...(member.reportsTo === person.reportsTo ? [] : ["reportsTo"]),
    ];
    if (fields.length > 0) changes.push({ ...base, change: "changed", fields });
  }
  const people = new Set(plan.people.map((person) => person.email));
  for (const member of active.values()) {
    if (!people.has(member.email))
      changes.push({
        kind: "person",
        change: "removed",
        id: member.email,
        name: member.displayName,
        fields: [],
      });
  }
  return changes;
};
