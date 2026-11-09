import { type ComposerThreadTarget, useComposerDraftStore } from "~/composerDraftStore";
import { t } from "~/i18n";
import { Button } from "../ui/button";

// `prompt` is what lands in the composer; a trailing space leaves room to finish the sentence.
const STARTER_SUGGESTIONS = [
  {
    label: "What was the discount on our last promo?",
    prompt: "What was the discount on our last promo?",
  },
  {
    label: "Summarize today's meeting and tell me what's mine",
    prompt: "Summarize today's meeting and tell me what's mine",
  },
  { label: "Request access to the Sales area", prompt: "Request access to the Sales area" },
  {
    label: "What does my team's wiki know about…?",
    prompt: "What does my team's wiki know about ",
  },
] as const;

/** Starter prompts under the empty-draft composer; hidden as soon as the draft has text. */
export function DraftStarterSuggestions({
  draftTarget,
  onPick,
}: {
  draftTarget: ComposerThreadTarget;
  onPick: (prompt: string) => void;
}) {
  // A boolean, so typing does not re-render the chips.
  const promptIsEmpty = useComposerDraftStore(
    (store) => (store.getComposerDraft(draftTarget)?.prompt.trim().length ?? 0) === 0,
  );
  if (!promptIsEmpty) return null;
  return (
    <div
      role="group"
      aria-label={t("Suggestions")}
      className="flex flex-wrap justify-center gap-2"
      data-draft-starter-suggestions
    >
      {STARTER_SUGGESTIONS.map((suggestion) => (
        <Button
          key={suggestion.label}
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onPick(t(suggestion.prompt))}
        >
          {t(suggestion.label)}
        </Button>
      ))}
    </div>
  );
}
