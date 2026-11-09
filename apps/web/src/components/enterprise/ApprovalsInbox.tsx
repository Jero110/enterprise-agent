import { useEnterpriseStatus, enterpriseEnvironment } from "~/state/enterprise";
import { t } from "~/i18n";
import { useEnvironmentQuery } from "~/state/query";

export function ApprovalCount() {
  const { environmentId, identity } = useEnterpriseStatus();
  const inbox = useEnvironmentQuery(
    identity && environmentId !== null
      ? enterpriseEnvironment.proposalInbox({ environmentId, input: { countOnly: true } })
      : null,
  );
  const count = inbox.error ? 0 : (inbox.data?.pendingCount ?? 0);
  return count > 0 ? (
    <span aria-label={t("{count} pending approvals", { count })}>({count})</span>
  ) : null;
}
