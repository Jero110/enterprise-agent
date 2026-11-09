import { describe, expect, it } from "vite-plus/test";

import { visibleSettingsNavGroups } from "./settingsAdvancedMode";
import { SETTINGS_NAV_GROUPS } from "./settingsSearch";

describe("visibleSettingsNavGroups", () => {
  it("keeps every section when advanced settings are on", () => {
    expect(visibleSettingsNavGroups(SETTINGS_NAV_GROUPS, true, "/settings/general")).toBe(
      SETTINGS_NAV_GROUPS,
    );
  });

  it("hides developer sections and empty groups in simple mode", () => {
    const paths = visibleSettingsNavGroups(SETTINGS_NAV_GROUPS, false, "/settings/general").flatMap(
      (group) => group.paths,
    );
    expect(paths).toEqual([
      "/settings/general",
      "/settings/appearance",
      "/settings/chat",
      "/settings/providers",
      "/settings/threads",
      "/settings/projects",
      "/settings/enterprise",
      "/settings/about",
    ]);
  });

  it("keeps the open section visible even when it is advanced", () => {
    const paths = visibleSettingsNavGroups(
      SETTINGS_NAV_GROUPS,
      false,
      "/settings/keybindings",
    ).flatMap((group) => group.paths);
    expect(paths).toContain("/settings/keybindings");
  });
});
