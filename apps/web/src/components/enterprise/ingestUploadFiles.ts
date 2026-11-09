const MAX_UPLOAD_FILES = 80;
const MAX_UPLOAD_FILE_BYTES = 10 * 1024 * 1024;
const MAX_UPLOAD_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_BATCH_FILES = 20;
const MAX_BATCH_BYTES = 35 * 1024 * 1024;

export type IngestUploadFile = Pick<File, "name" | "size" | "type"> & {
  readonly webkitRelativePath?: string;
};

export function uploadPath(file: IngestUploadFile): string {
  return file.webkitRelativePath || file.name;
}

export function uploadFileError(files: ReadonlyArray<IngestUploadFile>): string | null {
  if (files.length > MAX_UPLOAD_FILES) return "Choose at most 80 files per run.";
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_UPLOAD_TOTAL_BYTES)
    return "Choose at most 100 MiB per run.";
  for (const file of files) {
    const relativePath = uploadPath(file);
    if (file.size === 0 || file.size > MAX_UPLOAD_FILE_BYTES)
      return "Choose nonempty files of at most 10 MiB each.";
    if (
      relativePath.length > 1024 ||
      relativePath.startsWith("/") ||
      relativePath.includes("\\") ||
      /[\r\n\0]/.test(relativePath) ||
      relativePath.split("/").some((part) => !part || part === "." || part === "..") ||
      relativePath.split("/").at(-1) !== file.name
    )
      return "Choose files with safe relative paths.";
  }
  if (new Set(files.map(uploadPath)).size !== files.length)
    return "Choose files with distinct relative paths.";
  return null;
}

export function uploadBatches<T extends IngestUploadFile>(files: ReadonlyArray<T>): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const file of files) {
    if (current.length === MAX_BATCH_FILES || bytes + file.size > MAX_BATCH_BYTES) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(file);
    bytes += file.size;
  }
  if (current.length) batches.push(current);
  return batches;
}
