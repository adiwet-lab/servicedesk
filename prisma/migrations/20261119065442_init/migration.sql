-- CreateEnum
CREATE TYPE "TenantType" AS ENUM ('INTERNAL', 'VENDOR');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'PENDING', 'INACTIVE');

-- CreateEnum
CREATE TYPE "TicketVisibility" AS ENUM ('OWN', 'OWN_DEPT', 'OWN_BRANCH', 'OWN_DEPT_BRANCH');

-- CreateEnum
CREATE TYPE "TeamType" AS ENUM ('INTERNAL', 'VENDOR', 'OUTSOURCE');

-- CreateEnum
CREATE TYPE "TeamMemberRole" AS ENUM ('MEMBER', 'LEAD');

-- CreateEnum
CREATE TYPE "StatusKind" AS ENUM ('NEW', 'OPEN', 'WAITING', 'RESOLVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AssignmentType" AS ENUM ('AUTO', 'ASSIGN', 'REASSIGN', 'TRANSFER', 'ESCALATE');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('PUBLIC', 'INTERNAL');

-- CreateEnum
CREATE TYPE "SlaClock" AS ENUM ('RESPONSE', 'RESOLUTION');

-- CreateEnum
CREATE TYPE "SlaEventType" AS ENUM ('STARTED', 'PAUSED', 'RESUMED', 'WARNING', 'BREACHED', 'MET');

-- CreateEnum
CREATE TYPE "ImpactScope" AS ENUM ('SINGLE_USER', 'SINGLE_BRANCH', 'MULTIPLE_BRANCHES', 'COMPANY_WIDE', 'MULTIPLE_COMPANIES');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "entraTenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "TenantType" NOT NULL DEFAULT 'INTERNAL',
    "primaryDomain" TEXT,
    "companyId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "autoProvisionUsers" BOOLEAN NOT NULL DEFAULT false,
    "defaultRoleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entraObjectId" TEXT,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "employeeId" TEXT,
    "jobTitle" TEXT,
    "contactNumber" TEXT,
    "companyId" TEXT,
    "departmentId" TEXT,
    "branchId" TEXT,
    "locationId" TEXT,
    "managerId" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "accessExpiresAt" TIMESTAMP(3),
    "ticketVisibility" "TicketVisibility" NOT NULL DEFAULT 'OWN',
    "sessionVersion" INTEGER NOT NULL DEFAULT 1,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "defaultTicketVisibility" "TicketVisibility" NOT NULL DEFAULT 'OWN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "group" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "SupportTeam" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "TeamType" NOT NULL DEFAULT 'INTERNAL',
    "companyId" TEXT,
    "tenantId" TEXT,
    "leadId" TEXT,
    "slaProfileId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SupportTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "TeamMemberRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("teamId","userId")
);

-- CreateTable
CREATE TABLE "TeamCategory" (
    "teamId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "TeamCategory_pkey" PRIMARY KEY ("teamId","categoryId")
);

-- CreateTable
CREATE TABLE "Priority" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#64748b',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Priority_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "defaultTeamId" TEXT,
    "defaultPriorityId" TEXT,
    "slaProfileId" TEXT,
    "requiredFields" JSONB NOT NULL DEFAULT '[]',
    "workflowRules" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutingRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 100,
    "categoryId" TEXT,
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "targetTeamId" TEXT NOT NULL,
    "targetAgentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoutingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketStatus" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "StatusKind" NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#64748b',
    "order" INTEGER NOT NULL DEFAULT 0,
    "pausesSla" BOOLEAN NOT NULL DEFAULT false,
    "requiresReason" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowTransition" (
    "id" TEXT NOT NULL,
    "fromStatusId" TEXT NOT NULL,
    "toStatusId" TEXT NOT NULL,
    "requiredPermission" TEXT NOT NULL DEFAULT 'ticket.update',
    "requesterAllowed" BOOLEAN NOT NULL DEFAULT false,
    "requiresComment" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "subcategoryId" TEXT,
    "priorityId" TEXT NOT NULL,
    "statusId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "companyId" TEXT,
    "departmentId" TEXT,
    "branchId" TEXT,
    "locationId" TEXT,
    "contactNumber" TEXT,
    "relatedAsset" TEXT,
    "affectedSystem" TEXT,
    "affectedUsers" TEXT,
    "ownerTeamId" TEXT,
    "assignedAgentId" TEXT,
    "isConfidential" BOOLEAN NOT NULL DEFAULT false,
    "waitingReason" TEXT,
    "resolutionSummary" TEXT,
    "slaProfileId" TEXT,
    "responseDueAt" TIMESTAMP(3),
    "resolutionDueAt" TIMESTAMP(3),
    "firstResponseAt" TIMESTAMP(3),
    "slaPausedAt" TIMESTAMP(3),
    "slaPausedMinutes" INTEGER NOT NULL DEFAULT 0,
    "responseBreached" BOOLEAN NOT NULL DEFAULT false,
    "resolutionBreached" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "impactScope" "ImpactScope",
    "isMajorIncident" BOOLEAN NOT NULL DEFAULT false,
    "parentIncidentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketHistory" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "field" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketAssignment" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "type" "AssignmentType" NOT NULL,
    "prevTeamId" TEXT,
    "newTeamId" TEXT,
    "prevAgentId" TEXT,
    "newAgentId" TEXT,
    "changedById" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketSupportingTeam" (
    "ticketId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketSupportingTeam_pkey" PRIMARY KEY ("ticketId","teamId")
);

-- CreateTable
CREATE TABLE "TicketTask" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "teamId" TEXT,
    "assignedAgentId" TEXT,
    "priorityId" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "startDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAssignment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "teamId" TEXT,
    "agentId" TEXT,
    "changedById" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskHistory" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "field" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketMessage" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "type" "MessageType" NOT NULL DEFAULT 'PUBLIC',
    "body" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TicketMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageRead" (
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageRead_pkey" PRIMARY KEY ("messageId","userId")
);

-- CreateTable
CREATE TABLE "TicketAttachment" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "taskId" TEXT,
    "messageId" TEXT,
    "uploadedById" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TicketAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketTag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#64748b',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketTagMapping" (
    "ticketId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "TicketTagMapping_pkey" PRIMARY KEY ("ticketId","tagId")
);

-- CreateTable
CREATE TABLE "BusinessHours" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Bangkok',
    "schedule" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessHours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "businessHoursId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlaProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "businessHoursId" TEXT,
    "pauseStatusCodes" JSONB NOT NULL DEFAULT '[]',
    "warningPercent" INTEGER NOT NULL DEFAULT 75,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlaProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlaTarget" (
    "id" TEXT NOT NULL,
    "slaProfileId" TEXT NOT NULL,
    "priorityId" TEXT NOT NULL,
    "responseMinutes" INTEGER NOT NULL,
    "resolutionMinutes" INTEGER NOT NULL,
    "businessHoursOnly" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SlaTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlaEvent" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "clock" "SlaClock" NOT NULL,
    "type" "SlaEventType" NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlaEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscalationRule" (
    "id" TEXT NOT NULL,
    "slaProfileId" TEXT NOT NULL,
    "clock" "SlaClock" NOT NULL,
    "atPercent" INTEGER NOT NULL,
    "notifyTeamLead" BOOLEAN NOT NULL DEFAULT true,
    "escalateToTeamId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EscalationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ticketId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "actorId" TEXT,
    "ticketId" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NumberSequence" (
    "key" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT '{PREFIX}-{YYYY}-{SEQ:6}',
    "resetYearly" BOOLEAN NOT NULL DEFAULT true,
    "year" INTEGER NOT NULL,
    "current" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NumberSequence_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_entraTenantId_key" ON "Tenant"("entraTenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Company_code_key" ON "Company"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Department_companyId_code_key" ON "Department"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_companyId_code_key" ON "Branch"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Location_branchId_code_key" ON "Location"("branchId", "code");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_departmentId_idx" ON "User"("departmentId");

-- CreateIndex
CREATE INDEX "User_branchId_idx" ON "User"("branchId");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_entraObjectId_key" ON "User"("tenantId", "entraObjectId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_code_key" ON "Permission"("code");

-- CreateIndex
CREATE UNIQUE INDEX "SupportTeam_code_key" ON "SupportTeam"("code");

-- CreateIndex
CREATE INDEX "TeamMember_userId_idx" ON "TeamMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Priority_code_key" ON "Priority"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Priority_level_key" ON "Priority"("level");

-- CreateIndex
CREATE UNIQUE INDEX "Category_code_key" ON "Category"("code");

-- CreateIndex
CREATE INDEX "Category_parentId_idx" ON "Category"("parentId");

-- CreateIndex
CREATE INDEX "RoutingRule_isActive_order_idx" ON "RoutingRule"("isActive", "order");

-- CreateIndex
CREATE UNIQUE INDEX "TicketStatus_code_key" ON "TicketStatus"("code");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowTransition_fromStatusId_toStatusId_key" ON "WorkflowTransition"("fromStatusId", "toStatusId");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_number_key" ON "Ticket"("number");

-- CreateIndex
CREATE INDEX "Ticket_statusId_idx" ON "Ticket"("statusId");

-- CreateIndex
CREATE INDEX "Ticket_requesterId_idx" ON "Ticket"("requesterId");

-- CreateIndex
CREATE INDEX "Ticket_ownerTeamId_idx" ON "Ticket"("ownerTeamId");

-- CreateIndex
CREATE INDEX "Ticket_assignedAgentId_idx" ON "Ticket"("assignedAgentId");

-- CreateIndex
CREATE INDEX "Ticket_departmentId_idx" ON "Ticket"("departmentId");

-- CreateIndex
CREATE INDEX "Ticket_branchId_idx" ON "Ticket"("branchId");

-- CreateIndex
CREATE INDEX "Ticket_categoryId_idx" ON "Ticket"("categoryId");

-- CreateIndex
CREATE INDEX "Ticket_priorityId_idx" ON "Ticket"("priorityId");

-- CreateIndex
CREATE INDEX "Ticket_createdAt_idx" ON "Ticket"("createdAt");

-- CreateIndex
CREATE INDEX "Ticket_resolutionDueAt_idx" ON "Ticket"("resolutionDueAt");

-- CreateIndex
CREATE INDEX "TicketHistory_ticketId_createdAt_idx" ON "TicketHistory"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "TicketAssignment_ticketId_createdAt_idx" ON "TicketAssignment"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "TicketSupportingTeam_teamId_idx" ON "TicketSupportingTeam"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "TicketTask_number_key" ON "TicketTask"("number");

-- CreateIndex
CREATE INDEX "TicketTask_ticketId_idx" ON "TicketTask"("ticketId");

-- CreateIndex
CREATE INDEX "TicketTask_teamId_idx" ON "TicketTask"("teamId");

-- CreateIndex
CREATE INDEX "TicketTask_assignedAgentId_idx" ON "TicketTask"("assignedAgentId");

-- CreateIndex
CREATE INDEX "TicketTask_status_dueDate_idx" ON "TicketTask"("status", "dueDate");

-- CreateIndex
CREATE INDEX "TaskAssignment_taskId_idx" ON "TaskAssignment"("taskId");

-- CreateIndex
CREATE INDEX "TaskHistory_taskId_createdAt_idx" ON "TaskHistory"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "TicketMessage_ticketId_createdAt_idx" ON "TicketMessage"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "MessageRead_userId_idx" ON "MessageRead"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TicketAttachment_storageKey_key" ON "TicketAttachment"("storageKey");

-- CreateIndex
CREATE INDEX "TicketAttachment_ticketId_idx" ON "TicketAttachment"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "TicketTag_name_key" ON "TicketTag"("name");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessHours_name_key" ON "BusinessHours"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_businessHoursId_date_key" ON "Holiday"("businessHoursId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SlaProfile_name_key" ON "SlaProfile"("name");

-- CreateIndex
CREATE UNIQUE INDEX "SlaTarget_slaProfileId_priorityId_key" ON "SlaTarget"("slaProfileId", "priorityId");

-- CreateIndex
CREATE INDEX "SlaEvent_ticketId_createdAt_idx" ON "SlaEvent"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_ticketId_idx" ON "AuditLog"("ticketId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_defaultRoleId_fkey" FOREIGN KEY ("defaultRoleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTeam" ADD CONSTRAINT "SupportTeam_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTeam" ADD CONSTRAINT "SupportTeam_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTeam" ADD CONSTRAINT "SupportTeam_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTeam" ADD CONSTRAINT "SupportTeam_slaProfileId_fkey" FOREIGN KEY ("slaProfileId") REFERENCES "SlaProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "SupportTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamCategory" ADD CONSTRAINT "TeamCategory_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "SupportTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamCategory" ADD CONSTRAINT "TeamCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_defaultTeamId_fkey" FOREIGN KEY ("defaultTeamId") REFERENCES "SupportTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_defaultPriorityId_fkey" FOREIGN KEY ("defaultPriorityId") REFERENCES "Priority"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_slaProfileId_fkey" FOREIGN KEY ("slaProfileId") REFERENCES "SlaProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingRule" ADD CONSTRAINT "RoutingRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingRule" ADD CONSTRAINT "RoutingRule_targetTeamId_fkey" FOREIGN KEY ("targetTeamId") REFERENCES "SupportTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingRule" ADD CONSTRAINT "RoutingRule_targetAgentId_fkey" FOREIGN KEY ("targetAgentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowTransition" ADD CONSTRAINT "WorkflowTransition_fromStatusId_fkey" FOREIGN KEY ("fromStatusId") REFERENCES "TicketStatus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowTransition" ADD CONSTRAINT "WorkflowTransition_toStatusId_fkey" FOREIGN KEY ("toStatusId") REFERENCES "TicketStatus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_subcategoryId_fkey" FOREIGN KEY ("subcategoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_priorityId_fkey" FOREIGN KEY ("priorityId") REFERENCES "Priority"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "TicketStatus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_ownerTeamId_fkey" FOREIGN KEY ("ownerTeamId") REFERENCES "SupportTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_assignedAgentId_fkey" FOREIGN KEY ("assignedAgentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_slaProfileId_fkey" FOREIGN KEY ("slaProfileId") REFERENCES "SlaProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_parentIncidentId_fkey" FOREIGN KEY ("parentIncidentId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketHistory" ADD CONSTRAINT "TicketHistory_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketHistory" ADD CONSTRAINT "TicketHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketAssignment" ADD CONSTRAINT "TicketAssignment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketAssignment" ADD CONSTRAINT "TicketAssignment_prevTeamId_fkey" FOREIGN KEY ("prevTeamId") REFERENCES "SupportTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketAssignment" ADD CONSTRAINT "TicketAssignment_newTeamId_fkey" FOREIGN KEY ("newTeamId") REFERENCES "SupportTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketAssignment" ADD CONSTRAINT "TicketAssignment_prevAgentId_fkey" FOREIGN KEY ("prevAgentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketAssignment" ADD CONSTRAINT "TicketAssignment_newAgentId_fkey" FOREIGN KEY ("newAgentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketAssignment" ADD CONSTRAINT "TicketAssignment_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketSupportingTeam" ADD CONSTRAINT "TicketSupportingTeam_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketSupportingTeam" ADD CONSTRAINT "TicketSupportingTeam_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "SupportTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketTask" ADD CONSTRAINT "TicketTask_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketTask" ADD CONSTRAINT "TicketTask_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "SupportTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketTask" ADD CONSTRAINT "TicketTask_assignedAgentId_fkey" FOREIGN KEY ("assignedAgentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketTask" ADD CONSTRAINT "TicketTask_priorityId_fkey" FOREIGN KEY ("priorityId") REFERENCES "Priority"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketTask" ADD CONSTRAINT "TicketTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "TicketTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "SupportTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskHistory" ADD CONSTRAINT "TaskHistory_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "TicketTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskHistory" ADD CONSTRAINT "TaskHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketMessage" ADD CONSTRAINT "TicketMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketMessage" ADD CONSTRAINT "TicketMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageRead" ADD CONSTRAINT "MessageRead_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "TicketMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageRead" ADD CONSTRAINT "MessageRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketAttachment" ADD CONSTRAINT "TicketAttachment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketAttachment" ADD CONSTRAINT "TicketAttachment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "TicketTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketAttachment" ADD CONSTRAINT "TicketAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "TicketMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketAttachment" ADD CONSTRAINT "TicketAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketTagMapping" ADD CONSTRAINT "TicketTagMapping_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketTagMapping" ADD CONSTRAINT "TicketTagMapping_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "TicketTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_businessHoursId_fkey" FOREIGN KEY ("businessHoursId") REFERENCES "BusinessHours"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaProfile" ADD CONSTRAINT "SlaProfile_businessHoursId_fkey" FOREIGN KEY ("businessHoursId") REFERENCES "BusinessHours"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaTarget" ADD CONSTRAINT "SlaTarget_slaProfileId_fkey" FOREIGN KEY ("slaProfileId") REFERENCES "SlaProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaTarget" ADD CONSTRAINT "SlaTarget_priorityId_fkey" FOREIGN KEY ("priorityId") REFERENCES "Priority"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaEvent" ADD CONSTRAINT "SlaEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationRule" ADD CONSTRAINT "EscalationRule_slaProfileId_fkey" FOREIGN KEY ("slaProfileId") REFERENCES "SlaProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationRule" ADD CONSTRAINT "EscalationRule_escalateToTeamId_fkey" FOREIGN KEY ("escalateToTeamId") REFERENCES "SupportTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ───────────── Audit log is append-only ─────────────
CREATE OR REPLACE FUNCTION audit_log_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutation();

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_block_mutation();
