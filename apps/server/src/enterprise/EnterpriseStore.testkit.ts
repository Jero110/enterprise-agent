import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NodeURL from "node:url";

import * as Sqlite from "../persistence/Sqlite.ts";
import * as EnterpriseStore from "./EnterpriseStore.ts";

// fileURLToPath, not .pathname: on Windows .pathname gives "/C:/..." and the read fails.
export const acmeSeedPath = NodeURL.fileURLToPath(
  new URL("./fixtures/acme-bank.seed.json", import.meta.url),
);

/** An in-memory store seeded with the Acme Bank identities. Needs the Node crypto and file system services. */
export const layerSeededStore = Layer.effectDiscard(
  Effect.gen(function* () {
    const store = yield* EnterpriseStore.EnterpriseStore;
    yield* store.seed(yield* EnterpriseStore.loadSeedFile(acmeSeedPath));
  }),
).pipe(Layer.provideMerge(EnterpriseStore.layer), Layer.provideMerge(Sqlite.layerMemory));
