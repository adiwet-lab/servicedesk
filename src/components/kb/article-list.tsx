import Link from "next/link";
import { ThumbsUp, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useLocale, useTranslations } from "next-intl";
import { ln } from "@/lib/localized";
import type { Locale } from "@/i18n/config";
import type { KB_STATUS_LABEL, KB_TYPE_LABEL } from "@/server/services/kb";

export interface ArticleRow {
  id: string; number: string; title: string; snippet: string; type: keyof typeof KB_TYPE_LABEL; status: keyof typeof KB_STATUS_LABEL;
  visibility: "EMPLOYEES" | "SUPPORT_ONLY"; viewCount: number; helpfulYes: number;
  category: { name: string; nameTh?: string | null; parent: { name: string; nameTh?: string | null } | null } | null;
}

export function ArticleList({ rows, hrefBase, showStatus }: { rows: ArticleRow[]; hrefBase: string; showStatus?: boolean }) {
  const tk = useTranslations("kb");
  const th = useTranslations("help");
  const locale = useLocale() as Locale;
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted-foreground">{th("noArticles")}</p>;
  return (
    <ul className="divide-y" data-testid="kb-results">
      {rows.map((a) => (
        <li key={a.id} className="py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`${hrefBase}/${a.number}`} className="font-medium text-primary hover:underline">{a.title}</Link>
            <Badge variant="secondary">{tk(`kbType.${a.type}`)}</Badge>
            {a.visibility === "SUPPORT_ONLY" && <Badge variant="warning">{tk("supportOnly")}</Badge>}
            {showStatus && <Badge variant={a.status === "PUBLISHED" ? "success" : a.status === "DRAFT" ? "outline" : "secondary"}>{tk(`kbStatus.${a.status}`)}</Badge>}
          </div>
          <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{a.snippet}</p>
          <p className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="font-mono">{a.number}</span>
            {a.category && <span>{a.category.parent ? `${ln(a.category.parent, locale)} › ` : ""}{ln(a.category, locale)}</span>}
            <span className="inline-flex items-center gap-1"><Eye className="size-3" /> {a.viewCount}</span>
            <span className="inline-flex items-center gap-1"><ThumbsUp className="size-3" /> {a.helpfulYes}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}
