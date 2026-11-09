// @effect-diagnostics nodeBuiltinImport:off -- Node owns the fixture child PID and its readiness stream outside the Effect runtime.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodeNet from "node:net";
import * as PgClient from "@effect/sql-pg/PgClient";
import * as Redacted from "effect/Redacted";
import * as Option from "effect/Option";
import * as NodePath from "node:path";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as KnowledgeRepo from "../knowledge/KnowledgeRepo.ts";
import * as ServerConfig from "../config.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { layerKnowledge } from "../knowledge/KnowledgeRepo.testkit.ts";
import { layerSeededStore } from "./EnterpriseStore.testkit.ts";
import * as Connectors from "./Connectors.ts";
import * as KnowledgeProposals from "./KnowledgeProposals.ts";

const layer = Connectors.layer.pipe(
  Layer.provideMerge(ServerSecretStore.layer),
  Layer.provideMerge(layerKnowledge),
  Layer.provideMerge(layerSeededStore),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-connectors-" })),
  Layer.provideMerge(
    Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, SecureRandom.layerWebCrypto),
  ),
);

const startPostgres = async () => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-postgres-"));
  const data = NodePath.join(directory, "data");
  const log = NodePath.join(directory, "postgres.log");
  NodeChildProcess.execFileSync("initdb", [
    "-D",
    data,
    "-A",
    "trust",
    "-U",
    "postgres",
    "--no-locale",
  ]);
  const port = await new Promise<number>((resolve, reject) => {
    const server = NodeNet.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string")
        return reject(new Error("Expected TCP address"));
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
  const child = NodeChildProcess.spawn(
    "postgres",
    ["-D", data, "-h", "127.0.0.1", "-p", String(port), "-k", directory, "-c", "log_statement=all"],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const pid = child.pid;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  const stop = async () => {
    if (pid !== undefined && child.exitCode === null && child.signalCode === null) {
      process.kill(pid, "SIGTERM");
      await exited;
    }
    NodeFS.rmSync(directory, { recursive: true, force: true });
  };
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", () => reject(new Error("Fixture Postgres exited before readiness")));
      let output = "";
      child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        NodeFS.appendFileSync(log, text);
        output += text;
        if (output.includes("database system is ready to accept connections")) resolve();
      });
    });
    return { port, log, stop };
  } catch (error) {
    await stop();
    throw error;
  }
};

it.live(
  "introspects real Postgres without reading rows, protects secrets and preserves accepted nodes",
  () =>
    Effect.gen(function* () {
      const fixture = yield* Effect.promise(startPostgres);
      try {
        yield* Effect.gen(function* () {
          const sql = yield* PgClient.PgClient;
          yield* sql`CREATE TABLE public.accounts (id integer PRIMARY KEY, private_value text)`;
          yield* sql`INSERT INTO public.accounts VALUES (1, 'ROW_DATA_MUST_NOT_APPEAR')`;
          yield* sql`CREATE ROLE catalog_reader LOGIN`;
          yield* sql`GRANT USAGE ON SCHEMA public TO catalog_reader`;
          yield* sql`GRANT REFERENCES ON public.accounts TO catalog_reader`;
        }).pipe(
          Effect.provide(
            PgClient.layer({
              url: Redacted.make(`postgres://postgres@127.0.0.1:${fixture.port}/postgres`),
            }),
          ),
        );
        const connector = yield* Connectors.Connectors;
        const input = {
          provider: "postgres" as const,
          area: "ledger",
          connectionString: `postgres://catalog_reader:SECRET_SENTINEL@127.0.0.1:${fixture.port}/postgres`,
        };
        expect(
          yield* Effect.result(connector.execute("ent.test.ana@gmail.com", { action: "list" })),
        ).toMatchObject({ _tag: "Failure", failure: { code: "admin_required" } });
        const connected = yield* connector.execute("jeronimo.deli@gmail.com", {
          action: "connect",
          ...input,
        });
        expect(connected.proposedCount).toBe(1);
        expect(JSON.stringify(connected)).not.toContain("SECRET_SENTINEL");
        const proposals = yield* KnowledgeProposals.KnowledgeProposals;
        const inbox = yield* proposals.inbox("jeronimo.deli@gmail.com");
        const node = inbox.proposals.find((p) => p.content?.includes("accounts"));
        expect(node?.content).toContain('layer: "Data"');
        expect(node?.content).toContain("private_value");
        expect(node?.content).not.toContain("ROW_DATA_MUST_NOT_APPEAR");
        expect(node?.content).not.toContain("SECRET_SENTINEL");
        if (!node) throw new Error("Expected table proposal");
        yield* proposals.decide("jeronimo.deli@gmail.com", { id: node.id, action: "approve" });
        const refreshed = yield* connector.execute("jeronimo.deli@gmail.com", {
          action: "introspect",
          provider: "postgres",
        });
        expect(refreshed.proposedCount).toBe(0);
        for (const action of ["connect", "introspect", "disconnect"] as const) {
          const result = yield* Effect.result(
            connector.execute("ent.test.ana@gmail.com", { ...input, action }),
          );
          expect(result).toMatchObject({ _tag: "Failure", failure: { code: "admin_required" } });
        }
        const disconnected = yield* connector.execute("jeronimo.deli@gmail.com", {
          action: "disconnect",
          provider: "postgres",
        });
        expect(disconnected.connections).toEqual([]);
        expect(
          (yield* proposals.inbox("jeronimo.deli@gmail.com")).proposals.find(
            (p) => p.id === node.id,
          )?.status,
        ).toBe("applied");
        const secrets = yield* ServerSecretStore.ServerSecretStore;
        expect(Option.isNone(yield* secrets.get("enterprise-connectors"))).toBe(true);
        const repo = yield* KnowledgeRepo.KnowledgeRepo;
        expect((yield* repo.documents).some((document) => document.id === node.path)).toBe(true);
        expect(
          (yield* connector.execute("jeronimo.deli@gmail.com", {
            ...input,
            action: "connect",
            provider: "supabase",
          })).proposedCount,
        ).toBe(1);
        yield* connector.execute("jeronimo.deli@gmail.com", {
          action: "disconnect",
          provider: "supabase",
        });
        expect(Option.isNone(yield* secrets.get("enterprise-connectors"))).toBe(true);
        const statements = NodeFS.readFileSync(fixture.log, "utf8");
        expect(statements).toMatch(/SET TRANSACTION READ ONLY/i);
        expect(statements).toContain("SET LOCAL statement_timeout");
        expect(statements).not.toContain("SECRET_SENTINEL");
        expect(statements).toContain("information_schema.columns");
        expect(statements).not.toMatch(/select[^;\n]*from\s+(?:public\.)?accounts/i);
      } finally {
        yield* Effect.promise(fixture.stop);
      }
    }).pipe(Effect.provide(layer)),
);

it.live("returns typed safe errors for invalid or unreachable URLs", () =>
  Effect.gen(function* () {
    const connector = yield* Connectors.Connectors;
    for (const connectionString of [
      "not-a-url-SECRET_SENTINEL",
      "http://SECRET_SENTINEL@localhost/db",
      "postgres://a:SECRET_SENTINEL@127.0.0.1:1/db",
    ]) {
      const result = yield* Effect.result(
        connector.execute("jeronimo.deli@gmail.com", {
          action: "connect",
          provider: "supabase",
          area: "ledger",
          connectionString,
        }),
      );
      expect(Result.isFailure(result)).toBe(true);
      expect(JSON.stringify(result)).not.toContain("SECRET_SENTINEL");
      if (Result.isFailure(result))
        expect(["connector_invalid", "connector_unreachable"]).toContain(result.failure.code);
    }
    expect(
      (yield* connector.execute("jeronimo.deli@gmail.com", { action: "list" })).connections,
    ).toEqual([]);
  }).pipe(Effect.provide(layer)),
);
