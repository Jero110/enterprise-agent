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

const base = Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, SecureRandom.layerWebCrypto);
const services = Layer.merge(TeamPublication.layer, EnterpriseHub.layer);
const layer = services.pipe(Layer.provideMerge(layerSeededStore), Layer.provideMerge(base));
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
      expect(yield* pub.list(juan)).toEqual([
        {
          ...summary("parent"),
          ownerEmail: hugo,
          ownerDisplayName: "Hugo",
          publicationStatus: "unpublished",
        },
      ]);
      expect(yield* pub.list(ana)).toEqual([]);
      expect(yield* denied(pub.get(juan, { ownerEmail: hugo, threadId: "parent" }))).toBe(true);
      expect(
        yield* denied(pub.report("unbound", { summaries: [summary("spoof")], snapshots: [] })),
      ).toBe(true);
      expect((yield* pub.list("jeronimo.deli@gmail.com")).length).toBe(1);
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
      expect(
        (yield* pub.list(juan)).every((thread) => thread.publicationStatus === "unpublished"),
      ).toBe(true);
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
