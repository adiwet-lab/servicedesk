import { Fragment } from "react";
import { parseMarkdown, type Block, type Inline } from "@/lib/markdown";
import { cn } from "@/lib/utils";

function Inlines({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case "text": return <Fragment key={i}>{n.v}</Fragment>;
          case "strong": return <strong key={i}><Inlines nodes={n.c} /></strong>;
          case "em": return <em key={i}><Inlines nodes={n.c} /></em>;
          case "code": return <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{n.v}</code>;
          case "link": {
            const external = !n.href.startsWith("/");
            return <a key={i} href={n.href} className="text-primary underline underline-offset-2" {...(external ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {})}><Inlines nodes={n.c} /></a>;
          }
        }
      })}
    </>
  );
}

function BlockView({ b }: { b: Block }) {
  switch (b.t) {
    case "h": {
      const cls = b.level === 1 ? "text-xl font-semibold" : b.level === 2 ? "text-lg font-semibold" : "text-base font-semibold";
      const Tag = (`h${b.level + 1}`) as "h2" | "h3" | "h4"; // page title is the h1
      return <Tag className={cn(cls, "mt-5 first:mt-0")}><Inlines nodes={b.c} /></Tag>;
    }
    case "p": return <p className="leading-relaxed"><Inlines nodes={b.c} /></p>;
    case "ul": return <ul className="list-disc space-y-1 pl-6">{b.items.map((it, i) => <li key={i}><Inlines nodes={it} /></li>)}</ul>;
    case "ol": return <ol className="list-decimal space-y-1 pl-6">{b.items.map((it, i) => <li key={i}><Inlines nodes={it} /></li>)}</ol>;
    case "quote": return <blockquote className="border-l-4 pl-3 text-muted-foreground"><Inlines nodes={b.c} /></blockquote>;
    case "pre": return <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs"><code>{b.v}</code></pre>;
  }
}

/** Renders article Markdown as React elements (never as raw HTML). */
export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = parseMarkdown(source);
  return <div className={cn("space-y-3 text-sm", className)} data-testid="kb-body">{blocks.map((b, i) => <BlockView key={i} b={b} />)}</div>;
}
