import { type EnterpriseOrgChange, KnowledgeProposal, TeamMemberRole } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import type { OrgPlan } from "./OrgImport.ts";

export const normalizeEmail = (email: string): string => email.toLowerCase().trim();

export interface IngestionRun {
  readonly id: string;
  readonly threadId: string;
  readonly adminEmail: string;
  readonly folder: string;
  readonly status: "running" | "completed" | "failed";
}

export interface EnterpriseTeam {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly createdAt: DateTime.Utc;
  readonly createdBy: string;
}

export interface EnterpriseMember {
  readonly email: string;
  readonly displayName: string;
  readonly teamId: string | null;
  readonly role: TeamMemberRole;
  /** The manager's email, from the imported org chart. */
  readonly reportsTo: string | null;
  readonly authorized: boolean;
  readonly revoked: boolean;
  readonly authorizedAt: DateTime.Utc;
  readonly authorizedBy: string;
}

export interface EnterpriseEnrollment {
  readonly environmentId: string;
  readonly email: string;
  readonly enrolledAt: DateTime.Utc;
}

export interface EnterpriseAreaGrant {
  readonly email: string;
  readonly areaId: string;
  readonly role: "lead" | "member";
  readonly grantedAt: DateTime.Utc;
  readonly grantedBy: string;
}

export interface UpsertMemberInput {
  readonly areaIds?: ReadonlyArray<string>;
  readonly email: string;
  readonly displayName: string;
  readonly teamId: string | null;
  readonly role: TeamMemberRole;
  readonly authorizedBy: string;
}

export const EnterpriseSeed = Schema.Struct({
  enterprise: Schema.Struct({ name: Schema.String, token: Schema.String }),
  teams: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
  members: Schema.Array(
    Schema.Struct({
      email: Schema.String,
      displayName: Schema.String,
      teamId: Schema.NullOr(Schema.String),
      role: TeamMemberRole,
    }),
  ),
});
export type EnterpriseSeed = typeof EnterpriseSeed.Type;

const SEED_ACTOR = "seed";

/**
 * The hub's single source of truth for who belongs to the enterprise, which
 * team they are in, which environments they enrolled, and which areas they
 * may read beyond their own. Storage failures are defects: callers cannot act
 * on them.
 */
export class EnterpriseStore extends Context.Service<
  EnterpriseStore,
  {
    /** Inserts what is missing; never overwrites what an admin changed. */
    readonly saveIngestionRun: (run: IngestionRun) => Effect.Effect<void>;
    readonly getIngestionRun: (threadId: string) => Effect.Effect<IngestionRun | null>;
    readonly listProposals: Effect.Effect<ReadonlyArray<KnowledgeProposal>>;
    readonly saveProposal: (proposal: KnowledgeProposal) => Effect.Effect<void>;
    readonly seed: (seed: EnterpriseSeed) => Effect.Effect<void>;
    readonly verifyToken: (token: string) => Effect.Effect<boolean>;
    readonly listTeams: Effect.Effect<ReadonlyArray<EnterpriseTeam>>;
    readonly getTeam: (teamId: string) => Effect.Effect<EnterpriseTeam | null>;
    readonly createTeam: (input: {
      readonly id: string;
      readonly name: string;
      readonly createdBy: string;
    }) => Effect.Effect<EnterpriseTeam>;
    readonly deleteTeam: (teamId: string) => Effect.Effect<boolean>;
    /** Every row, revoked ones included; use `canEnter` for access decisions. */
    readonly listMembers: Effect.Effect<ReadonlyArray<EnterpriseMember>>;
    readonly getMember: (email: string) => Effect.Effect<EnterpriseMember | null>;
    /** Authorizes the email (again, if it was revoked) with this team and role. */
    readonly upsertMember: (input: UpsertMemberInput) => Effect.Effect<EnterpriseMember>;
    readonly revokeMember: (email: string) => Effect.Effect<boolean>;
    readonly moveMember: (email: string, teamId: string | null) => Effect.Effect<boolean>;
    readonly canEnter: (email: string) => Effect.Effect<boolean>;
    readonly enroll: (input: {
      readonly environmentId: string;
      readonly email: string;
    }) => Effect.Effect<EnterpriseEnrollment>;
    readonly getEnrollment: (environmentId: string) => Effect.Effect<EnterpriseEnrollment | null>;
    readonly unenroll: (environmentId: string) => Effect.Effect<boolean>;
    readonly grantArea: (input: {
      readonly email: string;
      readonly areaId: string;
      readonly role?: "lead" | "member";
      readonly grantedBy: string;
    }) => Effect.Effect<void>;
    readonly revokeArea: (email: string, areaId: string) => Effect.Effect<void>;
    readonly listGrants: (email: string) => Effect.Effect<ReadonlyArray<EnterpriseAreaGrant>>;
    readonly listAreaGrants: Effect.Effect<ReadonlyArray<EnterpriseAreaGrant>>;
    /** Writes the changed rows of an org import in one transaction; removed people are revoked. */
    readonly applyOrg: (input: {
      readonly plan: OrgPlan;
      readonly changes: ReadonlyArray<EnterpriseOrgChange>;
      readonly actor: string;
    }) => Effect.Effect<void>;
  }
>()("t3/enterprise/EnterpriseStore") {}

interface TeamRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly created_at: string;
  readonly created_by: string;
}

interface MemberRow {
  readonly email: string;
  readonly display_name: string;
  readonly team_id: string | null;
  readonly role: TeamMemberRole;
  readonly reports_to: string | null;
  readonly authorized: number;
  readonly revoked: number;
  readonly authorized_at: string;
  readonly authorized_by: string;
}

interface EnrollmentRow {
  readonly environment_id: string;
  readonly email: string;
  readonly enrolled_at: string;
}

interface GrantRow {
  readonly email: string;
  readonly area_id: string;
  readonly role: "lead" | "member";
  readonly granted_at: string;
  readonly granted_by: string;
}

const toTeam = (row: TeamRow): EnterpriseTeam => ({
  id: row.id,
  name: row.name,
  description: row.description,
  createdAt: DateTime.makeUnsafe(row.created_at),
  createdBy: row.created_by,
});

const toMember = (row: MemberRow): EnterpriseMember => ({
  email: row.email,
  displayName: row.display_name,
  teamId: row.team_id,
  role: row.role,
  reportsTo: row.reports_to,
  authorized: row.authorized === 1,
  revoked: row.revoked === 1,
  authorizedAt: DateTime.makeUnsafe(row.authorized_at),
  authorizedBy: row.authorized_by,
});

const toEnrollment = (row: EnrollmentRow): EnterpriseEnrollment => ({
  environmentId: row.environment_id,
  email: row.email,
  enrolledAt: DateTime.makeUnsafe(row.enrolled_at),
});

const toGrant = (row: GrantRow): EnterpriseAreaGrant => ({
  email: row.email,
  areaId: row.area_id,
  role: row.role,
  grantedAt: DateTime.makeUnsafe(row.granted_at),
  grantedBy: row.granted_by,
});

const decodeSeed = Schema.decodeUnknownEffect(Schema.fromJsonString(EnterpriseSeed));
const decodeProposal = Schema.decodeEffect(Schema.fromJsonString(KnowledgeProposal));

export const loadSeedFile = Effect.fn("EnterpriseStore.loadSeedFile")(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* decodeSeed(yield* fs.readFileString(path)).pipe(Effect.orDie);
}, Effect.orDie);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const random = yield* SecureRandom.SecureRandom;
  const digest = yield* Digest.Digest;

  const hashToken = (salt: string, token: string) =>
    digest
      .digest(Digest.sha256, new TextEncoder().encode(`${salt}:${token}`))
      .pipe(Effect.map(Hex.encode), Effect.orDie);

  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

  const selectMember = (email: string) =>
    sql<MemberRow>`SELECT * FROM enterprise_members WHERE email = ${normalizeEmail(email)}`.pipe(
      Effect.map((rows) => (rows[0] === undefined ? null : toMember(rows[0]))),
      Effect.orDie,
    );

  const seed: EnterpriseStore["Service"]["seed"] = Effect.fn("EnterpriseStore.seed")(
    function* (input) {
      const now = yield* nowIso;
      const existing = yield* sql<{ id: number }>`SELECT id FROM enterprise`;
      if (existing.length === 0) {
        const salt = Hex.encode(yield* random.randomBytes(16));
        const tokenHash = yield* hashToken(salt, input.enterprise.token);
        yield* sql`
          INSERT INTO enterprise (id, name, token_salt, token_hash)
          VALUES (1, ${input.enterprise.name}, ${salt}, ${tokenHash})
        `;
      }
      for (const team of input.teams) {
        yield* sql`
          INSERT OR IGNORE INTO enterprise_teams (id, name, created_at, created_by)
          VALUES (${team.id}, ${team.name}, ${now}, ${SEED_ACTOR})
        `;
      }
      for (const member of input.members) {
        yield* sql`
          INSERT OR IGNORE INTO enterprise_members
            (email, display_name, team_id, role, authorized, revoked, authorized_at, authorized_by)
          VALUES (${normalizeEmail(member.email)}, ${member.displayName}, ${member.teamId},
            ${member.role}, 1, 0, ${now}, ${SEED_ACTOR})
        `;
      }
    },
    (effect) => sql.withTransaction(effect),
    Effect.orDie,
  );

  const verifyToken: EnterpriseStore["Service"]["verifyToken"] = Effect.fn(
    "EnterpriseStore.verifyToken",
  )(function* (token) {
    const rows = yield* sql<{ token_salt: string; token_hash: string }>`
      SELECT token_salt, token_hash FROM enterprise WHERE id = 1
    `.pipe(Effect.orDie);
    const row = rows[0];
    if (row === undefined || token.length === 0) return false;
    // The salted hash is not attacker-chosen, so comparing it leaks nothing useful.
    return (yield* hashToken(row.token_salt, token)) === row.token_hash;
  });

  const listTeams = sql<TeamRow>`SELECT * FROM enterprise_teams ORDER BY name, id`.pipe(
    Effect.map((rows) => rows.map(toTeam)),
    Effect.orDie,
  );

  const getTeam: EnterpriseStore["Service"]["getTeam"] = (teamId) =>
    sql<TeamRow>`SELECT * FROM enterprise_teams WHERE id = ${teamId}`.pipe(
      Effect.map((rows) => (rows[0] === undefined ? null : toTeam(rows[0]))),
      Effect.orDie,
    );

  const createTeam: EnterpriseStore["Service"]["createTeam"] = Effect.fn(
    "EnterpriseStore.createTeam",
  )(function* (input) {
    const now = yield* nowIso;
    yield* sql`
      INSERT INTO enterprise_teams (id, name, created_at, created_by)
      VALUES (${input.id}, ${input.name}, ${now}, ${input.createdBy})
    `.pipe(Effect.orDie);
    return toTeam({
      id: input.id,
      name: input.name,
      description: null,
      created_at: now,
      created_by: input.createdBy,
    });
  });

  const deleteTeam: EnterpriseStore["Service"]["deleteTeam"] = Effect.fn(
    "EnterpriseStore.deleteTeam",
  )(
    function* (teamId) {
      const found = yield* sql`SELECT 1 FROM enterprise_teams WHERE id = ${teamId}`;
      yield* sql`DELETE FROM enterprise_area_grants WHERE area_id = ${teamId}`;
      yield* sql`DELETE FROM enterprise_teams WHERE id = ${teamId}`;
      return found.length > 0;
    },
    (effect) => sql.withTransaction(effect),
    Effect.orDie,
  );

  const listMembers = sql<MemberRow>`SELECT * FROM enterprise_members ORDER BY email`.pipe(
    Effect.map((rows) => rows.map(toMember)),
    Effect.orDie,
  );

  const upsertMember: EnterpriseStore["Service"]["upsertMember"] = Effect.fn(
    "EnterpriseStore.upsertMember",
  )(
    function* (input) {
      const email = normalizeEmail(input.email);
      const now = yield* nowIso;
      yield* sql`
      INSERT INTO enterprise_members
        (email, display_name, team_id, role, authorized, revoked, authorized_at, authorized_by)
      VALUES (${email}, ${input.displayName}, ${input.teamId}, ${input.role}, 1, 0, ${now},
        ${input.authorizedBy})
      ON CONFLICT (email) DO UPDATE SET
        display_name = excluded.display_name,
        team_id = excluded.team_id,
        role = excluded.role,
        authorized = 1,
        revoked = 0,
        authorized_at = excluded.authorized_at,
        authorized_by = excluded.authorized_by
    `.pipe(Effect.orDie);
      if (input.areaIds !== undefined) {
        const areas = new Set(input.areaIds);
        const existing =
          yield* sql<GrantRow>`SELECT * FROM enterprise_area_grants WHERE email = ${email}`;
        for (const grant of existing) {
          if (!areas.has(grant.area_id))
            yield* sql`DELETE FROM enterprise_area_grants WHERE email = ${email} AND area_id = ${grant.area_id}`;
        }
        for (const areaId of areas) {
          yield* sql`INSERT OR IGNORE INTO enterprise_area_grants
          (email, area_id, role, granted_at, granted_by)
          VALUES (${email}, ${areaId}, 'member', ${now}, ${input.authorizedBy})`;
        }
      }
      const stored = yield* selectMember(email);
      return toMember({
        email,
        display_name: input.displayName,
        team_id: input.teamId,
        role: input.role,
        reports_to: stored?.reportsTo ?? null,
        authorized: 1,
        revoked: 0,
        authorized_at: now,
        authorized_by: input.authorizedBy,
      });
    },
    (effect) => sql.withTransaction(effect),
    Effect.orDie,
  );

  const revokeMember: EnterpriseStore["Service"]["revokeMember"] = (email) =>
    sql<{ email: string }>`
      UPDATE enterprise_members SET revoked = 1 WHERE email = ${normalizeEmail(email)}
      RETURNING email
    `.pipe(
      Effect.map((rows) => rows.length > 0),
      Effect.orDie,
    );

  const moveMember: EnterpriseStore["Service"]["moveMember"] = (email, teamId) =>
    sql<{ email: string }>`
      UPDATE enterprise_members SET team_id = ${teamId} WHERE email = ${normalizeEmail(email)}
      RETURNING email
    `.pipe(
      Effect.map((rows) => rows.length > 0),
      Effect.orDie,
    );

  const canEnter: EnterpriseStore["Service"]["canEnter"] = (email) =>
    sql<{ email: string }>`
      SELECT email FROM enterprise_members
      WHERE email = ${normalizeEmail(email)} AND authorized = 1 AND revoked = 0
    `.pipe(
      Effect.map((rows) => rows.length > 0),
      Effect.orDie,
    );

  const enroll: EnterpriseStore["Service"]["enroll"] = Effect.fn("EnterpriseStore.enroll")(
    function* (input) {
      const email = normalizeEmail(input.email);
      const now = yield* nowIso;
      yield* sql`
        INSERT OR REPLACE INTO enterprise_enrollments (environment_id, email, enrolled_at)
        VALUES (${input.environmentId}, ${email}, ${now})
      `.pipe(Effect.orDie);
      return toEnrollment({ environment_id: input.environmentId, email, enrolled_at: now });
    },
  );

  const getEnrollment: EnterpriseStore["Service"]["getEnrollment"] = (environmentId) =>
    sql<EnrollmentRow>`
      SELECT * FROM enterprise_enrollments WHERE environment_id = ${environmentId}
    `.pipe(
      Effect.map((rows) => (rows[0] === undefined ? null : toEnrollment(rows[0]))),
      Effect.orDie,
    );

  const unenroll: EnterpriseStore["Service"]["unenroll"] = (environmentId) =>
    sql<{ environment_id: string }>`
      DELETE FROM enterprise_enrollments WHERE environment_id = ${environmentId}
      RETURNING environment_id
    `.pipe(
      Effect.map((rows) => rows.length > 0),
      Effect.orDie,
    );

  const grantArea: EnterpriseStore["Service"]["grantArea"] = Effect.fn("EnterpriseStore.grantArea")(
    function* (input) {
      const now = yield* nowIso;
      yield* sql`
      INSERT INTO enterprise_area_grants (email, area_id, role, granted_at, granted_by)
      VALUES (${normalizeEmail(input.email)}, ${input.areaId}, ${input.role ?? "member"}, ${now}, ${input.grantedBy})
      ON CONFLICT (email, area_id) DO UPDATE SET role = excluded.role,
        granted_at = excluded.granted_at, granted_by = excluded.granted_by
    `.pipe(Effect.orDie);
    },
  );

  const revokeArea: EnterpriseStore["Service"]["revokeArea"] = (email, areaId) =>
    sql`
      DELETE FROM enterprise_area_grants
      WHERE email = ${normalizeEmail(email)} AND area_id = ${areaId}
    `.pipe(Effect.asVoid, Effect.orDie);

  const listGrants: EnterpriseStore["Service"]["listGrants"] = (email) =>
    sql<GrantRow>`
      SELECT * FROM enterprise_area_grants WHERE email = ${normalizeEmail(email)} ORDER BY area_id
    `.pipe(
      Effect.map((rows) => rows.map(toGrant)),
      Effect.orDie,
    );

  const listAreaGrants = sql<GrantRow>`SELECT * FROM enterprise_area_grants`.pipe(
    Effect.map((rows) => rows.map(toGrant)),
    Effect.orDie,
  );

  const applyOrg: EnterpriseStore["Service"]["applyOrg"] = Effect.fn("EnterpriseStore.applyOrg")(
    function* ({ plan, changes, actor }) {
      const now = yield* nowIso;
      const touched = (kind: EnterpriseOrgChange["kind"], id: string) =>
        changes.some((change) => change.kind === kind && change.id === id);
      for (const area of plan.areas) {
        if (!touched("area", area.id)) continue;
        yield* sql`
          INSERT INTO enterprise_teams (id, name, description, created_at, created_by)
          VALUES (${area.id}, ${area.name}, ${area.description}, ${now}, ${actor})
          ON CONFLICT (id) DO UPDATE SET name = excluded.name, description = excluded.description
        `;
      }
      for (const person of plan.people) {
        if (!touched("person", person.email)) continue;
        yield* sql`
          INSERT INTO enterprise_members (email, display_name, team_id, role, reports_to,
            authorized, revoked, authorized_at, authorized_by)
          VALUES (${person.email}, ${person.displayName}, ${person.areaId}, ${person.role},
            ${person.reportsTo}, 1, 0, ${now}, ${actor})
          ON CONFLICT (email) DO UPDATE SET
            display_name = excluded.display_name,
            team_id = excluded.team_id,
            role = excluded.role,
            reports_to = excluded.reports_to,
            authorized = 1,
            revoked = 0,
            authorized_at = excluded.authorized_at,
            authorized_by = excluded.authorized_by
        `;
      }
      for (const change of changes) {
        if (change.change !== "removed") continue;
        if (change.kind === "person") {
          yield* sql`UPDATE enterprise_members SET revoked = 1 WHERE email = ${change.id}`;
        } else {
          yield* sql`UPDATE enterprise_members SET team_id = NULL WHERE team_id = ${change.id}`;
          yield* sql`DELETE FROM enterprise_area_grants WHERE area_id = ${change.id}`;
          yield* sql`DELETE FROM enterprise_teams WHERE id = ${change.id}`;
        }
      }
    },
    (effect) => sql.withTransaction(effect),
    Effect.orDie,
  );

  const saveIngestionRun: EnterpriseStore["Service"]["saveIngestionRun"] = (run) =>
    sql`INSERT INTO enterprise_ingestion_runs (id, thread_id, admin_email, folder, status)
      VALUES (${run.id}, ${run.threadId}, ${normalizeEmail(run.adminEmail)}, ${run.folder}, ${run.status})
      ON CONFLICT (id) DO UPDATE SET status = excluded.status`.pipe(Effect.asVoid, Effect.orDie);
  const getIngestionRun: EnterpriseStore["Service"]["getIngestionRun"] = (threadId) =>
    sql<{
      id: string;
      thread_id: string;
      admin_email: string;
      folder: string;
      status: IngestionRun["status"];
    }>`
      SELECT * FROM enterprise_ingestion_runs WHERE thread_id = ${threadId}
    `.pipe(
      Effect.map((rows) =>
        rows[0] === undefined
          ? null
          : {
              id: rows[0].id,
              threadId: rows[0].thread_id,
              adminEmail: rows[0].admin_email,
              folder: rows[0].folder,
              status: rows[0].status,
            },
      ),
      Effect.orDie,
    );

  const listProposals = sql<{
    payload: string;
  }>`SELECT payload FROM enterprise_knowledge_proposals ORDER BY rowid DESC`.pipe(
    Effect.flatMap((rows) => Effect.forEach(rows, (row) => decodeProposal(row.payload))),
    Effect.orDie,
  );
  const saveProposal: EnterpriseStore["Service"]["saveProposal"] = (proposal) =>
    sql`INSERT INTO enterprise_knowledge_proposals (id, payload)
      VALUES (${proposal.id}, ${JSON.stringify(proposal)})
      ON CONFLICT (id) DO UPDATE SET payload = excluded.payload`.pipe(Effect.asVoid, Effect.orDie);

  return EnterpriseStore.of({
    saveIngestionRun,
    getIngestionRun,
    listProposals,
    saveProposal,
    seed,
    verifyToken,
    listTeams,
    getTeam,
    createTeam,
    deleteTeam,
    listMembers,
    getMember: selectMember,
    upsertMember,
    revokeMember,
    moveMember,
    canEnter,
    enroll,
    getEnrollment,
    unenroll,
    grantArea,
    revokeArea,
    listGrants,
    listAreaGrants,
    applyOrg,
  });
});

export const layer = Layer.effect(EnterpriseStore, make);

/**
 * The hub's store, seeded from `T3CODE_ENTERPRISE_SEED` when it is set. Compose
 * it only when `ServerConfig.enterpriseHub` is on; a server without hub mode
 * never builds it.
 */
export const layerHub = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const store = yield* EnterpriseStore;
    if (config.enterpriseSeedPath !== undefined) {
      yield* store.seed(yield* loadSeedFile(config.enterpriseSeedPath));
    }
  }),
).pipe(Layer.provideMerge(layer));
