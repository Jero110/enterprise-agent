import { describe, expect, it } from "vite-plus/test";
import {
  droppedUploadFiles,
  uploadBatches,
  uploadFileError,
  uploadPath,
} from "./ingestUploadFiles";

describe("manual knowledge folder uploads", () => {
  it("rejects a dropped directory before FileReader can read its pseudo-file", () => {
    const folder = { name: "raw", type: "", size: 0 };
    const file = { name: "notes.md", type: "text/markdown", size: 10 };
    expect(
      droppedUploadFiles({
        items: [{ kind: "file", webkitGetAsEntry: () => ({ isDirectory: true }) }],
        files: [folder],
      }),
    ).toBeNull();
    expect(droppedUploadFiles({ items: [], files: [folder] })).toBeNull();
    expect(droppedUploadFiles({ items: [], files: [file] })).toEqual([file]);
  });
  it("keeps 55 distinct relative raw paths including _manifest.csv across bounded upload batches", () => {
    const files = Array.from({ length: 54 }, (_, index) => ({
      name: `source-${index}.md`,
      webkitRelativePath: `raw/source-${index}.md`,
      size: 100,
      type: "text/markdown",
    }));
    files.push({
      name: "_manifest.csv",
      webkitRelativePath: "raw/_manifest.csv",
      size: 300,
      type: "text/csv",
    });
    expect(uploadFileError(files)).toBeNull();
    expect(uploadBatches(files).map((batch) => batch.length)).toEqual([20, 20, 15]);
    expect(uploadBatches(files).flat().map(uploadPath)).toEqual(files.map(uploadPath));
    expect(uploadPath(files[54]!)).toBe("raw/_manifest.csv");
    expect(
      uploadFileError([
        ...files,
        { ...files[0]!, name: "other.md", webkitRelativePath: "../other.md" },
      ]),
    ).toBe("Choose files with safe relative paths.");
    expect(uploadFileError([...files, files[0]!])).toBe(
      "Choose files with distinct relative paths.",
    );
    expect(uploadFileError(Array.from({ length: 81 }, () => files[0]!))).toBe(
      "Choose at most 80 files per run.",
    );
    expect(
      uploadBatches(files.map((file) => ({ ...file, size: 2 * 1024 * 1024 }))).map(
        (batch) => batch.length,
      ),
    ).toEqual([17, 17, 17, 4]);
  });
});
