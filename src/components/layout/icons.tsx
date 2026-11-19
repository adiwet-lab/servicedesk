import {
  LayoutDashboard, Ticket, Users, Building2, PlusCircle, Bell, UserCircle, Inbox, AlertTriangle, Clock, List, FolderTree,
  Flag, Workflow, Timer, CalendarDays, Route, MapPin, Briefcase, Shield, KeyRound, Cloud, FileText, Settings, UsersRound,
  ListChecks, ExternalLink,
} from "lucide-react";
import type { IconName } from "./nav";

export const ICONS: Record<IconName, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard, ticket: Ticket, users: Users, building: Building2, plus: PlusCircle, bell: Bell, user: UserCircle,
  inbox: Inbox, alert: AlertTriangle, clock: Clock, list: List, folder: FolderTree, flag: Flag, workflow: Workflow, timer: Timer,
  calendar: CalendarDays, route: Route, map: MapPin, briefcase: Briefcase, shield: Shield, key: KeyRound, cloud: Cloud,
  file: FileText, settings: Settings, team: UsersRound, tasks: ListChecks, external: ExternalLink,
};
