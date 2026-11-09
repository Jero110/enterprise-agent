import type { ReactNode } from "react";

import { t } from "~/i18n";

/** The empty-draft greeting, with the project picker as a quieter line below it. */
export function DraftHeroProjectHeading({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-full flex-col items-center gap-1.5">
      <h1 className="w-full text-center font-normal text-2xl text-foreground tracking-tight sm:text-3xl">
        {t("What can I help you with today?")}
      </h1>
      <p className="flex min-w-0 max-w-full items-baseline justify-center gap-1.5 text-muted-foreground text-sm">
        <span className="shrink-0">{t("Project:")}</span>
        <span className="min-w-0">{children}</span>
      </p>
    </div>
  );
}
