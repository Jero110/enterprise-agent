import * as Digest from "effect/crypto/Digest";
import {
  EnterpriseError,
  type EnterpriseConnectorInput,
  type EnterpriseConnectorResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as PgClient from "@effect/sql-pg/PgClient";
import * as Redacted from "effect/Redacted";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as KnowledgeRepo from "../knowledge/KnowledgeRepo.ts";
import * as EnterpriseStore from "./EnterpriseStore.ts";
import * as KnowledgeProposals from "./KnowledgeProposals.ts";

export class Connectors extends Context.Service<
  Connectors,
  {
    readonly execute: (
      email: string,
      input: EnterpriseConnectorInput,
    ) => Effect.Effect<EnterpriseConnectorResult, EnterpriseError>;
  }
>()("t3/enterprise/Connectors") {}

const StoredConnections = Schema.Array(
  Schema.Struct({
    provider: Schema.Literals(["postgres", "supabase"]),
    area: Schema.String,
    connectionString: Schema.String,
  }),
);
type Connection = (typeof StoredConnections.Type)[number];
const decodeConnections = Schema.decodeEffect(Schema.fromJsonString(StoredConnections));
const encodeConnections = Schema.encodeEffect(Schema.fromJsonString(StoredConnections));
const secretName = "enterprise-connectors";
const storageFailed = new EnterpriseError({
  code: "connector_storage_failed",
  message: "Could not access connector secrets.",
});
const invalid = new EnterpriseError({
  code: "connector_invalid",
  message: "Use a Postgres connection URL and a valid area.",
});

const introspect = Effect.fn("Connectors.introspect")((connectionString: string) =>
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`SET TRANSACTION READ ONLY`;
        yield* sql`SET LOCAL statement_timeout = '10s'`;
        return yield* sql<{
          table_schema: string;
          table_name: string;
          column_name: string;
          data_type: string;
          is_nullable: string;
        }>`
        SELECT c.table_schema, c.table_name, c.column_name, c.data_type, c.is_nullable
        FROM information_schema.columns c
        JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE t.table_type = 'BASE TABLE'
          AND c.table_schema NOT IN ('pg_catalog', 'information_schema')
          AND c.table_schema NOT LIKE 'pg_%'
        ORDER BY c.table_schema, c.table_name, c.ordinal_position
        LIMIT 10001`;
      }),
    );
  }).pipe(
    Effect.provide(
      PgClient.layer({
        url: Redacted.make(connectionString),
        maxConnections: 1,
        prepare: false,
        connectTimeout: "5 seconds",
        applicationName: "t3-schema-connector",
        startupParameters: { statement_timeout: "10s", default_transaction_read_only: "on" },
      }),
    ),
    // Driver failures can contain the URI/password; never retain them in serializable errors.
    Effect.mapError(
      () =>
        new EnterpriseError({
          code: "connector_unreachable",
          message:
            "Could not read the database schema. Check the URL, TLS settings and permissions.",
        }),
    ),
  ),
);

const quote = (value: string) => JSON.stringify(value);

const make = Effect.gen(function* () {
  const digest = yield* Digest.Digest;
  const store = yield* EnterpriseStore.EnterpriseStore;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const proposals = yield* KnowledgeProposals.KnowledgeProposals;
  const repo = yield* KnowledgeRepo.KnowledgeRepo;
  const mutex = yield* Semaphore.make(1);
  const read = Effect.gen(function* () {
    const bytes = yield* secrets.get(secretName);
    if (Option.isNone(bytes)) return [];
    return yield* decodeConnections(new TextDecoder().decode(bytes.value));
  }).pipe(Effect.mapError(() => storageFailed));
  const save = Effect.fn("Connectors.save")(
    function* (connections: ReadonlyArray<Connection>) {
      if (connections.length === 0) return yield* secrets.remove(secretName);
      const encoded = yield* encodeConnections(connections);
      yield* secrets.set(secretName, new TextEncoder().encode(encoded));
    },
    Effect.mapError(() => storageFailed),
  );

  const execute = Effect.fn("Connectors.execute")(function* (
    email: string,
    input: EnterpriseConnectorInput,
  ) {
    const member = yield* store.getMember(email);
    if (member?.role !== "admin" || !(yield* store.canEnter(email)))
      return yield* new EnterpriseError({
        code: "admin_required",
        message: "Only enterprise admins can manage connectors.",
      });
    let connections = yield* read;
    let proposedCount = 0;
    if (input.action === "disconnect") {
      connections = connections.filter((c) => c.provider !== input.provider);
      yield* save(connections);
    } else if (input.action !== "list") {
      const connection =
        input.action === "connect" ? input : connections.find((c) => c.provider === input.provider);
      if (!connection)
        return yield* new EnterpriseError({
          code: "connector_not_found",
          message: "Connect this provider first.",
        });
      if (connection.area !== "general" && (yield* store.getTeam(connection.area)) === null)
        return yield* invalid;
      const valid = yield* Effect.try({
        try: () => {
          const url = new URL(connection.connectionString);
          return (
            ["postgres:", "postgresql:"].includes(url.protocol) &&
            !!url.hostname &&
            !!url.pathname.slice(1) &&
            connection.connectionString.length <= 8192
          );
        },
        catch: () => invalid,
      });
      if (!valid) return yield* invalid;
      const columns = yield* introspect(connection.connectionString);
      if (columns.length > 10000)
        return yield* new EnterpriseError({
          code: "connector_schema_too_large",
          message: "Schema exceeds the 10,000 column limit. Use a more restricted database role.",
        });
      if (input.action === "connect") {
        connections = [
          ...connections.filter((c) => c.provider !== input.provider),
          {
            provider: connection.provider,
            area: connection.area,
            connectionString: connection.connectionString,
          },
        ];
        yield* save(connections);
      }
      const tables = new Map<string, Array<(typeof columns)[number]>>();
      for (const column of columns) {
        const key = `${quote(column.table_schema)}.${quote(column.table_name)}`;
        const table = tables.get(key) ?? [];
        table.push(column);
        tables.set(key, table);
      }
      const documents = yield* repo.documents;
      for (const [key, table] of tables) {
        const first = table[0]!;
        const title = `${first.table_schema}.${first.table_name}`;
        const scope = connection.area === "general" ? "global" : connection.area;
        const prefix = scope === "global" ? "global" : `areas/${scope}`;
        const id = yield* digest.digestHex(
          Digest.sha256,
          new TextEncoder().encode(`${connection.provider}:${key}`),
        );
        const path = `${prefix}/data/${connection.provider}-${id}.md`;
        const content = `---\ntitle: ${quote(title)}\ndescription: ${quote(`${connection.provider} table schema for ${title}`)}\narea: ${quote(connection.area)}\nlayer: "Data"\nprivate: ${connection.area !== "general"}\nlinks: []\n---\n\n# ${quote(title)}\n\nSource: ${connection.provider} schema catalog. No row data collected.\n\n${table.map((c) => `- ${quote(c.column_name)}: ${quote(c.data_type)}${c.is_nullable === "YES" ? " (nullable)" : " (not null)"}`).join("\n")}\n`;
        const existing = documents.find((d) => d.id === path);
        if (existing?.content === content) continue;
        yield* proposals.propose(email, {
          kind: existing ? "update" : "create",
          scope,
          path,
          content,
          reason: "Import database table schema into the Data layer.",
          evidence: [],
        });
        proposedCount++;
      }
    }
    return {
      connections: connections.map(({ provider, area }) => ({ provider, area })),
      proposedCount,
    };
  }, mutex.withPermit);
  return Connectors.of({ execute });
});

export const layer = Layer.effect(Connectors, make).pipe(Layer.provide(Digest.layerWebCrypto));
