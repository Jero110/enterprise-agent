import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  EnterpriseIngestStartResult,
  ModelSelection,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  enterpriseEnvironment,
  enterpriseFiles,
  enterpriseFailureMessage,
  useEnterpriseStatus,
} from "~/state/enterprise";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { ConnectorsSection } from "./ConnectorsSection";
import { IngestTab } from "./IngestTab";
import { SharingTab, type PersonalSharing } from "./SharingTab";

export function ConnectedIngestTab({
  environmentId,
  modelSelection,
  onReview,
  onOpenMap,
}: {
  environmentId: EnvironmentId;
  modelSelection: ModelSelection;
  onReview: () => void;
  onOpenMap: () => void;
}) {
  const canStart = useAtomValue(enterpriseEnvironment.ingestStart.permissionAtom(environmentId));
  const { identity } = useEnterpriseStatus();
  const start = useAtomCommand(enterpriseEnvironment.ingestStart, {
    label: "start knowledge ingestion",
  });
  const upload = useAtomCommand(enterpriseFiles.upload, { label: "stage ingestion bucket" });
  return (
    <IngestTab
      environmentId={environmentId}
      onReview={onReview}
      onOpenMap={onOpenMap}
      connectors={<ConnectorsSection environmentId={environmentId} />}
      ingestion={{
        canStart,
        modelSelection,
        start: async (input) => {
          const result = await start({
            environmentId,
            input,
          });
          if (result._tag === "Failure")
            throw new Error(enterpriseFailureMessage(squashAtomCommandFailure(result)));
          return result.value satisfies EnterpriseIngestStartResult;
        },
        stageUpload: async (files, destination) => {
          const result = await upload({
            environmentId,
            input: {
              scope: destination,
              ...(destination === "personal" ? { recipient: identity!.email } : {}),
              reason: "Stage bucket for knowledge ingestion",
              files: [...files],
            },
          });
          if (result._tag === "Failure")
            throw new Error(enterpriseFailureMessage(squashAtomCommandFailure(result)));
          return { uploadProposalIds: [result.value.id] };
        },
      }}
    />
  );
}

export function ConnectedSharingTab({ environmentId }: { environmentId: EnvironmentId }) {
  const org = useEnvironmentQuery(enterpriseEnvironment.org({ environmentId, input: {} }));
  const sharing = useEnvironmentQuery(
    enterpriseEnvironment.knowledgeSharing({ environmentId, input: {} }),
  );
  const canShare = useAtomValue(enterpriseEnvironment.knowledgeShare.permissionAtom(environmentId));
  const canRevoke = useAtomValue(
    enterpriseEnvironment.knowledgeShareRevoke.permissionAtom(environmentId),
  );
  const share = useAtomCommand(enterpriseEnvironment.knowledgeShare, {
    label: "share personal knowledge",
  });
  const revoke = useAtomCommand(enterpriseEnvironment.knowledgeShareRevoke, {
    label: "revoke personal knowledge grant",
  });
  const roster = [
    ...new Map(
      (org.data?.teams ?? [])
        .flatMap((team) => team.members)
        .filter((member) => member.memberKey)
        .map((member) => [member.memberKey, member]),
    ).values(),
  ];
  const members = roster.flatMap((member) =>
    member.memberKey ? [{ memberKey: member.memberKey, displayName: member.displayName }] : [],
  );
  const grants = (sharing.data?.sharedByMe ?? []).flatMap((item) =>
    item.grants.map((grantee) => ({
      id: JSON.stringify([item.id, grantee.kind, grantee.target]),
      path: item.id,
      grantee,
      title: item.title,
      recipient:
        grantee.kind === "member"
          ? (members.find((member) => member.memberKey === grantee.target)?.displayName ??
            grantee.target)
          : (org.data?.teams.find((team) => team.id === grantee.target)?.name ?? grantee.target),
    })),
  );
  const adapter: PersonalSharing = {
    members,
    items: sharing.data?.sharedByMe ?? [],
    areas: org.data?.teams ?? [],
    listShared: {
      byMe: grants,
      withMe: (sharing.data?.sharedWithMe ?? []).map((item) => ({
        ...item,
        owner:
          members.find((member) => member.memberKey === item.id.split("/")[1])?.displayName ??
          "Personal knowledge owner",
      })),
    },
    canShare,
    canRevoke,
    share: async ({ itemId, grantee }) => {
      const result = await share({
        environmentId,
        input: { path: itemId, grantee: { kind: grantee.kind, target: grantee.id } },
      });
      if (result._tag === "Failure")
        throw new Error(enterpriseFailureMessage(squashAtomCommandFailure(result)));
    },
    revoke: async (id) => {
      const grant = grants.find((grant) => grant.id === id);
      if (!grant) throw new Error("Refresh sharing before revoking this grant.");
      const result = await revoke({
        environmentId,
        input: { path: grant.path, grantee: grant.grantee },
      });
      if (result._tag === "Failure")
        throw new Error(enterpriseFailureMessage(squashAtomCommandFailure(result)));
    },
    refresh: sharing.refresh,
  };
  if (sharing.error) return <p role="alert">{sharing.error}</p>;
  return <SharingTab sharing={adapter} />;
}
