// @effect-diagnostics nodeBuiltinImport:off -- synthetic binary fixtures use Node file APIs.
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeZlib from "node:zlib";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { MAX_RAW_DOCUMENT_BYTES, extractRawDocument } from "./RawDocumentExtraction.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => NodeFSP.rm(directory, { recursive: true, force: true })),
  );
});

async function temporaryFile(name: string, contents: Uint8Array | string) {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-raw-document-"));
  temporaryDirectories.push(directory);
  const path = NodePath.join(directory, name);
  await NodeFSP.writeFile(path, contents);
  return path;
}

function zip(parts: Record<string, string>) {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, contents] of Object.entries(parts)) {
    const data = Buffer.from(contents);
    const compressed = NodeZlib.deflateRawSync(data);
    const filename = Buffer.from(name);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(NodeZlib.crc32(data), 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(filename.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(8, 10);
    directory.writeUInt32LE(NodeZlib.crc32(data), 16);
    directory.writeUInt32LE(compressed.length, 20);
    directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(filename.length, 28);
    directory.writeUInt32LE(offset, 42);
    local.push(header, filename, compressed);
    central.push(directory, filename);
    offset += header.length + filename.length + compressed.length;
  }
  const directoryBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(directoryBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directoryBytes, end]);
}

describe("raw enterprise document extraction", () => {
  it("extracts bounded DOCX and XLSX text with an explicit format", async () => {
    const docx = await temporaryFile(
      "brief.docx",
      zip({
        "word/document.xml":
          '<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>Garantía ficticia</w:t></w:r></w:p></w:body></w:document>',
      }),
    );
    const xlsx = await temporaryFile(
      "pricing.xlsx",
      zip({
        "xl/workbook.xml":
          '<workbook xmlns:r="urn:r"><sheets><sheet name="Campañas" r:id="r1"/></sheets></workbook>',
        "xl/_rels/workbook.xml.rels":
          '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>',
        "xl/worksheets/sheet1.xml":
          '<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>Descuento demo</t></is></c><c r="B1"><v>15</v></c></row></sheetData></worksheet>',
      }),
    );

    await expect(extractRawDocument(docx)).resolves.toMatchObject({
      status: "extracted",
      format: "docx",
      text: "Garantía ficticia",
      truncated: false,
    });
    await expect(extractRawDocument(xlsx)).resolves.toMatchObject({
      status: "extracted",
      format: "xlsx",
      truncated: false,
    });
    const workbook = await extractRawDocument(xlsx);
    expect(workbook.status === "extracted" && workbook.text).toContain("Descuento demo\t15");
  });

  it("reads only SQLite schema and never table rows", async () => {
    const path = await temporaryFile("warehouse.sqlite", new Uint8Array());
    const database = new NodeSqlite.DatabaseSync(path);
    database.exec(
      "CREATE TABLE customers (email TEXT); INSERT INTO customers VALUES ('private@example.test')",
    );
    database.close();

    const result = await extractRawDocument(path);

    expect(result).toMatchObject({ status: "extracted", format: "sqlite-schema" });
    expect(result.status === "extracted" && result.text).toContain("CREATE TABLE customers");
    expect(result.status === "extracted" && result.text).not.toContain("private@example.test");
  });

  it("reports PDF as unsupported instead of pretending it extracted text", async () => {
    const path = await temporaryFile("manual.pdf", "%PDF-1.4\n%%EOF\n");

    await expect(extractRawDocument(path)).resolves.toEqual({
      status: "unsupported",
      format: "pdf",
      reason: "PDF text extraction needs a bounded server-side parser, which is not installed.",
    });
  });

  it("rejects oversized or mismatched inputs before parsing", async () => {
    const oversized = await temporaryFile("large.docx", new Uint8Array());
    NodeFS.truncateSync(oversized, MAX_RAW_DOCUMENT_BYTES + 1);
    const mismatched = await temporaryFile("fake.xlsx", "not a zip");

    await expect(extractRawDocument(oversized)).resolves.toMatchObject({
      status: "rejected",
      code: "input_too_large",
    });
    await expect(extractRawDocument(mismatched)).resolves.toMatchObject({
      status: "rejected",
      code: "invalid_format",
    });
  });
});
