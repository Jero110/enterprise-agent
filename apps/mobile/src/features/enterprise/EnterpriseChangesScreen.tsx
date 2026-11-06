import type { EnvironmentId, KnowledgeProposal } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { StaticScreenProps } from "@react-navigation/native";
import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { File } from "expo-file-system";
import * as DocumentPicker from "expo-document-picker";
import { shareGeneratedAttachment } from "../../lib/attachmentDownload";
import { AppText as Text } from "../../components/ui/AppText";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { enterpriseEnvironment, enterpriseFiles } from "../../state/enterprise";
import { prepareEnterpriseUpload, type PickedEnterpriseFile } from "./enterprise-upload";

function Action({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      className="rounded-lg border border-border px-3 py-2 disabled:opacity-50"
    >
      <Text className="text-foreground">{label}</Text>
    </Pressable>
  );
}

export function EnterpriseChangesScreen({
  route,
}: StaticScreenProps<{ readonly environmentId: EnvironmentId }>) {
  const environmentId = route.params.environmentId;
  const status = useEnvironmentQuery(enterpriseEnvironment.status({ environmentId, input: {} }));
  const inbox = useEnvironmentQuery(
    enterpriseEnvironment.proposalInbox({ environmentId, input: {} }),
  );
  const org = useEnvironmentQuery(enterpriseEnvironment.org({ environmentId, input: {} }));
  const permission = useAtomValue(
    enterpriseEnvironment.proposalDecide.permissionAtom(environmentId),
  );
  const decide = useAtomCommand(enterpriseEnvironment.proposalDecide, {
    label: "resolve context proposal",
    reportFailure: false,
  });
  const upload = useAtomCommand(enterpriseFiles.upload, {
    label: "stage context files",
    reportFailure: false,
  });
  const download = useAtomCommand(enterpriseFiles.download, {
    label: "download context file",
    reportFailure: false,
  });
  const [scope, setScope] = useState("personal");
  const [recipient, setRecipient] = useState("");
  const [reason, setReason] = useState("");
  const [rejection, setRejection] = useState("");
  const [files, setFiles] = useState<PickedEnterpriseFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const proposals = inbox.data?.proposals ?? [];
  const active = proposals.find((proposal) => proposal.id === selected) ?? null;
  const me = status.data?.identity;
  const groups = [
    {
      label: "Assigned",
      proposals: proposals.filter(
        (proposal) =>
          proposal.status === "pending" &&
          (proposal.canDecide || proposal.proposedBy !== me?.email),
      ),
    },
    {
      label: "Authored",
      proposals: proposals.filter(
        (proposal) => proposal.status === "pending" && proposal.proposedBy === me?.email,
      ),
    },
    { label: "History", proposals: proposals.filter((proposal) => proposal.status !== "pending") },
  ];
  const scopes = [
    { id: "personal", label: "Personal" },
    ...(org.data?.teams ?? [])
      .filter((team) => me?.role === "admin" || team.access !== "none")
      .map((team) => ({ id: team.id, label: team.name })),
    { id: "global", label: "Company" },
  ];

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The hub request failed.");
    }
    setBusy(false);
  }
  const refresh = () => {
    inbox.refresh();
  };
  const resolve = (proposal: KnowledgeProposal, action: "approve" | "reject" | "revert") =>
    void run(async () => {
      const result = await decide({
        environmentId,
        input: {
          id: proposal.id,
          action,
          ...(action === "reject" ? { reason: rejection.trim() } : {}),
        },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      setRejection("");
      refresh();
    });
  const share = (
    proposal: KnowledgeProposal,
    attachment: NonNullable<KnowledgeProposal["files"]>[number],
  ) =>
    void run(async () => {
      const result = await download({
        environmentId,
        input: { proposalId: proposal.id, fileId: attachment.id },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      const shared = await shareGeneratedAttachment({
        bytes: new Uint8Array(result.value),
        attachment,
        signal: new AbortController().signal,
      });
      if (!shared) throw new Error("Sharing files is unavailable on this device.");
    });
  const pick = () =>
    void run(async () => {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (!result.canceled)
        setFiles(
          result.assets.map((file) => ({
            name: file.name,
            uri: file.uri,
            size: file.size ?? 0,
            mimeType: file.mimeType,
          })),
        );
    });
  const submit = () =>
    void run(async () => {
      if (!reason.trim() || (scope === "personal" && !recipient.trim()))
        throw new Error("Add a reason and a recipient for personal files.");
      const encoded = await prepareEnterpriseUpload(files, async (uri) => new File(uri).base64());
      const result = await upload({
        environmentId,
        input: {
          scope,
          reason: reason.trim(),
          ...(scope === "personal" ? { recipient: recipient.trim() } : {}),
          files: encoded,
        },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      setFiles([]);
      setReason("");
      setSelected(result.value.id);
      refresh();
    });
  return (
    <ScreenScrollView className="flex-1" contentContainerClassName="gap-4 px-5 py-5">
      <Text className="text-xl font-semibold text-foreground">Context changes</Text>
      {!me && (
        <Text className="text-foreground-muted">
          {status.error ?? "Connect to an enterprise hub to review context changes."}
        </Text>
      )}
      {inbox.error && <Text className="text-danger-foreground">{inbox.error}</Text>}
      {error && (
        <Text selectable className="text-danger-foreground">
          {error}
        </Text>
      )}
      <Action label="Refresh proposals" onPress={refresh} />
      {me &&
        groups.map((group) => (
          <View key={group.label} className="gap-2">
            <Text className="font-semibold text-foreground">
              {group.label} ({group.proposals.length})
            </Text>
            {group.proposals.map((proposal) => (
              <Action
                key={proposal.id}
                label={`${proposal.kind === "upload" ? proposal.files?.map((file) => file.name).join(", ") : proposal.path || proposal.kind} · ${proposal.status} · ${proposal.proposedBy}`}
                onPress={() => setSelected(proposal.id)}
              />
            ))}
          </View>
        ))}
      {active && (
        <View className="gap-2 rounded-lg border border-border p-3">
          <Text className="font-semibold text-foreground">
            {active.scope === "global"
              ? "Company"
              : active.scope === "personal"
                ? `Personal · ${active.recipient}`
                : `Area · ${active.scope}`}
          </Text>
          <Text className="text-foreground">
            Authored by {active.proposedBy} ·{" "}
            {active.status === "approved-awaiting-processing"
              ? "Approved, awaiting processing (not in current context)"
              : active.status}
          </Text>
          <Text className="text-foreground">
            Reviewers:{" "}
            {active.reviewers
              ?.map((reviewer) => `${reviewer.email} (${reviewer.role})`)
              .join(", ") || "Not assigned"}
          </Text>
          <Text className="text-foreground">{active.reason}</Text>
          {active.content && (
            <Text selectable className="text-foreground">
              {active.content}
            </Text>
          )}
          {active.rejectionReason && (
            <Text className="text-foreground">Rejected: {active.rejectionReason}</Text>
          )}
          {active.resolvedBy && (
            <Text className="text-foreground">
              Resolved by {active.resolvedBy} · {active.resolvedAt}
            </Text>
          )}
          {active.files?.map((file) => (
            <Action
              key={file.id}
              label={`Share ${file.name} (${Math.ceil(file.sizeBytes / 1024)} KiB)`}
              disabled={busy}
              onPress={() => share(active, file)}
            />
          ))}
          {active.status === "pending" && active.canDecide && permission && (
            <View className="gap-2">
              <Action label="Approve" disabled={busy} onPress={() => resolve(active, "approve")} />
              <TextInput
                accessibilityLabel="Rejection reason"
                placeholder="Rejection reason"
                value={rejection}
                onChangeText={setRejection}
                className="rounded-lg border border-border p-3 text-foreground"
              />
              <Action
                label="Reject"
                disabled={busy || !rejection.trim()}
                onPress={() => resolve(active, "reject")}
              />
            </View>
          )}
          {active.status === "applied" && active.canDecide && permission && (
            <Action label="Revert" disabled={busy} onPress={() => resolve(active, "revert")} />
          )}
        </View>
      )}
      {me && (
        <View className="gap-3">
          <Text className="text-lg font-semibold text-foreground">Ingest files</Text>
          <Text className="text-foreground-muted">
            Files are staged for review, not added to current context.
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {scopes.map((item) => (
              <Action
                key={item.id}
                label={`${scope === item.id ? "Selected: " : ""}${item.label}`}
                onPress={() => setScope(item.id)}
              />
            ))}
          </View>
          {scope === "personal" && (
            <TextInput
              accessibilityLabel="Recipient email"
              autoCapitalize="none"
              placeholder="Recipient email"
              value={recipient}
              onChangeText={setRecipient}
              className="rounded-lg border border-border p-3 text-foreground"
            />
          )}
          <TextInput
            accessibilityLabel="Reason for ingest"
            placeholder="Why are these files relevant?"
            value={reason}
            onChangeText={setReason}
            className="rounded-lg border border-border p-3 text-foreground"
          />
          <Action label="Choose files" disabled={busy} onPress={pick} />
          <Text className="text-foreground-muted">
            {files.map((file) => file.name).join(", ") || "No files selected"}
          </Text>
          <Action label="Stage for review" disabled={busy || files.length === 0} onPress={submit} />
        </View>
      )}
    </ScreenScrollView>
  );
}
