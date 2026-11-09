import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it, describe } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as SqlClient from "effect/sql/SqlClient";

import * as TeamPublication from "./TeamPublication.ts";
import * as EnterpriseStore from "../enterprise/EnterpriseStore.ts";
import * as EnterpriseHub from "../enterprise/EnterpriseHub.ts";
import { acmeSeedPath, layerSeededStore } from "../enterprise/EnterpriseStore.testkit.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as ServerConfig from "../config.ts";
import { layerKnowledge } from "../knowledge/KnowledgeRepo.testkit.ts";

const base = Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, SecureRandom.layerWebCrypto);
const services = Layer.merge(
  TeamPublication.layer,
  EnterpriseHub.layer.pipe(Layer.provide(layerKnowledge)),
);
const layer = services.pipe(
  Layer.provideMerge(layerSeededStore),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-team-publication-" })),
  Layer.provideMerge(base),
);
const hugo = "ent.test.hugo@gmail.com";
const juan = "ent.test.juan@gmail.com";
const ana = "ent.test.ana@gmail.com";
const summary = (threadId: string, parentThreadId: string | null = null) => ({
  threadId,
  parentThreadId,
  title: threadId,
  status: "idle" as const,
  updatedAt: "2026-11-05T00:00:00Z",
});
const messages = [
  { role: "assistant" as const, text: "compact text", createdAt: "2026-11-05T00:00:00Z" },
];
const enroll = Effect.gen(function* () {
  const hub = yield* EnterpriseHub.EnterpriseHub;
  for (const email of [hugo, juan, ana, "jeronimo.deli@gmail.com"]) {
    yield* hub.enroll(email, { email, token: "ACME-BANK-DEV-2026" });
  }
});
const denied = <A>(effect: Effect.Effect<A, { readonly code: string }>) =>
  Effect.map(Effect.result(effect), Result.isFailure);

describe("TeamPublication hub", () => {
  it.effect("session-bound summaries are team scoped and unpublished content is denied", () =>
    Effect.gen(function* () {
      yield* enroll;
      const pub = yield* TeamPublication.TeamPublication;
      yield* pub.report(hugo, { summaries: [summary("parent")], snapshots: [] });
      expect(yield* pub.list(juan)).toEqual([]);
      expect(yield* pub.list(hugo)).toMatchObject([
        { threadId: "parent", publicationStatus: "unpublished" },
      ]);
      expect(yield* pub.list(ana)).toEqual([]);
      expect(yield* denied(pub.get(juan, { ownerEmail: hugo, threadId: "parent" }))).toBe(true);
      expect(
        yield* denied(pub.report("unbound", { summaries: [summary("spoof")], snapshots: [] })),
      ).toBe(true);
      expect(yield* pub.list("jeronimo.deli@gmail.com")).toEqual([]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("publishing includes descendants and unpublish deletes all snapshots", () =>
    Effect.gen(function* () {
      yield* enroll;
      const pub = yield* TeamPublication.TeamPublication;
      const sql = yield* SqlClient.SqlClient;
      const summaries = [
        summary("parent"),
        summary("child", "parent"),
        summary("grandchild", "child"),
      ];
      yield* pub.report(hugo, { summaries, snapshots: [] });
      yield* pub.publish(hugo, { threadId: "parent", status: "read-only" });
      expect(yield* denied(pub.publish(hugo, { threadId: "child", status: "unpublished" }))).toBe(
        true,
      );
      yield* pub.report(hugo, {
        summaries: [],
        snapshots: summaries.map(({ threadId }) => ({ threadId, messages })),
      });
      expect(yield* pub.list(juan)).toHaveLength(3);
      for (const { threadId } of summaries) {
        expect((yield* pub.get(juan, { ownerEmail: hugo, threadId })).messages).toEqual(messages);
        expect(yield* denied(pub.get(ana, { ownerEmail: hugo, threadId }))).toBe(true);
      }
      yield* pub.report(hugo, {
        summaries: [summary("late", "parent")],
        snapshots: [{ threadId: "late", messages }],
      });
      expect((yield* pub.get(juan, { ownerEmail: hugo, threadId: "late" })).messages).toEqual(
        messages,
      );
      expect(yield* denied(pub.publish(juan, { threadId: "parent", status: "unpublished" }))).toBe(
        true,
      );
      yield* pub.publish(hugo, { threadId: "parent", status: "unpublished" });
      for (const threadId of ["parent", "child", "grandchild", "late"]) {
        expect(yield* denied(pub.get(juan, { ownerEmail: hugo, threadId }))).toBe(true);
      }
      expect(
        yield* sql`SELECT thread_id FROM enterprise_team_threads WHERE snapshot_json IS NOT NULL`,
      ).toEqual([]);
      // A delayed upload cannot restore content after unpublishing.
      yield* pub.report(hugo, { summaries: [], snapshots: [{ threadId: "child", messages }] });
      expect(
        yield* sql`SELECT thread_id FROM enterprise_team_threads WHERE snapshot_json IS NOT NULL`,
      ).toEqual([]);
      expect(yield* pub.list(juan)).toEqual([]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("summary shares store and serve only the request and the result", () =>
    Effect.gen(function* () {
      yield* enroll;
      const pub = yield* TeamPublication.TeamPublication;
      const sql = yield* SqlClient.SqlClient;
      const transcript = [
        { role: "user" as const, text: "Find last promo's %", createdAt: "2026-11-09T10:00:00Z" },
        { role: "assistant" as const, text: "Searching Ventas", createdAt: "2026-11-09T10:01:00Z" },
        { role: "user" as const, text: "private follow-up", createdAt: "2026-11-09T10:05:00Z" },
        {
          role: "assistant" as const,
          text: "The promo was 15%.\nWorked for 7 min",
          createdAt: "2026-11-09T10:09:00Z",
        },
      ];
      yield* pub.report(hugo, {
        summaries: [summary("parent"), summary("child", "parent")],
        snapshots: [],
      });
      yield* pub.publish(hugo, { threadId: "parent", status: "summary" });
      yield* pub.report(hugo, {
        summaries: [],
        snapshots: ["parent", "child"].map((threadId) => ({ threadId, messages: transcript })),
      });
      expect((yield* pub.list(juan)).map((thread) => thread.publicationStatus)).toEqual([
        "summary",
        "summary",
      ]);
      const expected = [
        { role: "user", text: "Find last promo's %", createdAt: "2026-11-09T10:09:00Z" },
        { role: "assistant", text: "The promo was 15%.", createdAt: "2026-11-09T10:09:00Z" },
      ];
      for (const threadId of ["parent", "child"]) {
        expect((yield* pub.get(juan, { ownerEmail: hugo, threadId })).messages).toEqual(expected);
      }
      const stored = yield* sql<{
        readonly snapshot_json: string;
      }>`SELECT snapshot_json FROM enterprise_team_threads WHERE snapshot_json IS NOT NULL`;
      expect(stored).toHaveLength(2);
      for (const row of stored) expect(row.snapshot_json).not.toContain("private follow-up");
      // Switching views drops the stored snapshot instead of serving it under the new view.
      yield* pub.publish(hugo, { threadId: "parent", status: "read-only" });
      expect(yield* denied(pub.get(juan, { ownerEmail: hugo, threadId: "parent" }))).toBe(true);
      yield* pub.report(hugo, {
        summaries: [],
        snapshots: [{ threadId: "parent", messages: transcript }],
      });
      expect((yield* pub.get(juan, { ownerEmail: hugo, threadId: "parent" })).messages).toEqual(
        transcript,
      );
    }).pipe(Effect.provide(layer)),
  );

  it.effect("rechecks current membership and rejects cyclic lineage", () =>
    Effect.gen(function* () {
      yield* enroll;
      const pub = yield* TeamPublication.TeamPublication;
      const store = yield* EnterpriseStore.EnterpriseStore;
      yield* pub.report(hugo, { summaries: [summary("parent")], snapshots: [] });
      yield* pub.publish(hugo, { threadId: "parent", status: "read-only" });
      yield* pub.report(hugo, { summaries: [], snapshots: [{ threadId: "parent", messages }] });
      expect(
        yield* denied(
          pub.report(hugo, { summaries: [summary("parent", "parent")], snapshots: [] }),
        ),
      ).toBe(true);
      yield* store.moveMember(juan, "ledger");
      expect(yield* pub.list(juan)).toEqual([]);
      expect(yield* denied(pub.get(juan, { ownerEmail: hugo, threadId: "parent" }))).toBe(true);
      yield* store.revokeMember(hugo);
      expect(yield* denied(pub.list(hugo))).toBe(true);
      expect(yield* pub.list("jeronimo.deli@gmail.com")).toEqual([]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("summaries, publication levels and snapshots survive a hub reopen", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-team-publication-" });
      const at = services.pipe(
        Layer.provideMerge(EnterpriseStore.layer),
        Layer.provideMerge(Sqlite.layerFromPath(path.join(dir, "state.sqlite"))),
        Layer.provideMerge(ServerConfig.layerTest(dir, { prefix: "t3-team-publication-" })),
      );
      yield* Effect.gen(function* () {
        const store = yield* EnterpriseStore.EnterpriseStore;
        yield* store.seed(yield* EnterpriseStore.loadSeedFile(acmeSeedPath));
        yield* enroll;
        const pub = yield* TeamPublication.TeamPublication;
        yield* pub.report(hugo, { summaries: [summary("parent")], snapshots: [] });
        yield* pub.publish(hugo, { threadId: "parent", status: "read-only" });
        yield* pub.report(hugo, { summaries: [], snapshots: [{ threadId: "parent", messages }] });
      }).pipe(Effect.provide(at), Effect.scoped);
      yield* Effect.gen(function* () {
        const pub = yield* TeamPublication.TeamPublication;
        expect((yield* pub.list(juan))[0]?.publicationStatus).toBe("read-only");
        expect((yield* pub.get(juan, { ownerEmail: hugo, threadId: "parent" })).messages).toEqual(
          messages,
        );
      }).pipe(Effect.provide(at), Effect.scoped);
    }).pipe(Effect.scoped, Effect.provide(base)),
  );
});
