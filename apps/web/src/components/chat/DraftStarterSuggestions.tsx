import { type ComposerThreadTarget, useComposerDraftStore } from "~/composerDraftStore";
import { t } from "~/i18n";
import { cn } from "~/lib/utils";
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

/**
 * Starter prompts under the empty-draft composer. They fade out once the draft has text but keep
 * their space, so the home cards below never jump. Short windows leave them out entirely.
 */
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
  return (
    <div
      role="group"
      aria-label={t("Suggestions")}
      aria-hidden={promptIsEmpty ? undefined : true}
      inert={promptIsEmpty ? undefined : true}
      className={cn(
        "hidden flex-wrap justify-center gap-2 transition-[opacity,visibility] duration-200 motion-reduce:transition-none [@media(min-height:36rem)]:flex",
        !promptIsEmpty && "pointer-events-none invisible opacity-0",
      )}
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
