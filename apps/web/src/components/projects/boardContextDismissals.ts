import { create } from "zustand";

/**
 * Board tasks the user took off the composer's "attached" row, per draft, until the message goes
 * out. The composer shows the row; the send path reads the same list so both agree.
 */
interface BoardContextDismissalState {
  readonly byDraft: Readonly<Record<string, ReadonlyArray<string>>>;
}

const NONE: ReadonlyArray<string> = [];

const useBoardContextDismissalStore = create<BoardContextDismissalState>()(() => ({
  byDraft: {},
}));

export function useBoardContextDismissals(draftKey: string): ReadonlyArray<string> {
  return useBoardContextDismissalStore((state) => state.byDraft[draftKey] ?? NONE);
}

export function readBoardContextDismissals(draftKey: string): ReadonlySet<string> {
  return new Set(useBoardContextDismissalStore.getState().byDraft[draftKey] ?? NONE);
}

export function dismissBoardContext(draftKey: string, contextId: string): void {
  useBoardContextDismissalStore.setState((state) => {
    const current = state.byDraft[draftKey] ?? NONE;
    if (current.includes(contextId)) return state;
    return { byDraft: { ...state.byDraft, [draftKey]: [...current, contextId] } };
  });
}

/** A sent message starts the next one with every match attachable again. */
export function clearBoardContextDismissals(draftKey: string): void {
  useBoardContextDismissalStore.setState((state) => {
    if (state.byDraft[draftKey] === undefined) return state;
    const { [draftKey]: _cleared, ...rest } = state.byDraft;
    return { byDraft: rest };
  });
}
