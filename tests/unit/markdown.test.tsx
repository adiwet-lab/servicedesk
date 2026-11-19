import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { markdownToText, parseInline, parseMarkdown, safeHref } from "@/lib/markdown";
import { Markdown } from "@/components/kb/markdown";

const html = (src: string) => renderToStaticMarkup(<Markdown source={src} />);

describe("safeHref", () => {
  it("allows http(s), mailto and site-relative links", () => {
    expect(safeHref("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeHref("http://intranet.local/x")).toBe("http://intranet.local/x");
    expect(safeHref("mailto:it@contoso.example")).toBe("mailto:it@contoso.example");
    expect(safeHref("/help/KB-000001")).toBe("/help/KB-000001");
  });
  it.each([
    "javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:alert(1)", "java\tscript:alert(1)", "java\nscript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=", "vbscript:msgbox", "//evil.example/x", "/\\evil.example", "file:///etc/passwd",
    "\u0000javascript:alert(1)", "relative/path", "https://", "",
  ])("rejects %j", (u) => expect(safeHref(u)).toBeNull());
});

describe("markdown rendering is XSS-safe", () => {
  it("escapes raw HTML in text, headings, lists, code and quotes", () => {
    const out = html([
      "<script>alert(1)</script>",
      "# <img src=x onerror=alert(1)>",
      "- <b onclick=x>item</b>",
      "> <iframe src=javascript:alert(1)>",
      "```", "<script>code()</script>", "```",
      "`<svg onload=alert(1)>`",
    ].join("\n\n"));
    expect(out).not.toMatch(/<script|<img|<iframe|<svg|<b /i);
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(out).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
  it("drops unsafe link targets but keeps the text", () => {
    const out = html("[click me](javascript:alert(document.cookie)) and [ok](https://ok.example)");
    expect(out).not.toContain("javascript:");
    expect(out).toContain("click me");
    expect(out).toContain('href="https://ok.example"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
  });
  it("escapes quotes inside link targets (no attribute injection)", () => {
    const out = html('[x](https://a.example/"onmouseover="alert(1))');
    expect(out).not.toMatch(/"\s*onmouseover=/);
  });
  it("internal links open in the same tab", () => {
    expect(html("[KB](/help/KB-000001)")).not.toContain("target=");
  });
  it("entities in the source are shown literally", () => {
    expect(html("&lt;b&gt; &amp;")).toContain("&amp;lt;b&amp;gt; &amp;amp;");
  });
});

describe("markdown structure", () => {
  it("parses headings, lists, quotes, code and paragraphs", () => {
    const b = parseMarkdown("# Title\n\nText line one\nline two\n\n- a\n- b\n\n1. one\n2. two\n\n> note\n\n```\ncode\n```");
    expect(b.map((x) => x.t)).toEqual(["h", "p", "ul", "ol", "quote", "pre"]);
  });
  it("parses inline bold, italic, code and keeps snake_case", () => {
    expect(parseInline("**b** *i* `c` my_var_name").map((n) => n.t)).toEqual(["strong", "text", "em", "text", "code", "text"]);
    expect(parseInline("my_var_name")).toEqual([{ t: "text", v: "my_var_name" }]);
  });
  it("produces plain-text snippets", () => {
    expect(markdownToText("## Steps\n\n1. **Open** [portal](https://x.example)", 100)).toBe("Steps 1. Open portal");
    expect(markdownToText("a".repeat(50), 10)).toHaveLength(10);
  });
});
