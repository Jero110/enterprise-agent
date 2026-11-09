interface ThreadLineage {
  readonly threadId: string;
  readonly parentThreadId: string | null;
}

/**
 * Orders one owner's shared chats so each subagent chat follows its parent, one level deeper.
 * A subagent whose parent is not in the list shows at the top level, so nothing is lost.
 */
export function nestSubagentThreads<T extends ThreadLineage>(
  threads: ReadonlyArray<T>,
): ReadonlyArray<{ readonly summary: T; readonly depth: number }> {
  const ids = new Set(threads.map((thread) => thread.threadId));
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const thread of threads) {
    const parent = thread.parentThreadId;
    if (parent === null || parent === thread.threadId || !ids.has(parent)) {
      roots.push(thread);
      continue;
    }
    const siblings = children.get(parent);
    if (siblings) siblings.push(thread);
    else children.set(parent, [thread]);
  }
  const ordered: Array<{ readonly summary: T; readonly depth: number }> = [];
  const seen = new Set<string>();
  const visit = (thread: T, depth: number) => {
    if (seen.has(thread.threadId)) return;
    seen.add(thread.threadId);
    ordered.push({ summary: thread, depth });
    for (const child of children.get(thread.threadId) ?? []) visit(child, depth + 1);
  };
  for (const root of roots) visit(root, 0);
  // Chats caught in a parent loop have no root; list them flat instead of dropping them.
  for (const thread of threads) visit(thread, 0);
  return ordered;
}
