import type { EnterpriseOrgMember, EnterpriseOrgTeam, EnvironmentId } from "@t3tools/contracts";
import { enterpriseEnvironment } from "~/state/enterprise";
import { useEnvironmentQuery } from "~/state/query";
import { t } from "~/i18n";
import { Badge } from "../ui/badge";

function MemberTree({
  members,
  parent,
  visited = [],
}: {
  members: ReadonlyArray<EnterpriseOrgMember>;
  parent?: string;
  visited?: ReadonlyArray<string>;
}) {
  const children = members.filter((member) =>
    parent
      ? member.reportsTo === parent
      : !member.reportsTo || !members.some((candidate) => candidate.memberKey === member.reportsTo),
  );
  return (
    <ul className="space-y-2 border-l pl-3">
      {children.map((member) => {
        const key = member.memberKey ?? member.displayName;
        if (visited.includes(key)) return null;
        return (
          <li key={key} className="space-y-2 text-xs">
            <div>
              {member.displayName}
              {member.isMe ? ` ${t("(you)")}` : ""} · {t(member.role, undefined, "role")}
            </div>
            {member.memberKey && (
              <MemberTree members={members} parent={member.memberKey} visited={[...visited, key]} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Area({
  team,
  teams,
}: {
  team: EnterpriseOrgTeam;
  teams: ReadonlyArray<EnterpriseOrgTeam>;
}) {
  const externalManagers = [
    ...new Set(
      team.members.flatMap((member) =>
        member.reportsTo &&
        !team.members.some((candidate) => candidate.memberKey === member.reportsTo)
          ? [member.reportsTo]
          : [],
      ),
    ),
  ];
  return (
    <section className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{team.name}</h3>
        {team.access !== "none" && (
          <Badge>{team.access === "member" ? t("Your area") : t("Access granted")}</Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{team.description}</p>
      <p className="text-xs">
        {t("Lead")}: {team.lead?.displayName ?? t("Not assigned")}
      </p>
      {externalManagers.map((key) => (
        <p key={key} className="text-xs text-muted-foreground">
          {t("Reports to")}:{" "}
          {teams.flatMap((area) => area.members).find((member) => member.memberKey === key)
            ?.displayName ?? key}
        </p>
      ))}
      <MemberTree members={team.members} />
    </section>
  );
}

export function OrganizationView({ environmentId }: { environmentId: EnvironmentId }) {
  const org = useEnvironmentQuery(enterpriseEnvironment.org({ environmentId, input: {} }));
  const teams = org.data?.teams ?? [];
  return (
    <div className="max-h-[70dvh] w-full space-y-3 overflow-y-auto bg-popover p-3">
      <h2 className="text-sm font-medium">{t("Organization")}</h2>
      <p className="text-xs text-muted-foreground">
        {t("Your areas")}:{" "}
        {teams
          .filter((team) => team.access === "member")
          .map((team) => team.name)
          .join(", ") || t("None")}
      </p>
      {org.error ? (
        <p role="alert">{org.error}</p>
      ) : !org.data ? (
        <p>{t("Loading organization…")}</p>
      ) : teams.length === 0 ? (
        <p>{t("No teams yet.")}</p>
      ) : (
        teams.map((team) => <Area key={team.id} team={team} teams={teams} />)
      )}
    </div>
  );
}
