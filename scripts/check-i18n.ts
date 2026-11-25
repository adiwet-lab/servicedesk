/**
 * Fails on user-visible English literals that bypass translations:
 *  - JSX text containing letters
 *  - string literals in UI props (placeholder, title, aria-label, label, description, alt, hint)
 *  - JSX expression string literals rendered as children ({"Text"})
 * Usage: pnpm lint:i18n            (exit 1 when findings exist)
 *        pnpm lint:i18n --summary  (counts per file)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const ROOTS = ["src/app", "src/components"];
const PROPS = new Set(["placeholder", "title", "aria-label", "label", "description", "alt", "hint", "caption"]);
/** Literals that are not language (brands, symbols, codes, units). */
const ALLOW = [/^[\s\d\W_]*$/, /^[A-Z][A-Z0-9_]+$/, /^(IT Service Desk|Microsoft|Microsoft Teams|Microsoft Graph|Power BI|Entra ID|Snipe-IT|Defender|CSV|NDJSON|JSON|SLA|KPI|P[1-4]|TH|EN|ไทย|English|OK|ID|URL|API|https?:\/\/\S+)$/, /^[\p{Script=Thai}\s\d\W]+$/u];

export interface Finding { file: string; line: number; text: string }

function walk(dir: string, out: string[] = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out); else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}
const allowed = (s: string) => { const t = s.trim(); return !t || !/[A-Za-z]/.test(t) || ALLOW.some((r) => r.test(t)); };

export function scanFile(file: string, src = readFileSync(file, "utf8")): Finding[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: Finding[] = [];
  const add = (node: ts.Node, text: string) => found.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, text: text.trim().replace(/\s+/g, " ").slice(0, 300) });
  const visit = (node: ts.Node) => {
    const inCode = !!node.parent && ts.isJsxElement(node.parent) && ["code", "pre", "kbd"].includes(node.parent.openingElement.tagName.getText());
    if (ts.isJsxText(node) && !inCode && !allowed(node.getText())) add(node, node.getText());
    if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText();
      const init = node.initializer;
      const lit = ts.isStringLiteral(init) ? init : ts.isJsxExpression(init) && init.expression && (ts.isStringLiteral(init.expression) || ts.isNoSubstitutionTemplateLiteral(init.expression)) ? init.expression : null;
      if (PROPS.has(name) && lit && !allowed(lit.text)) add(lit, lit.text);
    }
    // Strings nested in expressions rendered as JSX children or UI props: ternaries, ||/??, template literals.
    if (ts.isJsxExpression(node) && node.expression) {
      const isChild = ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent);
      const isUiProp = ts.isJsxAttribute(node.parent) && PROPS.has(node.parent.name.getText());
      if (isChild || isUiProp) scanExpr(node.expression);
    }
    ts.forEachChild(node, visit);
  };
  /** Collects text literals that would be rendered, skipping call arguments (t("key")), comparisons and JSX (visited separately). */
  const scanExpr = (e: ts.Node): void => {
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) { if (!allowed(e.text)) add(e, e.text); return; }
    if (ts.isTemplateExpression(e)) {
      const txt = [e.head.text, ...e.templateSpans.map((sp) => sp.literal.text)].join(" ");
      if (!allowed(txt)) add(e, txt);
      return;
    }
    if (ts.isCallExpression(e) || ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e) || ts.isJsxFragment(e) || ts.isArrowFunction(e) || ts.isFunctionExpression(e)) return;
    if (ts.isBinaryExpression(e) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.InKeyword].includes(e.operatorToken.kind)) return;
    if (ts.isConditionalExpression(e)) { scanExpr(e.whenTrue); scanExpr(e.whenFalse); return; }
    if (ts.isElementAccessExpression(e) || ts.isPropertyAccessExpression(e)) return;
    ts.forEachChild(e, scanExpr);
  };
  visit(sf);
  return found;
}

export function scanAll(): Finding[] {
  return ROOTS.flatMap((r) => walk(r)).flatMap((f) => scanFile(f));
}

if (process.argv[1]?.endsWith("check-i18n.ts")) {
  const findings = scanAll();
  if (process.argv.includes("--summary")) {
    const by = new Map<string, number>();
    for (const f of findings) by.set(f.file, (by.get(f.file) ?? 0) + 1);
    for (const [f, n] of [...by].sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(4), relative(".", f));
  } else for (const f of findings) console.log(`${relative(".", f.file)}:${f.line}  ${f.text}`);
  console.log(`${findings.length} untranslated literal(s)`);
  process.exitCode = findings.length ? 1 : 0;
}
