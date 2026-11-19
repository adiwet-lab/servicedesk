import * as React from "react";
import { cn } from "@/lib/utils";

export function Separator({ className }: { className?: string }) {
  return <div role="separator" className={cn("h-px w-full bg-border", className)} />;
}

export function Alert({ variant = "default", className, children }: { variant?: "default" | "destructive" | "success" | "warning"; className?: string; children: React.ReactNode }) {
  const styles = {
    default: "border-border bg-muted/50",
    destructive: "border-destructive/30 bg-destructive/10 text-destructive",
    success: "border-success/30 bg-success/10 text-success",
    warning: "border-warning/40 bg-warning/10 text-amber-800 dark:text-amber-200",
  }[variant];
  return <div role="alert" className={cn("rounded-lg border px-4 py-3 text-sm", styles, className)}>{children}</div>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, description, icon }: { title: string; description?: string; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
      {icon && <div className="text-muted-foreground [&_svg]:size-8">{icon}</div>}
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join("");
  return (
    <span className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary", className)}>
      {initials || "?"}
    </span>
  );
}

export function Field({ label, htmlFor, error, hint, required, children, className }: {
  label: string; htmlFor?: string; error?: string; hint?: string; required?: boolean; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label} {required && <span className="text-destructive">*</span>}
      </label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
