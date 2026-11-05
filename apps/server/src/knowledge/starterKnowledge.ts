/** The hub's starter knowledge, shaped on Bank of Anthos (GoogleCloudPlatform/bank-of-anthos). */

export const GLOBAL_OVERVIEW = `# Acme Bank overview

Acme Bank runs a retail banking app on Kubernetes, modelled on Bank of Anthos: customers sign in, see their balance and transaction history, and send payments.

## Services

- **frontend**: the web UI and its session handling.
- **userservice** and **contacts**: accounts, sign-in and saved payees.
- **ledgerwriter**, **balancereader** and **transactionhistory**: the transaction ledger.
- **loadgenerator** and the databases: platform tooling.

## Teams

Ledger, Frontend, Accounts, Platform and Risk each own one area under \`areas/\`. Start from the area README for what a team owns and where its sources live.
`;

const AREA_READMES: Readonly<Record<string, string>> = {
  ledger: `# Ledger

Ledger owns the transaction ledger.

## Owns

- **ledgerwriter**: validates and appends transactions to the ledger database.
- **balancereader**: serves account balances from the ledger.
- **transactionhistory**: serves a customer's recent transactions.

## Sources

\`src/ledgerwriter\`, \`src/balancereader\`, \`src/transactionhistory\`
`,
  frontend: `# Frontend

Frontend owns the web UI customers use to sign in, view balances and send payments.

## Owns

- **frontend**: the Flask web app, its templates and session cookies.

## Sources

\`src/frontend\`
`,
  accounts: `# Accounts

Accounts owns customer identity and payees.

## Owns

- **userservice**: sign-up, sign-in and JWT issuing.
- **contacts**: each customer's saved payees.

## Sources

\`src/accounts/userservice\`, \`src/accounts/contacts\`
`,
  platform: `# Platform

Platform owns how the services build, deploy and get tested.

## Owns

- Kubernetes manifests and Skaffold config.
- **loadgenerator**: synthetic traffic for the demo.

## Sources

\`kubernetes-manifests\`, \`skaffold.yaml\`, \`src/loadgenerator\`
`,
  risk: `# Risk

Risk reviews payments and ledger activity for fraud and policy.

## Owns

- Review rules over transaction history.
- Policy notes that other areas must follow.

## Sources

None yet; Risk reads \`areas/ledger\` through an approved grant.
`,
};

export const areaReadme = (teamId: string, teamName: string): string =>
  AREA_READMES[teamId] ?? `# ${teamName}\n\nThis area has no knowledge yet.\n`;
