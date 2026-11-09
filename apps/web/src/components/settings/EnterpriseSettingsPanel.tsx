import { useAtomValue } from "@effect/atom-react";
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

import { t } from "~/i18n";

import {
  enterpriseEnvironment,
  enterpriseFailureMessage,
  useEnterpriseStatus,
} from "~/state/enterprise";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { ConnectEnterpriseDialog } from "../enterprise/ConnectEnterpriseDialog";
import { createEnterpriseInvite } from "../enterprise/invite";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { ScopedSwitch } from "./ScopedSwitch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

const NO_TEAM = "none";

export function EnterpriseSettingsPanel() {
  const { environmentId, identity, error, isPending } = useEnterpriseStatus();
  return (
    <SettingsPageContainer>
      <SettingsSection title="Enterprise">
        {environmentId === null || isPending ? (
          <SettingsRow title={t("Loading…")} role="status" />
        ) : (
          <IdentityRows environmentId={environmentId} identity={identity} error={error} />
        )}
      </SettingsSection>
      <TeamWikiSection />
      {environmentId !== null && identity?.role === "admin" ? (
        <MembersSection environmentId={environmentId} />
      ) : null}
    </SettingsPageContainer>
  );
}

function TeamWikiSection() {
  const citeWikiSources = useScopedSettings((settings) => settings.citeWikiSources);
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsSection title="Team wiki">
      <SettingsRow
        serverScoped
        settingKeys={["citeWikiSources"]}
        {...searchableSetting("cite-wiki-sources")}
        description="When an agent answers with information from the team wiki, it ends with a short Sources list of the pages it used, so you can check where the answer came from. Applies to new conversations."
        control={
          <ScopedSwitch
            settingKeys={["citeWikiSources"]}
            checked={citeWikiSources}
            onCheckedChange={(checked) => updateSettings({ citeWikiSources: Boolean(checked) })}
            aria-label={t("Cite team wiki sources")}
          />
        }
      />
    </SettingsSection>
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
          description={`${identity.email} · ${identity.teamName ?? t("No team")}`}
          control={
            <Button
              size="xs"
              variant="destructive-outline"
              disabled={busy}
              onClick={() => void leave()}
            >
              {busy ? t("Disconnecting…") : t("Disconnect")}
            </Button>
          }
        />
      ) : (
        <SettingsRow
          title="Not connected"
          description="Connect with your work email and a one-time Enterprise invite. Nothing changes here until you do."
          control={
            <Button size="xs" onClick={() => setConnecting(true)}>
              {t("Connect Enterprise")}
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
      <AuthorizeRow environmentId={environmentId} teams={members.data?.teams ?? []} />
      <details className="px-3 py-3 sm:px-4">
        <summary className="cursor-pointer text-sm font-medium">{t("Create an invite")}</summary>
        <InviteRow />
      </details>
      <details className="px-3 py-3 sm:px-4">
        <summary className="cursor-pointer text-sm font-medium">
          {t("Manage existing members")}
        </summary>
        {members.error ? (
          <SettingsRow title="Could not load members" description={members.error} />
        ) : !members.data ? (
          <SettingsRow title={t("Loading members…")} role="status" />
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
      </details>
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
            setError(t("Enter the hub address, pairing code and Enterprise token."));
          }
        }}
      >
        <Input
          aria-label={t("Hub address")}
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
          aria-label={t("Hub pairing code")}
          value={pairingCode}
          onChange={(event) => {
            setPairingCode(event.target.value);
            setInvite("");
          }}
          placeholder={t("Fresh pairing code")}
          nativeInput
          spellCheck={false}
        />
        <Input
          aria-label={t("Enterprise token")}
          type="password"
          value={token}
          onChange={(event) => {
            setToken(event.target.value);
            setInvite("");
          }}
          placeholder={t("Enterprise token")}
          nativeInput
          spellCheck={false}
        />
        <Button size="xs" type="submit">
          {t("Create invite")}
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
            aria-label={t("Enterprise invite")}
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
            {t("Copy")}
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
        <SelectTrigger size="xs" aria-label={t("Team")}>
          <SelectValue>
            {teams.find((team) => team.id === teamId)?.name ?? t("No team")}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup alignItemWithTrigger={false}>
          <SelectItem value={NO_TEAM} hideIndicator>
            {t("No team")}
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
        <SelectTrigger size="xs" aria-label={t("Role")}>
          <SelectValue>{t(role)}</SelectValue>
        </SelectTrigger>
        <SelectPopup alignItemWithTrigger={false}>
          {TeamMemberRole.literals.map((option) => (
            <SelectItem key={option} value={option} hideIndicator>
              {t(option)}
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
  const canAuthorize = useAtomValue(enterpriseEnvironment.authorize.permissionAtom(environmentId));
  const [busy, setBusy] = useState(false);
  const run = async (
    action: () => Promise<Awaited<ReturnType<typeof authorize>>>,
    title: string,
  ) => {
    setBusy(true);
    report(await action(), title);
    setBusy(false);
  };
  const save = (next: {
    teamId: string | null;
    role: TeamMemberRole;
    areaIds?: ReadonlyArray<string>;
  }) =>
    run(
      () =>
        authorize({
          environmentId,
          input: { email: member.email, displayName: member.displayName, ...next },
        }),
      t("Could not update the member"),
    );
  return (
    <SettingsRow
      title={member.displayName}
      description={member.active ? member.email : `${member.email} · ${t("revoked")}`}
      control={
        <div className="flex flex-wrap items-center gap-2">
          <TeamRoleControls
            teams={teams}
            teamId={member.teamId}
            role={member.role}
            disabled={busy || !member.active}
            onChange={(next) => void save(next)}
          />
          <fieldset
            disabled={busy || !canAuthorize || !member.active || member.areaIds === undefined}
            className="flex flex-wrap gap-2"
          >
            <legend className="text-xs text-muted-foreground">{t("Additional areas")}</legend>
            {teams.map((team) => (
              <label key={team.id} className="flex items-center gap-1 text-xs">
                <Checkbox
                  checked={member.areaIds?.includes(team.id) ?? false}
                  onCheckedChange={(checked) =>
                    void save({
                      teamId: member.teamId,
                      role: member.role,
                      areaIds: checked
                        ? [...(member.areaIds ?? []), team.id]
                        : (member.areaIds ?? []).filter((id) => id !== team.id),
                    })
                  }
                />
                {team.name}
              </label>
            ))}
          </fieldset>
          {member.active ? (
            <Button
              size="xs"
              variant="destructive-outline"
              disabled={busy}
              onClick={() =>
                void run(
                  () => revoke({ environmentId, input: { email: member.email } }),
                  t("Could not revoke the email"),
                )
              }
            >
              {t("Revoke")}
            </Button>
          ) : (
            <Button size="xs" variant="outline" disabled={busy} onClick={() => void save(member)}>
              {t("Authorize")}
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
      t("Could not authorize the email"),
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
          aria-label={t("Email")}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder={t("email")}
          disabled={busy}
          nativeInput
          spellCheck={false}
        />
        <Button size="xs" type="submit" disabled={busy || !ready}>
          {t("Add member")}
        </Button>
      </form>
    </SettingsRow>
  );
}
