import { ES_CHAT } from "./chat";
import { ES_SETTINGS } from "./settings";
import { ES_SHELL } from "./shell";
import { ES_TEAM } from "./team";

export const ES_DICTIONARY: Readonly<Record<string, string>> = {
  ...ES_SHELL,
  ...ES_CHAT,
  ...ES_SETTINGS,
  ...ES_TEAM,
};
