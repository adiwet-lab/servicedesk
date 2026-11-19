/**
 * Minimal Markdown-subset parser for knowledge articles.
 *
 * Output is a plain AST that the <Markdown> component renders as React elements —
 * article text is never injected as HTML, so markup in the source is shown literally.
 * Supported: # / ## / ### headings, paragraphs, - / * bullet lists, 1. numbered lists,
 * > quotes, ``` code blocks, **bold**, *italic* / _italic_, `code`, [text](url).
 * Links are kept only for http(s):, mailto: and site-relative (/path) targets.
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; c: Inline[] };

export type Block =
  | { t: "h"; level: 1 | 2 | 3; c: Inline[] }
  | { t: "p"; c: Inline[] }
  | { t: "ul"; items: Inline[][] }
  | { t: "ol"; items: Inline[][] }
  | { t: "quote"; c: Inline[] }
  | { t: "pre"; v: string };

const MAX_INPUT = 100_000;

/** Returns a safe href or null. Rejects javascript:, data:, vbscript:, protocol-relative and obfuscated schemes. */
export function safeHref(raw: string): string | null {
  const url = raw.trim();
  if (!url || url.length > 2000) return null;
  // Control characters / whitespace inside a URL are a classic scheme-obfuscation trick.
  if (/[\u0000-\u001f\u007f\s]/.test(url)) return null;
  if (url.startsWith("/") && !url.startsWith("//") && !url.startsWith("/\\")) return url;
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url);
  if (!m) return null;
  const scheme = m[1]!.toLowerCase();
  if (scheme === "http" || scheme === "https") {
    try { new URL(url); return url; } catch { return null; }
  }
  if (scheme === "mailto") return url;
  return null;
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => { if (buf) { out.push({ t: "text", v: buf }); buf = ""; } };
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === "\\" && i + 1 < src.length && /[\\`*_[\]()#>-]/.test(src[i + 1]!)) { buf += src[i + 1]; i += 2; continue; }
    if (ch === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i) { flush(); out.push({ t: "code", v: src.slice(i + 1, end) }); i = end + 1; continue; }
    }
    if (src.startsWith("**", i)) {
      const end = src.indexOf("**", i + 2);
      if (end > i + 2) { flush(); out.push({ t: "strong", c: parseInline(src.slice(i + 2, end)) }); i = end + 2; continue; }
    }
    if ((ch === "*" || ch === "_") && src[i + 1] && src[i + 1] !== " ") {
      const end = src.indexOf(ch, i + 1);
      // `_` only as a delimiter at word boundaries so snake_case stays intact.
      const boundaryOk = ch === "*" || ((i === 0 || /\W/.test(src[i - 1]!)) && (end + 1 >= src.length || /\W/.test(src[end + 1]!)));
      if (end > i + 1 && src[end - 1] !== " " && boundaryOk) { flush(); out.push({ t: "em", c: parseInline(src.slice(i + 1, end)) }); i = end + 1; continue; }
    }
    if (ch === "[") {
      const close = src.indexOf("]", i + 1);
      if (close > i && src[close + 1] === "(") {
        const end = src.indexOf(")", close + 2);
        if (end > close) {
          const text = src.slice(i + 1, close);
          const href = safeHref(src.slice(close + 2, end));
          flush();
          if (href) out.push({ t: "link", href, c: parseInline(text) });
          else out.push(...parseInline(text)); // unsafe link → keep text only
          i = end + 1;
          continue;
        }
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

export function parseMarkdown(input: string): Block[] {
  const lines = input.slice(0, MAX_INPUT).replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flushPara = () => { if (para.length) { blocks.push({ t: "p", c: parseInline(para.join(" ")) }); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^```/.test(line.trim())) {
      flushPara();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i]!.trim())) code.push(lines[i++]!);
      blocks.push({ t: "pre", v: code.join("\n") });
      continue;
    }
    if (!line.trim()) { flushPara(); continue; }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) { flushPara(); blocks.push({ t: "h", level: h[1]!.length as 1 | 2 | 3, c: parseInline(h[2]!.trim()) }); continue; }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      flushPara();
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const re = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*]\s+(.*)$/;
      const items: Inline[][] = [];
      while (i < lines.length && re.test(lines[i]!)) items.push(parseInline(re.exec(lines[i++]!)![1]!));
      i--;
      blocks.push(ordered ? { t: "ol", items } : { t: "ul", items });
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushPara();
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) q.push(lines[i++]!.replace(/^>\s?/, ""));
      i--;
      blocks.push({ t: "quote", c: parseInline(q.join(" ")) });
      continue;
    }
    para.push(line.trim());
  }
  flushPara();
  return blocks;
}

/** Plain text (for snippets / search previews). */
export function markdownToText(input: string, max = 300): string {
  const text = input
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
