"use client";
import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useTheme } from "next-themes";
import { Bell, Headset, LogOut, Menu, Moon, Search, Sun, ArrowLeftRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/misc";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ICONS } from "./icons";
import type { NavSection } from "./nav";
import { Toaster } from "@/components/realtime/toaster";
import { LiveIndicator, RealtimeProvider, useRealtimeContext } from "@/components/realtime/realtime-provider";

export interface ShellUser { name: string; email: string; roles: string[]; tenant: string; vendor: boolean }

type ShellProps = {
  nav: NavSection[]; user: ShellUser; unread: number; unreadMessages: number; portal: "user" | "admin"; canSwitch: boolean;
  signOutAction: () => Promise<void>; children: React.ReactNode;
};

export function AppShell(props: ShellProps) {
  return (
    <Toaster>
      <RealtimeProvider initialBadges={{ notifications: props.unread, messages: props.unreadMessages }}>
        <ShellInner {...props} />
      </RealtimeProvider>
    </Toaster>
  );
}

function ShellInner({ nav, user, portal, canSwitch, signOutAction, children }: ShellProps) {
  const { badges } = useRealtimeContext();
  const unread = badges.notifications;
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const current = pathname + (search.toString() ? `?${search.toString()}` : "");

  const isActive = (href: string) => {
    if (href.includes("?")) return current === href || (pathname === href.split("?")[0] && search.get("view") === new URLSearchParams(href.split("?")[1]).get("view"));
    if (href === "/admin") return pathname === "/admin" || /^\/admin\/dashboards\/(management|team|agent)/.test(pathname);
    if (href === "/dashboard" || href === "/tickets") return pathname === href;
    return pathname === href || pathname.startsWith(href + "/");
  };

  const sidebar = (
    <aside className="flex h-full w-64 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 items-center gap-2.5 border-b border-white/5 px-5">
        <div className="flex size-8 items-center justify-center rounded-lg bg-sidebar-primary/20 text-sidebar-primary"><Headset className="size-4" /></div>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-white">IT Service Desk</p>
          <p className="text-[11px] text-sidebar-muted">{portal === "admin" ? "Admin & Support Portal" : "User Portal"}</p>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Main">
        {nav.map((section, i) => (
          <div key={i} className="mb-4">
            {section.title && <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted">{section.title}</p>}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = ICONS[item.icon];
                const active = isActive(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                        active ? "bg-sidebar-accent text-white font-medium" : "hover:bg-sidebar-accent/60 hover:text-white",
                      )}
                    >
                      <Icon className={cn("size-4", active ? "text-sidebar-primary" : "text-sidebar-muted")} />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.badge === "messages" && badges.messages > 0 && (
                        <span className="rounded-full bg-sidebar-primary px-1.5 text-[10px] font-semibold text-sidebar" data-testid="nav-messages-badge">{badges.messages}</span>
                      )}
                      {item.soon && <span className="rounded bg-white/10 px-1.5 text-[10px] text-sidebar-muted">{item.soon}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      {canSwitch && (
        <div className="border-t border-white/5 p-3">
          <Link href={portal === "admin" ? "/dashboard" : "/admin"} className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-sidebar-accent/60 hover:text-white">
            <ArrowLeftRight className="size-4 text-sidebar-muted" />
            {portal === "admin" ? "Switch to User Portal" : "Switch to Admin Portal"}
          </Link>
        </div>
      )}
    </aside>
  );

  return (
    <div className="flex min-h-screen">
      <div className="fixed inset-y-0 left-0 z-30 hidden lg:block">{sidebar}</div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="relative h-full w-64">{sidebar}</div>
          <button className="absolute left-[17rem] top-3 rounded-md bg-card p-2" onClick={() => setOpen(false)} aria-label="Close menu"><X className="size-4" /></button>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-card/90 px-4 backdrop-blur lg:px-6">
          <button className="rounded-md p-2 hover:bg-accent lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="size-5" /></button>
          <form
            className="relative max-w-md flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              const q = new FormData(e.currentTarget).get("q");
              router.push(`/search?q=${encodeURIComponent(String(q ?? ""))}`);
            }}
          >
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input name="q" placeholder="Search tickets, requester, asset…" className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring" aria-label="Global search" />
          </form>
          <div className="ml-auto flex items-center gap-1">
            <LiveIndicator />
            <button className="rounded-md p-2 hover:bg-accent" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")} aria-label="Toggle dark mode">
              <Sun className="size-4 dark:hidden" /><Moon className="hidden size-4 dark:block" />
            </button>
            <Link href="/notifications" className="relative rounded-md p-2 hover:bg-accent" aria-label={`Notifications (${unread} unread)`}>
              <Bell className="size-4" />
              {unread > 0 && <span data-testid="bell-count" className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">{unread > 99 ? "99+" : unread}</span>}
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger className="ml-1 flex items-center gap-2 rounded-md p-1 pr-2 hover:bg-accent outline-none" data-testid="user-menu">
                <Avatar name={user.name} />
                <span className="hidden text-left leading-tight md:block">
                  <span className="block text-sm font-medium">{user.name}</span>
                  <span className="block text-[11px] text-muted-foreground">{user.roles[0] ?? "User"}</span>
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>
                  <p className="font-medium">{user.name}</p>
                  <p className="text-xs font-normal text-muted-foreground">{user.email}</p>
                  <p className="mt-1 text-xs font-normal text-muted-foreground">{user.tenant}{user.vendor ? " · External" : ""}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild><Link href="/profile">Profile</Link></DropdownMenuItem>
                {canSwitch && <DropdownMenuItem asChild><Link href={portal === "admin" ? "/dashboard" : "/admin"}>{portal === "admin" ? "User Portal" : "Admin Portal"}</Link></DropdownMenuItem>}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void signOutAction()} className="text-destructive"><LogOut /> Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
