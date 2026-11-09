export type IngestSourceMode = "url" | "folder" | "files";

export function ingestSourceSelection<T>(
  mode: IngestSourceMode,
  urls: string,
  files: ReadonlyArray<T>,
): { sourceUrls: string[]; selectedFiles: ReadonlyArray<T> } {
  return mode === "url"
    ? { sourceUrls: urls.split(/[\s,]+/).filter(Boolean), selectedFiles: [] }
    : { sourceUrls: [], selectedFiles: files };
}
