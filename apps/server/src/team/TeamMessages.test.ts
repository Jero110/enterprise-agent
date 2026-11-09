import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it, describe } from "@effect/vitest";
import { teamMemberKey } from "@t3tools/shared/teamMemberKey";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SecureRandom from "effect/crypto/SecureRandom";

import * as TeamMessages from "./TeamMessages.ts";
import * as EnterpriseHub from "../enterprise/EnterpriseHub.ts";
import { layerSeededStore } from "../enterprise/EnterpriseStore.testkit.ts";
import * as ServerConfig from "../config.ts";
import { layerKnowledge } from "../knowledge/KnowledgeRepo.testkit.ts";

const layer = Layer.merge(
  TeamMessages.layer,
  EnterpriseHub.layer.pipe(Layer.provide(layerKnowledge)),
).pipe(
  Layer.provideMerge(layerSeededStore),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-team-messages-" })),
  Layer.provideMerge(
    Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, SecureRandom.layerWebCrypto),
  ),
);
const ana = "ent.test.ana@gmail.com";
const bruno = "ent.test.bruno@gmail.com";
const carla = "ent.test.carla@gmail.com";
const skill = { name: "rag-search", description: "Search the wiki", content: "# RAG\nUse it." };
const enroll = Effect.gen(function* () {
  const hub = yield* EnterpriseHub.EnterpriseHub;
  for (const email of [ana, bruno, carla]) {
    yield* hub.enroll(email, { email, token: "ACME-BANK-DEV-2026" });
  }
  return yield* TeamMessages.TeamMessages;
});
const code = <A>(effect: Effect.Effect<A, { readonly code: string }>) =>
  effect.pipe(
    Effect.map(() => "ok"),
    Effect.catch((error) => Effect.succeed(error.code)),
  );

describe("TeamMessages hub", () => {
  it.effect("only the two people in a message see it, and only the recipient reads it", () =>
    Effect.gen(function* () {
      const messages = yield* enroll;
      const sent = yield* messages.send(ana, { recipientKey: teamMemberKey(bruno), note: "hola" });
      expect(sent).toMatchObject({ outgoing: true, kind: "message", status: "unread" });
      expect(yield* messages.list(bruno)).toMatchObject([
        { id: sent.id, outgoing: false, note: "hola", fromKey: teamMemberKey(ana) },
      ]);
      expect(yield* messages.list(carla)).toEqual([]);
      expect(yield* code(messages.read(carla, { id: sent.id }))).toBe("message_not_found");
      // The sender opening their own message must not mark it read for the recipient.
      expect((yield* messages.read(ana, { id: sent.id })).status).toBe("unread");
      expect((yield* messages.read(bruno, { id: sent.id })).status).toBe("read");
      expect(yield* code(messages.read("not-enrolled", { id: sent.id }))).toBe("not_connected");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("rejects bad recipients, empty or oversized notes and unsafe skills", () =>
    Effect.gen(function* () {
      const messages = yield* enroll;
      const send = (input: Parameters<typeof messages.send>[1]) => code(messages.send(ana, input));
      expect(yield* send({ recipientKey: teamMemberKey(ana), note: "me" })).toBe("invalid_message");
      expect(yield* send({ recipientKey: teamMemberKey("nobody@example.com"), note: "x" })).toBe(
        "invalid_message",
      );
      expect(yield* send({ recipientKey: teamMemberKey(bruno), note: "   " })).toBe(
        "invalid_message",
      );
      expect(yield* send({ recipientKey: teamMemberKey(bruno), note: "x".repeat(2_001) })).toBe(
        "invalid_message",
      );
      for (const name of ["../evil", "Bad Name", "a/b", "..", ""])
        expect(
          yield* send({
            recipientKey: teamMemberKey(bruno),
            skill: { ...skill, name: name || "x y" },
          }),
        ).toBe("invalid_message");
      expect(
        yield* send({ recipientKey: teamMemberKey(bruno), skill: { ...skill, content: "  " } }),
      ).toBe("invalid_message");
      expect(
        yield* send({
          recipientKey: teamMemberKey(bruno),
          skill: { ...skill, content: "x".repeat(64_001) },
        }),
      ).toBe("invalid_message");
      expect(yield* messages.list(bruno)).toEqual([]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("a skill request is answered once, only by its recipient", () =>
    Effect.gen(function* () {
      const messages = yield* enroll;
      const withoutNote = yield* messages.send(ana, { recipientKey: teamMemberKey(bruno), skill });
      expect(withoutNote).toMatchObject({ kind: "skill", note: null, skill });
      const note = yield* messages.send(ana, { recipientKey: teamMemberKey(bruno), note: "hola" });
      const decide = (who: string, id: string, decision: "installed" | "declined") =>
        code(messages.decide(who, { id, decision }));
      expect(yield* decide(ana, withoutNote.id, "installed")).toBe("access_denied");
      expect(yield* decide(carla, withoutNote.id, "installed")).toBe("message_not_found");
      expect(yield* decide(bruno, note.id, "installed")).toBe("invalid_message");
      expect(yield* decide(bruno, withoutNote.id, "installed")).toBe("ok");
      expect(yield* decide(bruno, withoutNote.id, "declined")).toBe("conflict");
      expect((yield* messages.list(ana)).find((m) => m.id === withoutNote.id)?.status).toBe(
        "installed",
      );
    }).pipe(Effect.provide(layer)),
  );

  it.effect("stops a flood of unread messages until the recipient reads some", () =>
    Effect.gen(function* () {
      const messages = yield* enroll;
      const to = { recipientKey: teamMemberKey(bruno) };
      for (let index = 0; index < TeamMessages.TEAM_MESSAGE_UNREAD_LIMIT; index++)
        yield* messages.send(ana, { ...to, note: `${index}` });
      expect(yield* code(messages.send(ana, { ...to, note: "one more" }))).toBe(
        "too_many_messages",
      );
      // Others can still reach the same person.
      expect(yield* code(messages.send(carla, { ...to, note: "hi" }))).toBe("ok");
      const [latest] = yield* messages.list(bruno);
      yield* messages.read(bruno, { id: latest!.id });
      const fromAna = (yield* messages.list(bruno)).find((m) => m.fromKey === teamMemberKey(ana));
      yield* messages.read(bruno, { id: fromAna!.id });
      expect(yield* code(messages.send(ana, { ...to, note: "now fine" }))).toBe("ok");
    }).pipe(Effect.provide(layer)),
  );
});
