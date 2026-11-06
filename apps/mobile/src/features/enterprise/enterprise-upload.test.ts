import { describe, expect, it, vi } from "vite-plus/test";
import { prepareEnterpriseUpload, type PickedEnterpriseFile } from "./enterprise-upload";

describe("prepareEnterpriseUpload", () => {
  it("reads selected device bytes and sends only their encoded contents, never local URIs", async () => {
    const files: PickedEnterpriseFile[] = [
      {
        name: "report.pdf",
        uri: "file:///private/report.pdf",
        size: 3,
        mimeType: "application/pdf",
      },
    ];
    const read = vi.fn(async () => "YWJj");
    const result = await prepareEnterpriseUpload(files, read);
    expect(read).toHaveBeenCalledWith(files[0]!.uri);
    expect(result).toEqual([{ name: "report.pdf", mimeType: "application/pdf", base64: "YWJj" }]);
    expect(JSON.stringify(result)).not.toContain("file://");
  });

  it("does not produce a partial staged payload when a device read fails", async () => {
    await expect(
      prepareEnterpriseUpload(
        [{ name: "missing.pdf", uri: "file:///private/missing", size: 3 }],
        async () => {
          throw new Error("Device file unavailable");
        },
      ),
    ).rejects.toThrow("Device file unavailable");
  });

  it("rejects oversized batches before reading device files", async () => {
    const read = vi.fn(async () => "YWJj");
    await expect(
      prepareEnterpriseUpload(
        [{ name: "too-large.pdf", uri: "file:///private/large", size: 10 * 1024 * 1024 + 1 }],
        read,
      ),
    ).rejects.toThrow("10 MiB");
    expect(read).not.toHaveBeenCalled();
  });
});
