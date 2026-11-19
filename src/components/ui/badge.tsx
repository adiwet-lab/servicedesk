import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary/10 text-primary",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "text-foreground",
        destructive: "border-transparent bg-destructive/10 text-destructive",
        success: "border-transparent bg-success/15 text-success",
        warning: "border-transparent bg-warning/20 text-amber-700 dark:text-amber-300",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/** Badge tinted with an admin-configured colour (status / priority). */
export function ColorBadge({ color, children, className }: { color: string; children: React.ReactNode; className?: string }) {
  const safe = /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#64748b";
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap", className)}
      style={{ backgroundColor: `${safe}1f`, color: safe }}>
      <span className="size-1.5 rounded-full" style={{ backgroundColor: safe }} />
      {children}
    </span>
  );
}
