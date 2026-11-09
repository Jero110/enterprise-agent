import { expect, it } from "vite-plus/test";
import { ingestSourceSelection } from "./ingestSourceSelection";

it("sends only the active source when switching between a repository URL and folder", () => {
  const files = [{ name: "raw/_manifest.csv" }, { name: "raw/org/directorio.csv" }];
  expect(ingestSourceSelection("folder", "https://github.com/example/private", files)).toEqual({
    sourceUrls: [],
    selectedFiles: files,
  });
  expect(ingestSourceSelection("url", "https://github.com/example/repo", files)).toEqual({
    sourceUrls: ["https://github.com/example/repo"],
    selectedFiles: [],
  });
});
