export async function approveBatch(
  ids: readonly string[],
  approve: (id: string) => Promise<boolean>,
): Promise<{ approved: string[]; failed: string | null }> {
  const approved: string[] = [];
  for (const id of ids) {
    if (!(await approve(id))) return { approved, failed: id };
    approved.push(id);
  }
  return { approved, failed: null };
}
