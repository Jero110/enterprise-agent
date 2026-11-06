import type { KnowledgeUploadInput } from "@t3tools/contracts";

export interface PickedEnterpriseFile {
  readonly name: string;
  readonly uri: string;
  readonly size: number;
  readonly mimeType?: string;
}

export async function prepareEnterpriseUpload(
  files: readonly PickedEnterpriseFile[],
  readBase64: (uri: string) => Promise<string>,
): Promise<KnowledgeUploadInput["files"]> {
  if (
    !files.length ||
    files.length > 20 ||
    files.some((file) => file.size <= 0 || file.size > 10 * 1024 * 1024) ||
    files.reduce((size, file) => size + file.size, 0) > 35 * 1024 * 1024
  ) {
    throw new Error("Select 1–20 nonempty files, up to 10 MiB each and 35 MiB total.");
  }
  return Promise.all(
    files.map(async (file) => ({
      name: file.name,
      mimeType: file.mimeType || "application/octet-stream",
      base64: await readBase64(file.uri),
    })),
  );
}
