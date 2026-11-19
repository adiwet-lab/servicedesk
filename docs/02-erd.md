# 02 · Database Design (ERD & schema)

Source of truth: [`prisma/schema.prisma`](../prisma/schema.prisma). Initial migration: `prisma/migrations/*_init` (includes the append-only audit trigger).

## Entity–relationship diagram
```mermaid
erDiagram
  Tenant ||--o{ User : "signs in"
  Tenant }o--o| Company : "linked to"
  Tenant }o--o| Role : "default role"
  Company ||--o{ Department : has
  Company ||--o{ Branch : has
  Branch ||--o{ Location : has
  User }o--o| Company : ""
  User }o--o| Department : ""
  User }o--o| Branch : ""
  User }o--o| Location : ""
  User }o--o| User : manager
  User ||--o{ UserRole : ""
  Role ||--o{ UserRole : ""
  Role ||--o{ RolePermission : ""
  Permission ||--o{ RolePermission : ""
  SupportTeam ||--o{ TeamMember : ""
  User ||--o{ TeamMember : ""
  SupportTeam }o--o| Tenant : "vendor tenant"
  SupportTeam }o--o| SlaProfile : ""
  Category ||--o{ Category : "subcategories"
  Category }o--o| SupportTeam : "default team"
  Category }o--o| Priority : "default priority"
  Category }o--o| SlaProfile : ""
  RoutingRule }o--|| SupportTeam : target
  RoutingRule }o--o| Category : ""
  TicketStatus ||--o{ WorkflowTransition : from
  TicketStatus ||--o{ WorkflowTransition : to
  Ticket }o--|| Category : category
  Ticket }o--o| Category : subcategory
  Ticket }o--|| Priority : ""
  Ticket }o--|| TicketStatus : ""
  Ticket }o--|| User : requester
  Ticket }o--o| SupportTeam : "owner team"
  Ticket }o--o| User : "assigned agent"
  Ticket }o--o| Ticket : "parent incident"
  Ticket ||--o{ TicketHistory : ""
  Ticket ||--o{ TicketAssignment : ""
  Ticket ||--o{ TicketSupportingTeam : ""
  Ticket ||--o{ TicketTask : ""
  TicketTask ||--o{ TaskAssignment : ""
  TicketTask ||--o{ TaskHistory : ""
  Ticket ||--o{ TicketMessage : ""
  TicketMessage ||--o{ MessageRead : ""
  Ticket ||--o{ TicketAttachment : ""
  TicketAttachment }o--o| TicketTask : ""
  TicketAttachment }o--o| TicketMessage : ""
  Ticket ||--o{ TicketTagMapping : ""
  TicketTag ||--o{ TicketTagMapping : ""
  SlaProfile ||--o{ SlaTarget : "per priority"
  SlaProfile }o--o| BusinessHours : ""
  BusinessHours ||--o{ Holiday : ""
  SlaProfile ||--o{ EscalationRule : ""
  Ticket ||--o{ SlaEvent : ""
  User ||--o{ Notification : ""
  User ||--o{ AuditLog : actor
  Ticket ||--o{ AuditLog : ""
```

## Table map (requirement → table)
| Required | Implemented as |
|---|---|
| Users, Tenants, Companies, Departments, Locations (+Branches) | `User`, `Tenant`, `Company`, `Department`, `Branch`, `Location` |
| Roles, Permissions, UserRoles | `Role`, `Permission`, `RolePermission`, `UserRole` |
| SupportTeams, TeamMembers | `SupportTeam`, `TeamMember` (+ `TeamCategory`) |
| Categories, SubCategories | `Category` (self-referencing `parentId`: null = main, else sub) — unlimited depth-ready, one routing/SLA model |
| Tickets, TicketAssignments, TicketHistory | `Ticket`, `TicketAssignment`, `TicketHistory` |
| TicketTasks, TaskAssignments | `TicketTask`, `TaskAssignment`, `TaskHistory` |
| TicketMessages, TicketAttachments | `TicketMessage` (PUBLIC / INTERNAL), `MessageRead`, `TicketAttachment` |
| SLAProfiles, SLAEvents, BusinessHours, Holidays | `SlaProfile`, `SlaTarget`, `SlaEvent`, `BusinessHours`, `Holiday`, `EscalationRule` |
| Notifications, AuditLogs | `Notification`, `AuditLog` (append-only trigger) |
| TicketTags, TicketTagMappings | `TicketTag`, `TicketTagMapping` |
| Configurable workflow | `TicketStatus` (with `kind`), `WorkflowTransition` |
| Auto-assignment | `RoutingRule` |
| Configurable numbering / settings | `NumberSequence`, `SystemSetting` |

## Key constraints & conventions
- **Identity**: `User @@unique([tenantId, entraObjectId])`; `Tenant.entraTenantId` unique. Email is *not* unique and not an identity key.
- **Codes** unique on `Company`, `SupportTeam`, `Category`, `Priority`, `TicketStatus`, `Role`, `Permission`; scoped-unique on `Department/Branch (companyId, code)`, `Location (branchId, code)`.
- **Ticket number** unique; allocated by `UPDATE "NumberSequence" … RETURNING` inside the create transaction (row lock → no duplicates under concurrency; yearly reset).
- **Soft delete** (`deletedAt`) on org, team, catalog, user, ticket, message and attachment rows; admin UI deactivates (`isActive`) rather than deletes.
- **Audit**: `AuditLog` has `BEFORE UPDATE OR DELETE` and `BEFORE TRUNCATE` triggers raising an exception.
- **Indexes** on every scope/filter column of `Ticket`, plus `(ticketId, createdAt)` on history/messages/events and `(userId, readAt, createdAt)` on notifications.
- **Roadmap fields** already present and nullable: `Ticket.impactScope`, `isMajorIncident`, `parentIncidentId`.
