/**
 * Upload validation: extension allow-list + content sniffing (magic bytes) so a
 * renamed executable or HTML file cannot be stored as e.g. ".pdf".
 */
export const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
  log: "text/plain",
};

const startsWith = (buf: Buffer, bytes: number[]) => bytes.every((b, i) => buf[i] === b);

function sniffOk(ext: string, buf: Buffer): boolean {
  switch (ext) {
    case "jpg":
    case "jpeg":
      return startsWith(buf, [0xff, 0xd8, 0xff]);
    case "png":
      return startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "pdf":
      return startsWith(buf, [0x25, 0x50, 0x44, 0x46]); // %PDF
    case "docx":
    case "xlsx":
      return startsWith(buf, [0x50, 0x4b, 0x03, 0x04]); // ZIP container
    case "txt":
    case "log": {
      // Text: reject NUL bytes and anything that looks like markup/script.
      const head = buf.subarray(0, 8192);
      if (head.includes(0)) return false;
      const s = head.toString("utf8").trimStart().toLowerCase();
      return !(s.startsWith("<!doctype") || s.startsWith("<html") || s.startsWith("<script") || s.startsWith("<svg"));
    }
    default:
      return false;
  }
}

export interface UploadCandidate {
  name: string;
  size: number;
  data: Buffer;
}

export interface UploadRules {
  maxFileSizeMb: number;
  maxFiles: number;
  allowedExtensions: string[];
}

export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  return base.replace(/[^\w.\- ()]/g, "_").replace(/^\.+/, "").slice(0, 200) || "file";
}

export function validateUploads(files: UploadCandidate[], rules: UploadRules): { error: string } | { ok: true; files: (UploadCandidate & { ext: string; mime: string; safeName: string })[] } {
  if (files.length > rules.maxFiles) return { error: `You can attach at most ${rules.maxFiles} files.` };
  const out = [];
  for (const f of files) {
    const safeName = sanitizeFileName(f.name);
    const ext = safeName.includes(".") ? safeName.split(".").pop()!.toLowerCase() : "";
    if (!ext || !rules.allowedExtensions.includes(ext) || !MIME_BY_EXT[ext]) {
      return { error: `"${safeName}": file type not allowed. Allowed: ${rules.allowedExtensions.join(", ")}.` };
    }
    if (f.size === 0) return { error: `"${safeName}" is empty.` };
    if (f.size > rules.maxFileSizeMb * 1024 * 1024) {
      return { error: `"${safeName}" exceeds the ${rules.maxFileSizeMb} MB limit.` };
    }
    if (!sniffOk(ext, f.data)) return { error: `"${safeName}": file content does not match its extension.` };
    out.push({ ...f, ext, mime: MIME_BY_EXT[ext]!, safeName });
  }
  return { ok: true, files: out };
}
