import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  TeamMemberRole,
  type EnterpriseMemberSummary,
  type EnterpriseTeamSummary,
  type EnvironmentId,
} from "@t3tools/contracts";
import { useState } from "react";

import {
  enterpriseEnvironment,
  enterpriseFailureMessage,
  useEnterpriseStatus,
} from "~/state/enterprise";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { ConnectEnterpriseDialog } from "../enterprise/ConnectEnterpriseDialog";
import { createEnterpriseInvite } from "../enterprise/invite";
import { ContextChanges } from "../enterprise/ContextChanges";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

const NO_TEAM = "none";

export function EnterpriseSettingsPanel() {
  const { environmentId, identity, error, isPending } = useEnterpriseStatus();
  return (
    <SettingsPageContainer>
      <SettingsSection title="Enterprise">
        {environmentId === null || isPending ? (
          <SettingsRow title="Loading…" role="status" />
        ) : (
          <IdentityRows environmentId={environmentId} identity={identity} error={error} />
        )}
      </SettingsSection>
      {environmentId !== null && identity ? (
        <>
          <YourContextSection environmentId={environmentId} />
          <ContextChanges environmentId={environmentId} />
        </>
      ) : null}
      {environmentId !== null && identity?.role === "admin" ? (
        <>
          <MembersSection environmentId={environmentId} />
        </>
      ) : null}
    </SettingsPageContainer>
  );
}

function YourContextSection({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const documents = useEnvironmentQuery(
    enterpriseEnvironment.knowledgeList({ environmentId, input: {} }),
  );
  const [open, setOpen] = useState<string | null>(null);
  return (
    <SettingsSection title="Your context">
      {documents.error ? (
        <SettingsRow title="Could not load your context" description={documents.error} />
      ) : !documents.data ? (
        <SettingsRow title="Loading…" role="status" />
      ) : documents.data.documents.length === 0 ? (
        <SettingsRow title="No documents you can read yet" />
      ) : (
        documents.data.documents.map((doc) => (
          <SettingsRow
            key={doc.id}
            title={doc.title}
            description={`${doc.id} · ${doc.areaId}`}
            control={
              <Button
                size="xs"
                variant="outline"
                onClick={() => setOpen(open === doc.id ? null : doc.id)}
              >
                {open === doc.id ? "Hide" : "View"}
              </Button>
            }
          >
            {open === doc.id ? <DocumentBody environmentId={environmentId} path={doc.id} /> : null}
          </SettingsRow>
        ))
      )}
    </SettingsSection>
  );
}

function DocumentBody({
  environmentId,
  path,
}: {
  readonly environmentId: EnvironmentId;
  readonly path: string;
}) {
  const document = useEnvironmentQuery(
    enterpriseEnvironment.knowledgeGet({ environmentId, input: { path } }),
  );
  return (
    <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
      {document.error ?? document.data?.content ?? "Loading…"}
    </pre>
  );
}

function IdentityRows({
  environmentId,
  identity,
  error,
}: {
  readonly environmentId: EnvironmentId;
  readonly identity: ReturnType<typeof useEnterpriseStatus>["identity"];
  readonly error: string | null;
}) {
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const disconnect = useAtomCommand(enterpriseEnvironment.disconnect, {
    label: "disconnect enterprise",
    reportFailure: false,
  });
  const leave = async () => {
    setBusy(true);
    await disconnect({ environmentId, input: {} });
    setBusy(false);
  };
  return (
    <>
      {identity ? (
        <SettingsRow
          title={`${identity.displayName} · ${identity.role}`}
          description={`${identity.email} · ${identity.teamName ?? "No team"}`}
          control={
            <Button
              size="xs"
              variant="destructive-outline"
              disabled={busy}
              onClick={() => void leave()}
            >
              {busy ? "Disconnecting…" : "Disconnect"}
            </Button>
          }
        />
      ) : (
        <SettingsRow
          title="Not connected"
          description="Connect with your work email and a one-time Enterprise invite. Nothing changes here until you do."
          control={
            <Button size="xs" onClick={() => setConnecting(true)}>
              Connect Enterprise
            </Button>
          }
        />
      )}
      {error ? (
        <SettingsRow title="The hub did not confirm your access" description={error} />
      ) : null}
      <ConnectEnterpriseDialog
        environmentId={environmentId}
        open={connecting}
        onOpenChange={setConnecting}
      />
    </>
  );
}

function MembersSection({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const members = useEnvironmentQuery(enterpriseEnvironment.members({ environmentId, input: {} }));
  return (
    <SettingsSection title="Members">
      <InviteRow />
      <AuthorizeRow environmentId={environmentId} teams={members.data?.teams ?? []} />
      {members.error ? (
        <SettingsRow title="Could not load members" description={members.error} />
      ) : !members.data ? (
        <SettingsRow title="Loading members…" role="status" />
      ) : (
        members.data.members.map((member) => (
          <MemberRow
            key={member.email}
            environmentId={environmentId}
            member={member}
            teams={members.data?.teams ?? []}
          />
        ))
      )}
    </SettingsSection>
  );
}

function InviteRow() {
  const [url, setUrl] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [token, setToken] = useState("");
  const [invite, setInvite] = useState("");
  const [error, setError] = useState("");
  return (
    <SettingsRow
      title="Create an Enterprise invite"
      description="On the hub, get a fresh pairing code in Connections. Use its HTTPS or Tailscale address. Each code works once. The invite contains the reusable Enterprise token (encoded, not encrypted); share it privately."
    >
      <form
        className="mt-3 flex flex-wrap items-center gap-2"
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          try {
            setInvite(createEnterpriseInvite(url, pairingCode, token));
            setError("");
          } catch {
            setInvite("");
            setError("Enter the hub address, pairing code and Enterprise token.");
          }
        }}
      >
        <Input
          aria-label="Hub address"
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            setInvite("");
          }}
          placeholder="https://hub.example.ts.net"
          nativeInput
          spellCheck={false}
        />
        <Input
          aria-label="Hub pairing code"
          value={pairingCode}
          onChange={(event) => {
            setPairingCode(event.target.value);
            setInvite("");
          }}
          placeholder="Fresh pairing code"
          nativeInput
          spellCheck={false}
        />
        <Input
          aria-label="Enterprise token"
          type="password"
          value={token}
          onChange={(event) => {
            setToken(event.target.value);
            setInvite("");
          }}
          placeholder="Enterprise token"
          nativeInput
          spellCheck={false}
        />
        <Button size="xs" type="submit">
          Create invite
        </Button>
      </form>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-destructive-foreground">
          {error}
        </p>
      ) : null}
      {invite ? (
        <div className="mt-3 flex items-center gap-2">
          <Input
            aria-label="Enterprise invite"
            value={invite}
            readOnly
            nativeInput
            spellCheck={false}
          />
          <Button
            size="xs"
            variant="outline"
            onClick={() => void navigator.clipboard.writeText(invite)}
          >
            Copy
          </Button>
        </div>
      ) : null}
    </SettingsRow>
  );
}

function TeamRoleControls({
  teams,
  teamId,
  role,
  disabled,
  onChange,
}: {
  readonly teams: ReadonlyArray<EnterpriseTeamSummary>;
  readonly teamId: string | null;
  readonly role: TeamMemberRole;
  readonly disabled: boolean;
  readonly onChange: (next: { teamId: string | null; role: TeamMemberRole }) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Select
        value={teamId ?? NO_TEAM}
        disabled={disabled}
        onValueChange={(next) => {
          if (next !== null) onChange({ teamId: next === NO_TEAM ? null : next, role });
        }}
      >
        <SelectTrigger size="xs" aria-label="Team">
          <SelectValue>{teams.find((team) => team.id === teamId)?.name ?? "No team"}</SelectValue>
        </SelectTrigger>
        <SelectPopup alignItemWithTrigger={false}>
          <SelectItem value={NO_TEAM} hideIndicator>
            No team
          </SelectItem>
          {teams.map((team) => (
            <SelectItem key={team.id} value={team.id} hideIndicator>
              {team.name}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      <Select
        value={role}
        disabled={disabled}
        onValueChange={(next) => {
          if (next !== null) onChange({ teamId, role: next as TeamMemberRole });
        }}
      >
        <SelectTrigger size="xs" aria-label="Role">
          <SelectValue>{role}</SelectValue>
        </SelectTrigger>
        <SelectPopup alignItemWithTrigger={false}>
          {TeamMemberRole.literals.map((option) => (
            <SelectItem key={option} value={option} hideIndicator>
              {option}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  );
}

function useMemberCommands() {
  const authorize = useAtomCommand(enterpriseEnvironment.authorize, {
    label: "authorize enterprise member",
    reportFailure: false,
  });
  const revoke = useAtomCommand(enterpriseEnvironment.revoke, {
    label: "revoke enterprise member",
    reportFailure: false,
  });
  const report = (result: Awaited<ReturnType<typeof authorize>>, title: string) => {
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toastManager.add({
        type: "error",
        title,
        description: enterpriseFailureMessage(squashAtomCommandFailure(result)),
      });
    }
    return result._tag === "Success";
  };
  return { authorize, revoke, report };
}

function MemberRow({
  environmentId,
  member,
  teams,
}: {
  readonly environmentId: EnvironmentId;
  readonly member: EnterpriseMemberSummary;
  readonly teams: ReadonlyArray<EnterpriseTeamSummary>;
}) {
  const { authorize, revoke, report } = useMemberCommands();
  const [busy, setBusy] = useState(false);
  const run = async (
    action: () => Promise<Awaited<ReturnType<typeof authorize>>>,
    title: string,
  ) => {
    setBusy(true);
    report(await action(), title);
    setBusy(false);
  };
  const save = (next: { teamId: string | null; role: TeamMemberRole }) =>
    run(
      () =>
        authorize({
          environmentId,
          input: { email: member.email, displayName: member.displayName, ...next },
        }),
      "Could not update the member",
    );
  return (
    <SettingsRow
      title={member.displayName}
      description={member.active ? member.email : `${member.email} · revoked`}
      control={
        <div className="flex items-center gap-2">
          <TeamRoleControls
            teams={teams}
            teamId={member.teamId}
            role={member.role}
            disabled={busy || !member.active}
            onChange={(next) => void save(next)}
          />
          {member.active ? (
            <Button
              size="xs"
              variant="destructive-outline"
              disabled={busy}
              onClick={() =>
                void run(
                  () => revoke({ environmentId, input: { email: member.email } }),
                  "Could not revoke the email",
                )
              }
            >
              Revoke
            </Button>
          ) : (
            <Button size="xs" variant="outline" disabled={busy} onClick={() => void save(member)}>
              Authorize
            </Button>
          )}
        </div>
      }
    />
  );
}

function AuthorizeRow({
  environmentId,
  teams,
}: {
  readonly environmentId: EnvironmentId;
  readonly teams: ReadonlyArray<EnterpriseTeamSummary>;
}) {
  const { authorize, report } = useMemberCommands();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = email.trim().length > 0;
  const teamId = teams[0]?.id ?? null;
  const submit = async () => {
    if (!ready || busy) return;
    const normalizedEmail = email.trim();
    setBusy(true);
    const ok = report(
      await authorize({
        environmentId,
        input: {
          email: normalizedEmail,
          displayName: normalizedEmail.split("@", 1)[0] || normalizedEmail,
          teamId,
          role: "member",
        },
      }),
      "Could not authorize the email",
    );
    setBusy(false);
    if (ok) setEmail("");
  };
  return (
    <SettingsRow
      title="Add a member"
      description="Enter their email. They join the default team and can connect with a one-time Enterprise invite."
    >
      <form
        className="mt-3 flex flex-wrap items-center gap-2"
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Input
          aria-label="Email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="email"
          disabled={busy}
          nativeInput
          spellCheck={false}
        />
        <Button size="xs" type="submit" disabled={busy || !ready}>
          Add member
        </Button>
      </form>
    </SettingsRow>
  );
}
