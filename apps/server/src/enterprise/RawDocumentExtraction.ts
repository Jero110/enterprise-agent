// @effect-diagnostics nodeBuiltinImport:off -- bounded extraction is an explicit local-file boundary.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import { extractDocumentText } from "../provider/documentTextWorker.ts";

export const MAX_RAW_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_RAW_DOCUMENT_TEXT_CHARS = 250_000;

const TRUNCATED = "\n\n[Extracted text truncated at enterprise document limits.]";

type Format = "docx" | "xlsx" | "sqlite-schema";
type RejectionCode = "input_too_large" | "invalid_format" | "extraction_failed";

export type RawDocumentExtractionResult =
  | {
      readonly status: "extracted";
      readonly format: Format;
      readonly text: string;
      readonly truncated: boolean;
    }
  | {
      readonly status: "unsupported";
      readonly format: "pdf" | "unknown";
      readonly reason: string;
    }
  | {
      readonly status: "rejected";
      readonly code: RejectionCode;
      readonly reason: string;
    };

const extensionFormat = (path: string): Format | "pdf" | "unknown" => {
  switch (NodePath.extname(path).toLowerCase()) {
    case ".docx":
      return "docx";
    case ".xlsx":
      return "xlsx";
    case ".sqlite":
    case ".sqlite3":
    case ".db":
      return "sqlite-schema";
    case ".pdf":
      return "pdf";
    default:
      return "unknown";
  }
};

const boundedText = (text: string) => {
  const alreadyTruncated =
    text.includes("[Extracted text truncated at document extraction limits.]") ||
    text.includes("[Extracted text truncated at enterprise document limits.]");
  if (text.length <= MAX_RAW_DOCUMENT_TEXT_CHARS) return { text, truncated: alreadyTruncated };
  return {
    text: text.slice(0, MAX_RAW_DOCUMENT_TEXT_CHARS - TRUNCATED.length).trimEnd() + TRUNCATED,
    truncated: true,
  };
};

const startsWith = (bytes: Uint8Array, signature: readonly number[]) =>
  signature.every((byte, index) => bytes[index] === byte);

async function header(path: string) {
  const handle = await NodeFSP.open(path, "r");
  try {
    const bytes = new Uint8Array(16);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    return bytes.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function sqliteSchema(path: string) {
  const database = new NodeSqlite.DatabaseSync(path, { readOnly: true });
  try {
    database.exec("PRAGMA query_only = ON; PRAGMA trusted_schema = OFF");
    const rows = database
      .prepare(
        `SELECT type, name, tbl_name AS tableName, sql
         FROM sqlite_schema
         WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
         ORDER BY type, name
         LIMIT 1001`,
      )
      .all() as Array<{
      readonly type: string;
      readonly name: string;
      readonly tableName: string;
      readonly sql: string;
    }>;
    const limited = rows.slice(0, 1000);
    const text = limited
      .map(({ type, name, tableName, sql }) =>
        [`-- ${type}: ${name} (table: ${tableName})`, sql.trim().replace(/;?$/u, ";")].join("\n"),
      )
      .join("\n\n");
    return boundedText(text + (rows.length > limited.length ? TRUNCATED : ""));
  } finally {
    database.close();
  }
}

export async function extractRawDocument(path: string): Promise<RawDocumentExtractionResult> {
  const format = extensionFormat(path);
  if (format === "unknown")
    return {
      status: "unsupported",
      format,
      reason: "Only DOCX, XLSX, SQLite schema, and explicitly reported PDF inputs are recognized.",
    };

  try {
    const info = await NodeFSP.stat(path);
    if (!info.isFile())
      return { status: "rejected", code: "invalid_format", reason: "Input is not a file." };
    if (info.size > MAX_RAW_DOCUMENT_BYTES)
      return {
        status: "rejected",
        code: "input_too_large",
        reason: "Document exceeds the 10 MB extraction limit.",
      };

    const signature = await header(path);
    if (format === "pdf")
      return startsWith(signature, [...Buffer.from("%PDF-")])
        ? {
            status: "unsupported",
            format,
            reason:
              "PDF text extraction needs a bounded server-side parser, which is not installed.",
          }
        : {
            status: "rejected",
            code: "invalid_format",
            reason: "File extension and PDF signature do not match.",
          };
    if (format === "sqlite-schema") {
      if (!startsWith(signature, [...Buffer.from("SQLite format 3\0")]))
        return {
          status: "rejected",
          code: "invalid_format",
          reason: "File extension and SQLite signature do not match.",
        };
      const result = sqliteSchema(path);
      return { status: "extracted", format, ...result };
    }

    if (!startsWith(signature, [0x50, 0x4b, 0x03, 0x04]))
      return {
        status: "rejected",
        code: "invalid_format",
        reason: "File extension and Open XML signature do not match.",
      };
    const result = boundedText(await extractDocumentText(path, `.${format}`));
    return { status: "extracted", format, ...result };
  } catch {
    return {
      status: "rejected",
      code: "extraction_failed",
      reason: "Document could not be safely extracted within format limits.",
    };
  }
}
