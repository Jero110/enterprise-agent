import * as Schema from "effect/Schema";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import type { SettingsPath } from "./settingsSearch";

const SETTINGS_ADVANCED_STORAGE_KEY = "norai.settings.advanced";

// Everyday users start with the short menu. Tests keep every section so nav assertions hold.
const DEFAULT_SHOW_ADVANCED = import.meta.env.MODE === "test";

/** Developer-only sections hidden from the settings menu unless advanced settings are on. */
const ADVANCED_SETTINGS_PATHS: ReadonlySet<SettingsPath> = new Set<SettingsPath>([
  "/settings/keybindings",
  "/settings/snap-shot",
  "/settings/diffs",
  "/settings/browser",
  "/settings/devices",
  "/settings/scheduled-tasks",
  "/settings/source-control",
  "/settings/worktrees",
  "/settings/connections",
  "/settings/access",
  "/settings/secrets",
  "/settings/maintenance",
  "/settings/labs",
  "/settings/archived",
]);

/** Per-device choice; hidden sections stay reachable by URL and search. */
export function useShowAdvancedSettings() {
  return useLocalStorage(SETTINGS_ADVANCED_STORAGE_KEY, DEFAULT_SHOW_ADVANCED, Schema.Boolean);
}

interface SettingsNavGroup {
  readonly heading: string | null;
  readonly paths: ReadonlyArray<SettingsPath>;
}

export function visibleSettingsNavGroups(
  groups: ReadonlyArray<SettingsNavGroup>,
  showAdvanced: boolean,
  activePath: string,
): ReadonlyArray<SettingsNavGroup> {
  if (showAdvanced) return groups;
  return groups
    .map((group) => ({
      heading: group.heading,
      // The open section keeps its entry so the user still sees where they are.
      paths: group.paths.filter(
        (to) =>
          !ADVANCED_SETTINGS_PATHS.has(to) || activePath === to || activePath.startsWith(`${to}/`),
      ),
    }))
    .filter((group) => group.paths.length > 0);
}
