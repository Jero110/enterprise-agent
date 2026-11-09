import { ES_BRAND } from "./brand";
import { ES_CHAT } from "./chat";
import { ES_DICTATION } from "./dictation";
import { ES_HOME } from "./home";
import { ES_HUB_HEADER } from "./hubHeader";
import { ES_HUB_KNOWLEDGE } from "./hubKnowledge";
import { ES_HUB_TEAM } from "./hubTeam";
import { ES_SETTINGS } from "./settings";
import { ES_SETTINGS_ADVANCED } from "./settingsAdvanced";
import { ES_SHELL } from "./shell";
import { ES_TEAM } from "./team";
import { ES_WIKI_SOURCES } from "./wikiSources";

export const ES_DICTIONARY: Readonly<Record<string, string>> = {
  ...ES_SHELL,
  ...ES_CHAT,
  ...ES_SETTINGS,
  ...ES_SETTINGS_ADVANCED,
  ...ES_BRAND,
  ...ES_TEAM,
  ...ES_HOME,
  ...ES_WIKI_SOURCES,
  ...ES_DICTATION,
  ...ES_HUB_KNOWLEDGE,
  ...ES_HUB_HEADER,
  ...ES_HUB_TEAM,
};
