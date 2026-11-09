import type { EnterpriseOrgTeam } from "@t3tools/contracts";

export const areaDestinations = (teams: ReadonlyArray<EnterpriseOrgTeam>) =>
  teams.filter((team) => team.access !== "none").map(({ id, name }) => ({ id, name }));

export const ingestStartError = (message: string, urls: ReadonlyArray<string>) =>
  urls.some((url) => /^https:\/\/github\.com\/[^/]+\/[^/?#]+\/?$/i.test(url)) &&
  /schema validation failed|plain.text|markdown|public source/i.test(message)
    ? "This hub could not read that GitHub repository URL. No repository files were imported. Try public raw text file URLs or upload files, then retry."
    : message;
