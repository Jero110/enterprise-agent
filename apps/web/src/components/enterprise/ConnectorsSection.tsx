import type {
  EnterpriseConnectorInput,
  EnterpriseConnectorResult,
  EnvironmentId,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import { enterpriseEnvironment, useEnterpriseStatus } from "~/state/enterprise";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

function ConnectorForm({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const permission = useAtomValue(enterpriseEnvironment.connector.permissionAtom(environmentId));
  const org = useEnvironmentQuery(enterpriseEnvironment.org({ environmentId, input: {} }));
  const execute = useAtomCommand(enterpriseEnvironment.connector, {
    label: "manage connectors",
    reportFailure: false,
  });
  const [provider, setProvider] = useState<"postgres" | "supabase">("postgres");
  const [area, setArea] = useState("general");
  const [connectionString, setConnectionString] = useState("");
  const [status, setStatus] = useState<EnterpriseConnectorResult | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (input: EnterpriseConnectorInput) => {
    setBusy(true);
    setMessage("");
    if (input.action === "connect") setConnectionString("");
    const result = await execute({ environmentId, input });
    setBusy(false);
    if (result._tag === "Success") {
      setStatus(result.value);
      setMessage(
        `${result.value.proposedCount} table proposals created. Review them in Context changes.`,
      );
    } else {
      // Never render command failures: nested transport errors may echo a credential-bearing payload.
      setMessage(
        "Connector request failed. Check the URL, database permissions and hub connection.",
      );
    }
  };
  return (
    <section className="space-y-3" aria-label="Database connectors">
      <h3 className="text-sm font-medium">Connectors</h3>
      <p className="text-xs text-muted-foreground">
        Postgres and Supabase import table and column schemas only, never rows. URLs stay in the hub
        secret store. Changes require approval.
      </p>
      <Button
        size="sm"
        variant="outline"
        disabled={busy || !permission}
        onClick={() => void run({ action: "list" })}
      >
        Load connection status
      </Button>
      <div className="space-y-2">
        {(["postgres", "supabase"] as const).map((id) => {
          const connection = status?.connections.find((c) => c.provider === id);
          return (
            <div key={id} className="flex flex-wrap items-center gap-2 text-sm">
              <span>
                {id === "postgres" ? "Postgres" : "Supabase"}:{" "}
                {status === null
                  ? "Status not loaded"
                  : connection
                    ? `Connected · ${connection.area}`
                    : "Not connected"}
              </span>
              {connection && (
                <>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy || !permission}
                    onClick={() => void run({ action: "introspect", provider: id })}
                  >
                    Refresh schema
                  </Button>
                  <Button
                    size="xs"
                    variant="destructive-outline"
                    disabled={busy || !permission}
                    onClick={() => void run({ action: "disconnect", provider: id })}
                  >
                    Disconnect
                  </Button>
                </>
              )}
            </div>
          );
        })}
      </div>
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          void run({ action: "connect", provider, area, connectionString });
        }}
      >
        <div className="flex flex-wrap gap-2">
          <label className="text-sm">
            Provider{" "}
            <select
              aria-label="Connector provider"
              value={provider}
              onChange={(event) =>
                setProvider(event.target.value === "supabase" ? "supabase" : "postgres")
              }
              disabled={busy || !permission}
            >
              <option value="postgres">Postgres</option>
              <option value="supabase">Supabase</option>
            </select>
          </label>
          <label className="text-sm">
            Area{" "}
            <select
              aria-label="Connector area"
              value={area}
              onChange={(event) => setArea(event.target.value)}
              disabled={busy || !permission}
            >
              <option value="general">General</option>
              {org.data?.teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Input
          nativeInput
          type="password"
          autoComplete="off"
          aria-label="Database connection URL"
          placeholder="postgresql://user:password@host/database"
          value={connectionString}
          onChange={(event) => setConnectionString(event.target.value)}
          disabled={busy || !permission}
        />
        <Button size="sm" type="submit" disabled={busy || !permission || !connectionString.trim()}>
          Connect and propose schema
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">
        Disconnect deletes the saved URL, not accepted nodes. Connecting again replaces this
        provider’s saved connection.
      </p>
      <div className="flex flex-wrap gap-2">
        {["Snowflake", "BigQuery", "MySQL", "Google Sheets", "Google Drive"].map((name) => (
          <Button key={name} size="sm" variant="outline" disabled>
            {name} · Coming soon
          </Button>
        ))}
      </div>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </section>
  );
}

export function ConnectorsSection({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const { identity } = useEnterpriseStatus();
  return identity?.role === "admin" ? (
    <ConnectorForm key={environmentId} environmentId={environmentId} />
  ) : null;
}
