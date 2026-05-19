/**
 * Document parsers — extract plain text from PDF / DOCX / Markdown / TXT.
 *
 * Each parser returns:
 *   { text, mime, pages? }
 *
 * The docs agent + the upload endpoint share this layer so the byte→text
 * boundary is one place to harden (file-type detection, size caps, OCR
 * fallback later, etc.).
 */
import mammoth from "mammoth";

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB hard cap

export type ParseResult = {
  text: string;
  mime: string;
  pages?: number;
};

export async function parseDocument(
  bytes: Buffer,
  filename: string,
): Promise<ParseResult> {
  if (bytes.length > MAX_BYTES) {
    throw new Error(`File too large: ${bytes.length} bytes (max ${MAX_BYTES})`);
  }
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "pdf":
      return parsePdf(bytes);
    case "docx":
      return parseDocx(bytes);
    case "md":
    case "markdown":
      return { text: bytes.toString("utf8"), mime: "text/markdown" };
    case "txt":
    case "text":
    case "log":
    case "csv":
      return { text: bytes.toString("utf8"), mime: "text/plain" };
    default:
      // Best-effort: try as text. We treat anything UTF-8-decodable as plain.
      return { text: bytes.toString("utf8"), mime: `application/octet-stream` };
  }
}

async function parsePdf(bytes: Buffer): Promise<ParseResult> {
  // pdf-parse is CJS and pulls in test fixtures at top-level. Use a dynamic
  // import scoped to the function so Next.js doesn't eagerly bundle it.
  const mod = (await import("pdf-parse")) as unknown as {
    default: (buf: Buffer) => Promise<{ text: string; numpages: number }>;
  };
  const result = await mod.default(bytes);
  return {
    text: cleanText(result.text),
    mime: "application/pdf",
    pages: result.numpages,
  };
}

async function parseDocx(bytes: Buffer): Promise<ParseResult> {
  const r = await mammoth.extractRawText({ buffer: bytes });
  return {
    text: cleanText(r.value),
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
}

function cleanText(s: string): string {
  return s
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, "  ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Chunk plain text into ~1500-char windows with ~200-char overlap, splitting
 * on paragraph boundaries where possible. Used by the docs agent for
 * retrieval rows.
 */
export function chunkText(text: string, target = 1500, overlap = 200): string[] {
  if (!text) return [];
  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let buf = "";
  for (const p of paragraphs) {
    if (!buf) {
      buf = p;
      continue;
    }
    if (buf.length + p.length + 2 <= target) {
      buf += "\n\n" + p;
    } else {
      chunks.push(buf);
      // Overlap by carrying the tail of the previous chunk.
      const tail = buf.slice(Math.max(0, buf.length - overlap));
      buf = tail + "\n\n" + p;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}
