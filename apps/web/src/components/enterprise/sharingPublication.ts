export function personalPublicationPath(memberKey: string, title: string) {
  if (!/^[a-f0-9]{64}$/.test(memberKey)) return null;
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug ? `personal/${memberKey}/${slug}.md` : null;
}
