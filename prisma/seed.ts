import { PrismaClient, type StatusKind, type TicketVisibility } from "@prisma/client";
import { ALL_PERMISSIONS, DEFAULT_ROLE_MATRIX, PERMISSION_META, type RoleCode } from "../src/server/authz/permissions";

const prisma = new PrismaClient();

// Demo Entra tenant IDs (GUIDs). Replace with real tenant IDs in Admin → Microsoft Tenants.
const TENANTS = [
  { key: "A", tid: "11111111-1111-4111-8111-111111111111", name: "Contoso Retail (Internal Domain A)", type: "INTERNAL", domain: "contoso.example", company: "CTR" },
  { key: "B", tid: "22222222-2222-4222-8222-222222222222", name: "Fabrikam Holdings (Internal Domain B)", type: "INTERNAL", domain: "fabrikam.example", company: "FAB" },
  { key: "VA", tid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Outsource Vendor A (Network MSP)", type: "VENDOR", domain: "vendor-a.example", company: null },
  { key: "VB", tid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Outsource Vendor B (Payments)", type: "VENDOR", domain: "vendor-b.example", company: null },
] as const;

const CATEGORY_TREE: { code: string; name: string; team: string; children: [string, string, string?][] }[] = [
  { code: "HW", name: "Hardware", team: "IT-SUPPORT", children: [["HW-NB", "Notebook"], ["HW-DT", "Desktop"], ["HW-PR", "Printer"], ["HW-MN", "Monitor"], ["HW-MB", "Mobile Device"], ["HW-PE", "Peripheral"]] },
  { code: "NW", name: "Network", team: "INFRA", children: [["NW-WIFI", "Wi-Fi"], ["NW-LAN", "LAN"], ["NW-VPN", "VPN"], ["NW-INET", "Internet", "VENDOR-A"], ["NW-FW", "Firewall"], ["NW-SRV", "Server"]] },
  { code: "SYS", name: "System", team: "ERP", children: [["SYS-ERP", "ERP"], ["SYS-POS", "POS", "RETAIL"], ["SYS-HR", "HR System"], ["SYS-ACC", "Accounting System"], ["SYS-EC", "Ecommerce"]] },
  { code: "M365", name: "Microsoft 365", team: "M365", children: [["M365-MAIL", "Email"], ["M365-ACC", "Account"], ["M365-PERM", "Access Permission"], ["M365-TEAMS", "Microsoft Teams"]] },
  { code: "RTL", name: "Retail Systems", team: "RETAIL", children: [["RTL-POS", "POS"], ["RTL-BAR", "Barcode Scanner"], ["RTL-PAY", "Payment Terminal", "VENDOR-B"], ["RTL-CCTV", "CCTV"]] },
  { code: "REQ", name: "IT Request", team: "IT-SUPPORT", children: [["REQ-SW", "Software Installation"], ["REQ-HW", "Hardware Request"], ["REQ-ACC", "Access Request"], ["REQ-NEW", "New Equipment"]] },
];

const STATUSES: { code: string; name: string; kind: StatusKind; color: string; pausesSla?: boolean; requiresReason?: boolean; isDefault?: boolean }[] = [
  { code: "NEW", name: "New", kind: "NEW", color: "#3b82f6", isDefault: true },
  { code: "ASSIGNED", name: "Assigned", kind: "OPEN", color: "#6366f1" },
  { code: "IN_PROGRESS", name: "In Progress", kind: "OPEN", color: "#f59e0b" },
  { code: "WAITING_USER", name: "Waiting for User", kind: "WAITING", color: "#a855f7", pausesSla: true, requiresReason: true },
  { code: "WAITING_THIRD_PARTY", name: "Waiting for Third Party", kind: "WAITING", color: "#d946ef", pausesSla: true, requiresReason: true },
  { code: "ON_HOLD", name: "On Hold", kind: "WAITING", color: "#64748b", requiresReason: true },
  { code: "RESOLVED", name: "Resolved", kind: "RESOLVED", color: "#10b981" },
  { code: "CLOSED", name: "Closed", kind: "CLOSED", color: "#334155" },
  { code: "CANCELLED", name: "Cancelled", kind: "CANCELLED", color: "#ef4444" },
];

// [from, to, requiredPermission, requesterAllowed]
const TRANSITIONS: [string, string, string, boolean][] = [
  ["NEW", "ASSIGNED", "ticket.update", false],
  ["NEW", "IN_PROGRESS", "ticket.update", false],
  ["NEW", "WAITING_USER", "ticket.update", false],
  ["NEW", "CANCELLED", "ticket.update", true],
  ["ASSIGNED", "IN_PROGRESS", "ticket.update", false],
  ["ASSIGNED", "WAITING_USER", "ticket.update", false],
  ["ASSIGNED", "WAITING_THIRD_PARTY", "ticket.update", false],
  ["ASSIGNED", "ON_HOLD", "ticket.update", false],
  ["ASSIGNED", "CANCELLED", "ticket.update", true],
  ["IN_PROGRESS", "WAITING_USER", "ticket.update", false],
  ["IN_PROGRESS", "WAITING_THIRD_PARTY", "ticket.update", false],
  ["IN_PROGRESS", "ON_HOLD", "ticket.update", false],
  ["IN_PROGRESS", "RESOLVED", "ticket.update", false],
  ["WAITING_USER", "IN_PROGRESS", "ticket.update", false],
  ["WAITING_USER", "RESOLVED", "ticket.update", false],
  ["WAITING_THIRD_PARTY", "IN_PROGRESS", "ticket.update", false],
  ["WAITING_THIRD_PARTY", "RESOLVED", "ticket.update", false],
  ["ON_HOLD", "IN_PROGRESS", "ticket.update", false],
  ["RESOLVED", "CLOSED", "ticket.update", true],
  ["RESOLVED", "IN_PROGRESS", "ticket.update", true], // reopen (requester within window)
  ["CLOSED", "IN_PROGRESS", "ticket.closed.edit", false], // admin reopen
];

const PRIORITIES = [
  { code: "P1", name: "Critical", level: 1, color: "#dc2626", response: 15, resolution: 4 * 60, bh: false },
  { code: "P2", name: "High", level: 2, color: "#ea580c", response: 30, resolution: 8 * 60, bh: false },
  { code: "P3", name: "Medium", level: 3, color: "#ca8a04", response: 4 * 60, resolution: 3 * 9 * 60, bh: true },
  { code: "P4", name: "Low", level: 4, color: "#16a34a", response: 9 * 60, resolution: 5 * 9 * 60, bh: true },
];

const TEAMS = [
  { code: "IT-SUPPORT", name: "IT Support", type: "INTERNAL", tenant: "A" },
  { code: "INFRA", name: "Infrastructure", type: "INTERNAL", tenant: "A" },
  { code: "ERP", name: "ERP Support", type: "INTERNAL", tenant: "A" },
  { code: "M365", name: "Microsoft 365", type: "INTERNAL", tenant: "A" },
  { code: "RETAIL", name: "Retail Systems", type: "INTERNAL", tenant: "A" },
  { code: "VENDOR-A", name: "Vendor A – Network MSP", type: "VENDOR", tenant: "VA" },
  { code: "VENDOR-B", name: "Vendor B – Payment Terminals", type: "OUTSOURCE", tenant: "VB" },
] as const;

type DemoUser = {
  key: string; name: string; email: string; tenant: string; company?: string; dept?: string; branch?: string;
  roles: RoleCode[]; teams?: [string, "MEMBER" | "LEAD"][]; visibility?: TicketVisibility; title?: string; empId?: string; expiresInDays?: number;
};

const USERS: DemoUser[] = [
  { key: "superadmin", name: "Sam Super", email: "super.admin@contoso.example", tenant: "A", company: "CTR", dept: "IT", branch: "HQ", roles: ["SUPER_ADMIN"], title: "Head of IT", empId: "C0001" },
  { key: "admin", name: "Alex Admin", email: "sys.admin@contoso.example", tenant: "A", company: "CTR", dept: "IT", branch: "HQ", roles: ["SYSTEM_ADMIN"], title: "System Administrator", empId: "C0002" },
  { key: "lead", name: "Lee Lead", email: "lee.lead@contoso.example", tenant: "A", company: "CTR", dept: "IT", branch: "HQ", roles: ["TEAM_LEAD"], teams: [["IT-SUPPORT", "LEAD"]], title: "IT Support Lead", empId: "C0003" },
  { key: "agent", name: "Ana Agent", email: "ana.agent@contoso.example", tenant: "A", company: "CTR", dept: "IT", branch: "HQ", roles: ["SUPPORT_AGENT"], teams: [["IT-SUPPORT", "MEMBER"]], title: "Support Engineer", empId: "C0004" },
  { key: "infra", name: "Ivan Infra", email: "ivan.infra@contoso.example", tenant: "A", company: "CTR", dept: "IT", branch: "HQ", roles: ["TEAM_LEAD"], teams: [["INFRA", "LEAD"]], title: "Infrastructure Lead", empId: "C0005" },
  { key: "erp", name: "Erin ERP", email: "erin.erp@contoso.example", tenant: "A", company: "CTR", dept: "IT", branch: "HQ", roles: ["SUPPORT_AGENT"], teams: [["ERP", "LEAD"], ["M365", "MEMBER"]], title: "ERP Analyst", empId: "C0006" },
  { key: "retail", name: "Rita Retail", email: "rita.retail@contoso.example", tenant: "A", company: "CTR", dept: "IT", branch: "HQ", roles: ["SUPPORT_AGENT"], teams: [["RETAIL", "LEAD"]], title: "Retail Systems Engineer", empId: "C0007" },
  { key: "emp1", name: "Emma Employee", email: "emma@contoso.example", tenant: "A", company: "CTR", dept: "FIN", branch: "BKK01", roles: ["EMPLOYEE"], title: "Accountant", empId: "C1001" },
  { key: "emp2", name: "Ethan Employee", email: "ethan@contoso.example", tenant: "A", company: "CTR", dept: "FIN", branch: "CNX01", roles: ["EMPLOYEE"], visibility: "OWN_DEPT", title: "Finance Manager", empId: "C1002" },
  { key: "store", name: "Somchai Store", email: "somchai@contoso.example", tenant: "A", company: "CTR", dept: "OPS", branch: "BKK01", roles: ["EMPLOYEE"], visibility: "OWN_BRANCH", title: "Store Manager", empId: "C1003" },
  { key: "fab", name: "Fiona Fabrikam", email: "fiona@fabrikam.example", tenant: "B", company: "FAB", dept: "HR", branch: "FHQ", roles: ["EMPLOYEE"], title: "HR Officer", empId: "F2001" },
  { key: "viewer", name: "Mia Manager", email: "mia.manager@contoso.example", tenant: "A", company: "CTR", dept: "MGMT", branch: "HQ", roles: ["DASHBOARD_VIEWER"], title: "COO", empId: "C0100" },
  { key: "vendorA", name: "Victor VendorA", email: "victor@vendor-a.example", tenant: "VA", roles: ["OUTSOURCE_SUPPORT"], teams: [["VENDOR-A", "MEMBER"]], title: "Network Engineer (MSP)", expiresInDays: 180 },
  { key: "vendorB", name: "Vera VendorB", email: "vera@vendor-b.example", tenant: "VB", roles: ["OUTSOURCE_SUPPORT"], teams: [["VENDOR-B", "MEMBER"]], title: "Payment Terminal Tech", expiresInDays: 90 },
];

async function main() {
  console.log("Seeding permissions & roles…");
  // Track permission codes introduced since the last seed: they are granted to system roles per the default
  // matrix below, without touching admin changes made to previously existing codes.
  const existingCodes = new Set((await prisma.permission.findMany({ select: { code: true } })).map((p) => p.code));
  const newCodes = new Set<string>();
  for (const code of ALL_PERMISSIONS) {
    const meta = PERMISSION_META[code];
    if (!existingCodes.has(code)) newCodes.add(code);
    await prisma.permission.upsert({ where: { code }, update: { description: meta.description, group: meta.group }, create: { code, ...meta } });
  }
  const perms = new Map((await prisma.permission.findMany()).map((p) => [p.code, p.id]));
  const roleIds = new Map<string, string>();
  for (const [code, def] of Object.entries(DEFAULT_ROLE_MATRIX)) {
    const role = await prisma.role.upsert({
      where: { code },
      update: {},
      create: { code, name: def.name, description: def.description, isSystem: true,
        defaultTicketVisibility: code === "EMPLOYEE" ? "OWN" : "OWN" },
    });
    roleIds.set(code, role.id);
    const existing = await prisma.rolePermission.count({ where: { roleId: role.id } });
    if (existing === 0) {
      await prisma.rolePermission.createMany({ data: def.permissions.map((p) => ({ roleId: role.id, permissionId: perms.get(p)! })) });
    } else if (existingCodes.size > 0) {
      const added = def.permissions.filter((p) => newCodes.has(p));
      if (added.length) {
        await prisma.rolePermission.createMany({ data: added.map((p) => ({ roleId: role.id, permissionId: perms.get(p)! })), skipDuplicates: true });
        console.log(`  granted new permission(s) ${added.join(", ")} to ${code}`);
      }
    }
  }

  console.log("Seeding organization…");
  const companies = new Map<string, string>();
  for (const c of [{ code: "CTR", name: "Contoso Retail Co., Ltd." }, { code: "FAB", name: "Fabrikam Holdings Co., Ltd." }]) {
    const row = await prisma.company.upsert({ where: { code: c.code }, update: {}, create: c });
    companies.set(c.code, row.id);
  }
  const depts = new Map<string, string>();
  for (const [company, code, name] of [
    ["CTR", "IT", "Information Technology"], ["CTR", "FIN", "Finance"], ["CTR", "OPS", "Store Operations"], ["CTR", "MGMT", "Management"], ["CTR", "HR", "Human Resources"],
    ["FAB", "HR", "Human Resources"], ["FAB", "FIN", "Finance"],
  ] as const) {
    const row = await prisma.department.upsert({
      where: { companyId_code: { companyId: companies.get(company)!, code } }, update: {},
      create: { companyId: companies.get(company)!, code, name },
    });
    depts.set(`${company}:${code}`, row.id);
  }
  const branches = new Map<string, string>();
  const locations = new Map<string, string>();
  for (const [company, code, name, locs] of [
    ["CTR", "HQ", "Head Office", [["HQ-F5", "Floor 5"], ["HQ-F6", "Floor 6"]]],
    ["CTR", "BKK01", "Bangkok – Siam Store", [["BKK01-SF", "Sales Floor"], ["BKK01-BO", "Back Office"]]],
    ["CTR", "CNX01", "Chiang Mai Store", [["CNX01-SF", "Sales Floor"]]],
    ["FAB", "FHQ", "Fabrikam HQ", [["FHQ-F1", "Floor 1"]]],
  ] as const) {
    const b = await prisma.branch.upsert({
      where: { companyId_code: { companyId: companies.get(company)!, code } }, update: {},
      create: { companyId: companies.get(company)!, code, name },
    });
    branches.set(code, b.id);
    for (const [lcode, lname] of locs) {
      const l = await prisma.location.upsert({ where: { branchId_code: { branchId: b.id, code: lcode } }, update: {}, create: { branchId: b.id, code: lcode, name: lname } });
      locations.set(lcode, l.id);
    }
  }

  console.log("Seeding tenants…");
  const tenantIds = new Map<string, string>();
  for (const t of TENANTS) {
    const row = await prisma.tenant.upsert({
      where: { entraTenantId: t.tid },
      update: {},
      create: {
        entraTenantId: t.tid, name: t.name, type: t.type, primaryDomain: t.domain,
        companyId: t.company ? companies.get(t.company) : null,
        autoProvisionUsers: t.type === "INTERNAL",
        defaultRoleId: roleIds.get(t.type === "INTERNAL" ? "EMPLOYEE" : "OUTSOURCE_SUPPORT"),
      },
    });
    tenantIds.set(t.key, row.id);
  }

  console.log("Seeding SLA, priorities, business hours…");
  const workday = [{ start: "08:30", end: "17:30" }];
  const bh = await prisma.businessHours.upsert({
    where: { name: "Standard (Mon–Fri 08:30–17:30)" }, update: {},
    create: { name: "Standard (Mon–Fri 08:30–17:30)", timezone: "Asia/Bangkok", isDefault: true,
      schedule: { "1": workday, "2": workday, "3": workday, "4": workday, "5": workday } },
  });
  for (const [date, name] of [["2026-12-05", "Father's Day"], ["2026-12-10", "Constitution Day"], ["2026-12-31", "New Year's Eve"], ["2027-01-01", "New Year's Day"]]) {
    await prisma.holiday.upsert({ where: { businessHoursId_date: { businessHoursId: bh.id, date: new Date(date) } }, update: {}, create: { businessHoursId: bh.id, date: new Date(date), name } });
  }
  const sla = await prisma.slaProfile.upsert({
    where: { name: "Standard SLA" }, update: {},
    create: { name: "Standard SLA", description: "Default organisation SLA", businessHoursId: bh.id, isDefault: true, warningPercent: 75,
      pauseStatusCodes: ["WAITING_USER", "WAITING_THIRD_PARTY"] },
  });
  const priorityIds = new Map<string, string>();
  for (const p of PRIORITIES) {
    const row = await prisma.priority.upsert({ where: { code: p.code }, update: {}, create: { code: p.code, name: p.name, level: p.level, color: p.color } });
    priorityIds.set(p.code, row.id);
    await prisma.slaTarget.upsert({
      where: { slaProfileId_priorityId: { slaProfileId: sla.id, priorityId: row.id } }, update: {},
      create: { slaProfileId: sla.id, priorityId: row.id, responseMinutes: p.response, resolutionMinutes: p.resolution, businessHoursOnly: p.bh },
    });
  }
  const escCount = await prisma.escalationRule.count({ where: { slaProfileId: sla.id } });
  if (escCount === 0) {
    await prisma.escalationRule.createMany({ data: [
      { slaProfileId: sla.id, clock: "RESOLUTION", atPercent: 75, notifyTeamLead: true },
      { slaProfileId: sla.id, clock: "RESOLUTION", atPercent: 100, notifyTeamLead: true },
    ] });
  }

  console.log("Seeding workflow…");
  const statusIds = new Map<string, string>();
  for (const [i, s] of STATUSES.entries()) {
    const row = await prisma.ticketStatus.upsert({ where: { code: s.code }, update: {}, create: { ...s, order: i * 10 } });
    statusIds.set(s.code, row.id);
  }
  for (const [from, to, perm, requester] of TRANSITIONS) {
    await prisma.workflowTransition.upsert({
      where: { fromStatusId_toStatusId: { fromStatusId: statusIds.get(from)!, toStatusId: statusIds.get(to)! } }, update: {},
      create: { fromStatusId: statusIds.get(from)!, toStatusId: statusIds.get(to)!, requiredPermission: perm, requesterAllowed: requester },
    });
  }

  console.log("Seeding support teams…");
  const teamIds = new Map<string, string>();
  for (const t of TEAMS) {
    const row = await prisma.supportTeam.upsert({
      where: { code: t.code }, update: {},
      create: { code: t.code, name: t.name, type: t.type, tenantId: tenantIds.get(t.tenant), slaProfileId: sla.id,
        companyId: t.tenant === "A" ? companies.get("CTR") : null,
        description: t.type === "INTERNAL" ? `Internal ${t.name} team` : `External team (${t.name})` },
    });
    teamIds.set(t.code, row.id);
  }

  console.log("Seeding categories…");
  for (const [i, main] of CATEGORY_TREE.entries()) {
    const m = await prisma.category.upsert({
      where: { code: main.code }, update: {},
      create: { code: main.code, name: main.name, defaultTeamId: teamIds.get(main.team), sortOrder: i * 10 },
    });
    await prisma.teamCategory.upsert({ where: { teamId_categoryId: { teamId: teamIds.get(main.team)!, categoryId: m.id } }, update: {}, create: { teamId: teamIds.get(main.team)!, categoryId: m.id } });
    for (const [j, [code, name, team]] of main.children.entries()) {
      await prisma.category.upsert({
        where: { code }, update: {},
        create: { code, name, parentId: m.id, defaultTeamId: team ? teamIds.get(team) : null, sortOrder: j * 10,
          requiredFields: code === "RTL-POS" || code === "SYS-POS" ? ["relatedAsset", "contactNumber"] : code.startsWith("HW-") ? ["relatedAsset"] : [],
          defaultPriorityId: code === "RTL-PAY" || code === "RTL-POS" ? priorityIds.get("P2") : null },
      });
    }
  }

  console.log("Seeding users…");
  const userIds = new Map<string, string>();
  for (const u of USERS) {
    const tenantId = tenantIds.get(u.tenant)!;
    const existing = await prisma.user.findFirst({ where: { tenantId, email: u.email } });
    const data = {
      tenantId, email: u.email, displayName: u.name, jobTitle: u.title, employeeId: u.empId,
      companyId: u.company ? companies.get(u.company) : null,
      departmentId: u.company && u.dept ? depts.get(`${u.company}:${u.dept}`) : null,
      branchId: u.branch ? branches.get(u.branch) : null,
      ticketVisibility: u.visibility ?? "OWN",
      accessExpiresAt: u.expiresInDays ? new Date(Date.now() + u.expiresInDays * 86400000) : null,
      contactNumber: "+66 2 000 0000",
    };
    const user = existing ?? (await prisma.user.create({ data }));
    userIds.set(u.key, user.id);
    for (const r of u.roles) {
      await prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: roleIds.get(r)! } }, update: {}, create: { userId: user.id, roleId: roleIds.get(r)! } });
    }
    for (const [team, role] of u.teams ?? []) {
      await prisma.teamMember.upsert({ where: { teamId_userId: { teamId: teamIds.get(team)!, userId: user.id } }, update: {}, create: { teamId: teamIds.get(team)!, userId: user.id, role } });
      if (role === "LEAD") await prisma.supportTeam.update({ where: { id: teamIds.get(team)! }, data: { leadId: user.id } });
    }
  }
  await prisma.user.update({ where: { id: userIds.get("emp1")! }, data: { managerId: userIds.get("emp2") } });

  console.log("Seeding sequences & settings…");
  await prisma.numberSequence.upsert({ where: { key: "TICKET" }, update: {}, create: { key: "TICKET", prefix: "IT", format: "{PREFIX}-{YYYY}-{SEQ:6}", year: new Date().getFullYear() } });
  await prisma.numberSequence.upsert({ where: { key: "TASK" }, update: {}, create: { key: "TASK", prefix: "TSK", format: "{PREFIX}-{YYYY}-{SEQ:6}", year: new Date().getFullYear() } });
  await prisma.numberSequence.upsert({ where: { key: "KB" }, update: {}, create: { key: "KB", prefix: "KB", format: "{PREFIX}-{SEQ:6}", resetYearly: false, year: new Date().getFullYear() } });
  const settings: Record<string, unknown> = {
    "attachments.maxFileSizeMb": 10,
    "attachments.maxFilesPerUpload": 5,
    "attachments.allowedExtensions": ["jpg", "jpeg", "png", "pdf", "docx", "xlsx", "txt", "log"],
    "tickets.reopenWindowDays": 7,
    "tickets.autoCloseResolvedDays": 3,
    "tickets.fallbackTeamCode": "IT-SUPPORT",
    "tickets.requesterCanSetPriority": true,
    "tickets.defaultPriorityCode": "P3",
    "workflow.assignedStatusCode": "ASSIGNED",
  };
  for (const [key, value] of Object.entries(settings)) {
    await prisma.systemSetting.upsert({ where: { key }, update: {}, create: { key, value: value as never } });
  }
  for (const name of ["VIP", "Hardware Failure", "Recurring", "Security"]) {
    await prisma.ticketTag.upsert({ where: { name }, update: {}, create: { name } });
  }

  await seedKnowledgeBase();
  await seedApprovalPolicies();
  await seedThaiNames();

  console.log("✅ Seed complete.");
}

/** Manager approval for hardware, access and new-equipment requests (created only if missing). */
/** Thai display names for the seeded configuration data. Only fills empty nameTh, so admin edits are kept. */
const THAI_NAMES = {
  category: {
    HW: "ฮาร์ดแวร์", "HW-DT": "คอมพิวเตอร์ตั้งโต๊ะ", "HW-MB": "อุปกรณ์มือถือ", "HW-MN": "จอภาพ", "HW-NB": "โน้ตบุ๊ก", "HW-PE": "อุปกรณ์ต่อพ่วง", "HW-PR": "เครื่องพิมพ์",
    M365: "Microsoft 365", "M365-ACC": "บัญชีผู้ใช้", "M365-MAIL": "อีเมล", "M365-PERM": "สิทธิ์การเข้าถึง", "M365-TEAMS": "Microsoft Teams",
    NW: "เครือข่าย", "NW-FW": "ไฟร์วอลล์", "NW-INET": "อินเทอร์เน็ต", "NW-LAN": "แลน (LAN)", "NW-SRV": "เซิร์ฟเวอร์", "NW-VPN": "VPN", "NW-WIFI": "Wi-Fi",
    REQ: "คำขอด้านไอที", "REQ-ACC": "ขอสิทธิ์การเข้าถึง", "REQ-HW": "ขออุปกรณ์ฮาร์ดแวร์", "REQ-NEW": "ขออุปกรณ์ใหม่", "REQ-SW": "ติดตั้งซอฟต์แวร์",
    RTL: "ระบบหน้าร้าน", "RTL-BAR": "เครื่องสแกนบาร์โค้ด", "RTL-CCTV": "กล้องวงจรปิด", "RTL-PAY": "เครื่องรับชำระเงิน", "RTL-POS": "POS",
    SYS: "ระบบงาน", "SYS-ACC": "ระบบบัญชี", "SYS-EC": "อีคอมเมิร์ซ", "SYS-ERP": "ERP", "SYS-HR": "ระบบบุคคล", "SYS-POS": "POS",
  },
  priority: { P1: "วิกฤต", P2: "สูง", P3: "ปานกลาง", P4: "ต่ำ" },
  ticketStatus: {
    NEW: "ใหม่", ASSIGNED: "มอบหมายแล้ว", IN_PROGRESS: "กำลังดำเนินการ", ON_HOLD: "พักไว้", WAITING_USER: "รอผู้แจ้ง",
    WAITING_THIRD_PARTY: "รอบุคคลภายนอก", RESOLVED: "แก้ไขแล้ว", CLOSED: "ปิดแล้ว", CANCELLED: "ยกเลิก",
  },
  supportTeam: {
    "IT-SUPPORT": "ไอทีซัพพอร์ต", INFRA: "โครงสร้างพื้นฐาน", ERP: "ทีม ERP", M365: "ทีม Microsoft 365", RETAIL: "ระบบหน้าร้าน",
    "VENDOR-A": "Vendor A – ผู้ดูแลเครือข่าย", "VENDOR-B": "Vendor B – เครื่องรับชำระเงิน",
  },
  department: { IT: "เทคโนโลยีสารสนเทศ", FIN: "การเงิน", OPS: "ปฏิบัติการสาขา", MGMT: "ผู้บริหาร", HR: "ทรัพยากรบุคคล" },
  branch: { HQ: "สำนักงานใหญ่", BKK01: "กรุงเทพฯ – สาขาสยาม", CNX01: "สาขาเชียงใหม่", FHQ: "สำนักงานใหญ่ Fabrikam" },
  location: { "BKK01-BO": "หลังร้าน", "BKK01-SF": "พื้นที่ขาย", "CNX01-SF": "พื้นที่ขาย", "FHQ-F1": "ชั้น 1", "HQ-F5": "ชั้น 5", "HQ-F6": "ชั้น 6" },
} as const;

async function seedThaiNames() {
  console.log("Seeding Thai names…");
  const models = {
    category: prisma.category, priority: prisma.priority, ticketStatus: prisma.ticketStatus, supportTeam: prisma.supportTeam,
    department: prisma.department, branch: prisma.branch, location: prisma.location,
  } as unknown as Record<keyof typeof THAI_NAMES, { updateMany(a: { where: object; data: object }): Promise<unknown> }>;
  for (const [model, names] of Object.entries(THAI_NAMES) as [keyof typeof THAI_NAMES, Record<string, string>][]) {
    for (const [code, nameTh] of Object.entries(names)) {
      await models[model].updateMany({ where: { code, nameTh: null }, data: { nameTh } });
    }
  }
  await prisma.approvalStep.updateMany({ where: { name: "Line manager approval", nameTh: null }, data: { nameTh: "อนุมัติโดยผู้บังคับบัญชาสายตรง" } });
}

async function seedApprovalPolicies() {
  console.log("Seeding approval policies…");
  const fallback = await prisma.user.findFirst({ where: { email: "sys.admin@contoso.example" } });
  for (const [code, name] of [["REQ-HW", "Hardware request approval"], ["REQ-ACC", "Access request approval"], ["REQ-NEW", "New equipment approval"]] as const) {
    const category = await prisma.category.findUnique({ where: { code } });
    if (!category || (await prisma.approvalPolicy.findUnique({ where: { categoryId: category.id } }))) continue;
    await prisma.approvalPolicy.create({
      data: { name, categoryId: category.id, isActive: true,
        steps: { create: [{ order: 1, name: "Line manager approval", approverType: "REQUESTER_MANAGER", fallbackUserId: fallback?.id ?? null }] } },
    });
  }
}

/** Starter knowledge articles (idempotent by title). Numbers come from the KB sequence. */
async function seedKnowledgeBase() {
  console.log("Seeding knowledge base…");
  const author = await prisma.user.findFirst({ where: { email: "sys.admin@contoso.example" } });
  if (!author) return;
  const cat = async (code: string) => (await prisma.category.findUnique({ where: { code } }))?.id ?? null;
  const articles: { title: string; summary: string; body: string; type: "FAQ" | "TROUBLESHOOTING" | "HOW_TO"; visibility: "EMPLOYEES" | "SUPPORT_ONLY"; status: "DRAFT" | "PUBLISHED"; category: string; tags: string[] }[] = [
    {
      title: "How to connect to the company VPN", summary: "Install the VPN client and sign in with your Microsoft account to work from outside the office.",
      type: "HOW_TO", visibility: "EMPLOYEES", status: "PUBLISHED", category: "NW-VPN", tags: ["vpn", "remote"],
      body: "## Before you start\n\n- You need a company laptop.\n- You need an internet connection.\n\n## Steps\n\n1. Open **Company Portal** and install *Contoso VPN*.\n2. Start the VPN client and choose **Sign in with Microsoft**.\n3. Approve the sign-in in the Authenticator app.\n\n> If the client shows `Error 809`, your home router blocks VPN traffic — try a mobile hotspot.",
    },
    {
      title: "Printer shows Offline", summary: "Quick checks when a shared printer shows as offline on your computer.",
      type: "TROUBLESHOOTING", visibility: "EMPLOYEES", status: "PUBLISHED", category: "HW-PR", tags: ["printer"],
      body: "## Symptoms\n\nThe printer is listed as *Offline* and jobs stay in the queue.\n\n## Solution\n\n1. Check the printer display for paper jams or errors.\n2. On your computer open **Settings › Printers**, select the printer and choose **Use printer online**.\n3. Delete stuck jobs and print again.\n\nIf other people are also affected, create a ticket and mention the printer name on the label.",
    },
    {
      title: "How do I reset my password? (วิธีรีเซ็ตรหัสผ่าน)", summary: "Reset your Microsoft 365 password yourself — รีเซ็ตรหัสผ่านด้วยตัวเอง",
      type: "FAQ", visibility: "EMPLOYEES", status: "PUBLISHED", category: "M365", tags: ["password", "account"],
      body: "Go to [the password reset page](https://passwordreset.microsoftonline.com/) and follow the steps. You need your registered mobile number.\n\nวิธีรีเซ็ตรหัสผ่าน: เปิดหน้ารีเซ็ตรหัสผ่าน แล้วทำตามขั้นตอน",
    },
    {
      title: "POS terminal frozen: safe restart procedure", summary: "Store-side restart sequence for frozen POS terminals (support staff).",
      type: "TROUBLESHOOTING", visibility: "SUPPORT_ONLY", status: "PUBLISHED", category: "RTL-POS", tags: ["pos", "retail"],
      body: "## Steps\n\n1. Ask the cashier to finish or void the open transaction.\n2. Hold the power button for 10 seconds.\n3. After restart, check the payment terminal pairing under **Settings › Devices**.\n\nEscalate to Retail Systems if the terminal does not reconnect within 5 minutes.",
    },
    {
      title: "Guest Wi-Fi access for visitors", summary: "Draft — how reception requests guest Wi-Fi vouchers.",
      type: "HOW_TO", visibility: "EMPLOYEES", status: "DRAFT", category: "NW-WIFI", tags: ["wifi"],
      body: "Reception can request daily guest vouchers through an IT Request ticket. (Draft — process still being agreed.)",
    },
  ];
  for (const a of articles) {
    if (await prisma.kbArticle.findFirst({ where: { title: a.title } })) continue;
    const number = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ prefix: string; current: number }[]>`UPDATE "NumberSequence" SET "current" = "current" + 1, "updatedAt" = NOW() WHERE "key" = 'KB' RETURNING "prefix", "current"`;
      return `${rows[0]!.prefix}-${String(rows[0]!.current).padStart(6, "0")}`;
    });
    await prisma.kbArticle.create({
      data: { number, title: a.title, summary: a.summary, body: a.body, type: a.type, visibility: a.visibility, status: a.status,
        categoryId: await cat(a.category), tags: a.tags, authorId: author.id, publishedAt: a.status === "PUBLISHED" ? new Date() : null },
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
