import type { LinkedPrompt } from "@t3tools/shared/promptLinks";
import { t } from "~/i18n";
import { APP_BASE_NAME } from "~/branding";

import { type ComposerThreadTarget, useComposerDraftStore } from "~/composerDraftStore";

import { toastManager } from "../ui/toast";

export function describeRemovedHiddenCharacters(count: number): string {
  return count === 1
    ? t("{app} removed 1 hidden character. Read the prompt before you send it.", {
        app: APP_BASE_NAME,
      })
    : t("{app} removed {count} hidden characters. Read the prompt before you send it.", {
        app: APP_BASE_NAME,
        count,
      });
}

export function warnAboutHiddenCharacters(prompt: LinkedPrompt): void {
  if (prompt.hiddenCharacters === 0) return;
  toastManager.add({
    type: "warning",
    title: t("This prompt had hidden characters, it may be malicious"),
    description: describeRemovedHiddenCharacters(prompt.hiddenCharacters),
    timeout: 0,
  });
}

export function placeLinkedPrompt(
  target: ComposerThreadTarget,
  prompt: LinkedPrompt,
  notes: ReadonlyArray<string> = [],
): void {
  warnAboutHiddenCharacters(prompt);
  const place = () => {
    useComposerDraftStore.getState().setPrompt(target, prompt.text);
    toastManager.add({
      type: "info",
      title: "Prompt added from a link",
      description: ["Read it before you send.", ...notes].join(" "),
    });
  };
  const existing = useComposerDraftStore.getState().getComposerDraft(target)?.prompt ?? "";
  if (existing.trim().length === 0 || existing === prompt.text) {
    place();
    return;
  }
  const id = toastManager.add({
    type: "info",
    title: "Linked prompt ready",
    description: "This thread already has a draft. Replace it with the linked prompt?",
    timeout: 0,
    actionProps: {
      children: "Replace draft",
      onClick: () => {
        toastManager.close(id);
        place();
      },
    },
  });
}
