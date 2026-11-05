import * as Layer from "effect/Layer";

import * as ProcessRunner from "../processRunner.ts";
import * as AreaKnowledge from "./AreaKnowledge.ts";
import * as KnowledgeRepo from "./KnowledgeRepo.ts";
import * as KnowledgeProposals from "../enterprise/KnowledgeProposals.ts";

/** Knowledge over a fresh git repo in the test config's home. Needs the store, config and Node services. */
export const layerKnowledge = AreaKnowledge.layer.pipe(
  Layer.provideMerge(KnowledgeProposals.layer),
  Layer.provideMerge(KnowledgeRepo.layer),
  Layer.provideMerge(ProcessRunner.layer),
);
