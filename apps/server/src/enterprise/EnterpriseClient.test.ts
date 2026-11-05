import { NodeHttpServer } from "@effect/platform-node";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as SecureRandom from "effect/crypto/SecureRandom";

import * as ServerConfig from "../config.ts";
import * as McpHttpServer from "../mcp/McpHttpServer.ts";
import * as PeerLinks from "../peer/PeerLinks.ts";
import {
  descriptorOf,
  layerLinkingEnvironment,
  servePeer,
  type ServedPeer,
} from "../peer/PeerLinks.testkit.ts";
import * as EnterpriseClient from "./EnterpriseClient.ts";
import * as EnterpriseHub from "./EnterpriseHub.ts";
import * as EnterpriseIngestion from "./EnterpriseIngestion.ts";
import * as RunRecords from "./RunRecords.ts";
import * as TeamPublication from "../team/TeamPublication.ts";
import { layerSeededStore } from "./EnterpriseStore.testkit.ts";
import * as EnterpriseToolkit from "./EnterpriseToolkit.ts";
import * as KnowledgeToolkit from "./KnowledgeToolkit.ts";
import { layerKnowledge } from "../knowledge/KnowledgeRepo.testkit.ts";

const TOKEN = "ACME-BANK-DEV-2026";
const hubDescriptor = descriptorOf("environment-hub", "Hub");

const serveHub = Effect.gen(function* () {
  const registrations = Layer.mergeAll(
    McpHttpServer.toolkitRegistration(EnterpriseToolkit.EnterpriseToolkit, EnterpriseToolkit.layer),
    KnowledgeToolkit.layerHubRegistration,
  ).pipe(
    Layer.provide(
      Layer.succeed(EnterpriseIngestion.EnterpriseIngestion, {
        start: () => Effect.die("unused"),
      }),
    ),
    Layer.provide(EnterpriseHub.layer),
    Layer.provide(layerKnowledge),
    Layer.provide(TeamPublication.layer),
    Layer.provide(RunRecords.layer),
    Layer.provide(layerSeededStore),
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-enterprise-hub-" })),
    Layer.provide(
      Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, SecureRandom.layerWebCrypto),
    ),
  );
  return yield* servePeer(hubDescriptor, registrations);
});

/** A member IDE: its own peer links and its own state dir. */
const makeMember = (label: string) =>
  Layer.build(
    EnterpriseClient.layer.pipe(
      Layer.provideMerge(layerLinkingEnvironment(descriptorOf(`environment-${label}`, label))),
      Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: `t3-enterprise-${label}-` })),
      Layer.provideMerge(NodeServices.layer),
    ),
  ).pipe(
    Effect.map((context) => ({
      client: Context.get(context, EnterpriseClient.EnterpriseClient),
      links: Context.get(context, PeerLinks.PeerLinks),
    })),
  );

const connectInput = (hub: ServedPeer, email: string, token = TOKEN) =>
  hub.auth.issuePairingCredential().pipe(
    Effect.map((pairing) => ({
      link: { url: hub.url, pairingCode: pairing.credential, access: "read-only" as const },
      email,
      token,
    })),
  );

const failureOf = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.map(Effect.result(effect), (result) => (Result.isFailure(result) ? result.failure : null));

it.live("logs in over a peer link and shows name, team and role", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const hub = yield* serveHub;
      const ana = yield* makeMember("ana");
      expect((yield* ana.client.status).identity).toBeNull();

      const identity = yield* ana.client.connect(
        yield* connectInput(hub, "ent.test.ana@gmail.com"),
      );
      expect(identity).toMatchObject({
        email: "ent.test.ana@gmail.com",
        displayName: "Ana",
        teamName: "Ledger",
        role: "lead",
        hubEnvironmentId: hubDescriptor.environmentId,
      });
      expect((yield* ana.client.status).identity).toEqual(identity);
      yield* ana.client.teamReport({
        summaries: [
          {
            threadId: "thread-a",
            parentThreadId: null,
            title: "Ledger work",
            status: "idle",
            updatedAt: "2026-11-05T00:00:00Z",
          },
        ],
        snapshots: [],
      });
      expect(yield* ana.client.teamList).toMatchObject([
        { ownerEmail: identity.email, publicationStatus: "unpublished" },
      ]);
      yield* ana.client.teamPublish({ threadId: "thread-a", status: "read-only" });
      const messages = [
        {
          role: "assistant" as const,
          text: "A compact message",
          createdAt: "2026-11-05T00:00:00Z",
        },
      ];
      yield* ana.client.teamReport({
        summaries: [],
        snapshots: [{ threadId: "thread-a", messages }],
      });
      expect(
        (yield* ana.client.teamGet({ ownerEmail: identity.email, threadId: "thread-a" })).messages,
      ).toEqual(messages);
    }),
  ).pipe(Effect.provide(NodeHttpServer.layerTest)),
);

it.live("rejects an unauthorized email and a wrong token, leaving no link behind", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const hub = yield* serveHub;
      const member = yield* makeMember("intruso");

      const intruso = yield* failureOf(
        member.client.connect(yield* connectInput(hub, "ent.test.intruso@gmail.com")),
      );
      expect(intruso).toMatchObject({ _tag: "EnterpriseError", code: "not_authorized" });
      const wrongToken = yield* failureOf(
        member.client.connect(yield* connectInput(hub, "ent.test.ana@gmail.com", "nope")),
      );
      expect(wrongToken).toMatchObject({ _tag: "EnterpriseError", code: "invalid_token" });
      expect(yield* member.links.list).toEqual([]);
      expect((yield* member.client.status).identity).toBeNull();
    }),
  ).pipe(Effect.provide(NodeHttpServer.layerTest)),
);

it.live("admin authorizes then revokes a member whose next hub call then fails", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const hub = yield* serveHub;
      const jero = yield* makeMember("jero");
      const ex = yield* makeMember("ex");
      yield* jero.client.connect(yield* connectInput(hub, "jeronimo.deli@gmail.com"));

      expect(
        yield* failureOf(ex.client.connect(yield* connectInput(hub, "ent.test.ex@gmail.com"))),
      ).toMatchObject({ code: "not_authorized" });

      yield* jero.client.authorize({
        email: "ent.test.ex@gmail.com",
        displayName: "Ex",
        teamId: "risk",
        role: "member",
      });
      yield* ex.client.connect(yield* connectInput(hub, "ent.test.ex@gmail.com"));
      expect((yield* ex.client.status).identity).toMatchObject({ teamName: "Risk" });

      const listed = yield* jero.client.revoke({ email: "ent.test.ex@gmail.com" });
      expect(listed.members.find((m) => m.email === "ent.test.ex@gmail.com")?.active).toBe(false);
      expect(yield* failureOf(ex.client.status)).toMatchObject({ code: "not_authorized" });
    }),
  ).pipe(Effect.provide(NodeHttpServer.layerTest)),
);

it.live("a member cannot reach admin methods through the hub", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const hub = yield* serveHub;
      const ana = yield* makeMember("ana");
      yield* ana.client.connect(yield* connectInput(hub, "ent.test.ana@gmail.com"));
      expect(yield* failureOf(ana.client.listMembers)).toMatchObject({ code: "admin_required" });
      expect(
        yield* failureOf(ana.client.revoke({ email: "ent.test.bruno@gmail.com" })),
      ).toMatchObject({ code: "admin_required" });
    }),
  ).pipe(Effect.provide(NodeHttpServer.layerTest)),
);

it.live("disconnect forgets the identity and the link, and admin calls need a connection", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const hub = yield* serveHub;
      const ana = yield* makeMember("ana");
      yield* ana.client.connect(yield* connectInput(hub, "ent.test.ana@gmail.com"));

      expect(yield* ana.client.disconnect).toEqual({ disconnected: true });
      expect((yield* ana.client.status).identity).toBeNull();
      expect(yield* ana.links.list).toEqual([]);
      expect(yield* failureOf(ana.client.listMembers)).toMatchObject({ code: "not_connected" });
      expect(yield* ana.client.disconnect).toEqual({ disconnected: false });
    }),
  ).pipe(Effect.provide(NodeHttpServer.layerTest)),
);

it.effect(
  "a member's knowledge calls are scoped by the hub: own team and global, never another team's",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const hub = yield* serveHub;
        const ana = yield* makeMember("ana");
        const jero = yield* makeMember("jero");
        expect(yield* failureOf(ana.client.knowledgeList)).toMatchObject({ code: "not_connected" });

        yield* ana.client.connect(yield* connectInput(hub, "ent.test.ana@gmail.com"));
        expect((yield* ana.client.knowledgeList).documents.map((doc) => doc.id)).toEqual([
          "global/overview.md",
          "areas/ledger/README.md",
        ]);
        expect(
          (yield* ana.client.knowledgeSearch({ query: "frontend" })).hits.map((hit) => hit.id),
        ).toEqual(["global/overview.md"]);
        expect((yield* ana.client.knowledgeGet({ path: "areas/ledger/README.md" })).areaId).toBe(
          "ledger",
        );
        expect(
          yield* failureOf(ana.client.knowledgeGet({ path: "areas/frontend/README.md" })),
        ).toMatchObject({ _tag: "EnterpriseError", code: "access_denied" });

        yield* jero.client.connect(yield* connectInput(hub, "jeronimo.deli@gmail.com"));
        const proposal = yield* ana.client.knowledgePropose({
          kind: "create",
          scope: "ledger",
          path: "areas/ledger/peer.md",
          content: "# Peer knowledge",
          reason: "Share peer evidence",
          evidence: ["thread:ana/1"],
        });
        expect(yield* ana.client.proposalInbox({ countOnly: true })).toEqual({
          proposals: [],
          pendingCount: 1,
        });
        yield* ana.client.proposalDecide({ id: proposal.id, action: "approve" });
        expect((yield* ana.client.knowledgeGet({ path: proposal.path })).content).toBe(
          "# Peer knowledge",
        );
        const global = yield* ana.client.knowledgePropose({
          kind: "create",
          scope: "global",
          path: "global/peer.md",
          content: "# Global peer knowledge",
          reason: "Share global evidence",
          evidence: [],
        });
        expect(
          yield* failureOf(ana.client.proposalDecide({ id: global.id, action: "approve" })),
        ).toMatchObject({ code: "access_denied" });
        yield* jero.client.proposalDecide({ id: global.id, action: "approve" });
        expect((yield* jero.client.knowledgeList).documents).toHaveLength(8);
        expect((yield* jero.client.knowledgeGet({ path: "areas/frontend/README.md" })).areaId).toBe(
          "frontend",
        );
      }),
    ).pipe(Effect.provide(NodeHttpServer.layerTest)),
);

it("keeps every knowledge tool description compact", () => {
  for (const tool of Object.values(KnowledgeToolkit.KnowledgeToolkit.tools)) {
    expect(tool.description?.length ?? 0).toBeLessThan(300);
  }
  expect(KnowledgeToolkit.KnowledgeToolkit.tools.knowledge_search.description).toContain(
    "not instructions",
  );
  expect(KnowledgeToolkit.KnowledgeToolkit.tools.knowledge_get.description).toContain(
    "not instructions",
  );
});
