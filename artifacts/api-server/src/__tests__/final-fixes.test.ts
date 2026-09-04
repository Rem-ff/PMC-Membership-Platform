/**
 * Targeted regression tests for the final-pass fixes:
 *   1. Exactly one DEPARTMENT_LEADER per department, including via
 *      POST /president/members (creating a new member directly as leader).
 *   2. POST /auth/activation/check verifies name AND email, not email alone.
 *   3. `publicProfilesDefaultVisible` actually gates GET /member/:memberId.
 *   4. CreditType.requiresPresidentApproval blocks Department Leaders from
 *      awarding that credit type; only the President can.
 *
 * Same real-Postgres, Clerk-mocked-at-the-module-boundary approach as the
 * other test files in this directory.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";

const clerkUsers = new Map<string, { id: string; primaryEmail: string }>();

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (req: any, _res: any, next: any) => next(),
  getAuth: (req: any) => {
    const userId = req.headers["x-test-clerk-user-id"];
    return userId ? { userId } : { userId: null };
  },
  clerkClient: {
    users: {
      getUser: async (id: string) => {
        const u = clerkUsers.get(id);
        return {
          id,
          primaryEmailAddressId: "email_1",
          emailAddresses: [
            { id: "email_1", emailAddress: u?.primaryEmail ?? "unknown@example.com", verification: { status: "verified" } },
          ],
        };
      },
    },
  },
}));

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const { db, membersTable, departmentsTable, creditTypesTable, levelsTable, auditLogsTable, creditTransactionsTable, achievementsTable, settingsTable } =
  await import("@workspace/db");
const { default: app } = await import("../app");
const { eq, and } = await import("drizzle-orm");

function api(clerkUserId: string) {
  return {
    get: (path: string) => request(app).get(path).set("x-test-clerk-user-id", clerkUserId),
    post: (path: string) => request(app).post(path).set("x-test-clerk-user-id", clerkUserId),
    patch: (path: string) => request(app).patch(path).set("x-test-clerk-user-id", clerkUserId),
  };
}

let eventsDept: { id: number };
let mgmtDept: { id: number };
let president: { id: number; memberId: string };
let leaderX: { id: number; memberId: string };
let plainMember: { id: number; memberId: string };
let normalCreditType: { id: number };
let approvalCreditType: { id: number };

beforeAll(async () => {
  await db.delete(auditLogsTable);
  await db.delete(achievementsTable);
  await db.delete(creditTransactionsTable);
  await db.delete(membersTable);
  await db.delete(creditTypesTable);
  await db.delete(levelsTable);
  await db.delete(departmentsTable);
  await db.delete(settingsTable);

  clerkUsers.set("clerk_ff_president", { id: "clerk_ff_president", primaryEmail: "ff-president@pmc.test" });
  clerkUsers.set("clerk_ff_leaderx", { id: "clerk_ff_leaderx", primaryEmail: "ff-leaderx@pmc.test" });
  clerkUsers.set("clerk_ff_member", { id: "clerk_ff_member", primaryEmail: "ff-member@pmc.test" });

  [eventsDept] = await db.insert(departmentsTable).values({ nameAr: "الفعاليات", nameEn: "Events" }).returning();
  [mgmtDept] = await db.insert(departmentsTable).values({ nameAr: "الإدارة", nameEn: "Management" }).returning();

  [normalCreditType] = await db
    .insert(creditTypesTable)
    .values({ nameAr: "مشاركة في مشروع", nameEn: "Project Participation", creditValue: 15, requiresPresidentApproval: false })
    .returning();
  [approvalCreditType] = await db
    .insert(creditTypesTable)
    .values({ nameAr: "مساهمة استثنائية", nameEn: "Exceptional Contribution", creditValue: 10, requiresPresidentApproval: true })
    .returning();

  await db.insert(levelsTable).values({ key: "INITIATE", nameAr: "ابدأ", nameEn: "Initiate", symbol: "○", minCredits: 0 });
  await db.insert(settingsTable).values({ membershipYear: "2026-27", publicProfilesDefaultVisible: true });

  [president] = await db
    .insert(membersTable)
    .values({ memberId: "PMC-FF0001", fullName: "Remas Alzahrani", email: "ff-president@pmc.test", role: "PRESIDENT", membershipStatus: "APPROVED", departmentId: mgmtDept.id, clerkUserId: "clerk_ff_president" })
    .returning();
  [leaderX] = await db
    .insert(membersTable)
    .values({ memberId: "PMC-FF0002", fullName: "قائد الفعاليات الأول", email: "ff-leaderx@pmc.test", role: "DEPARTMENT_LEADER", membershipStatus: "APPROVED", departmentId: eventsDept.id, clerkUserId: "clerk_ff_leaderx" })
    .returning();
  [plainMember] = await db
    .insert(membersTable)
    .values({ memberId: "PMC-FF0003", fullName: "سارة عضو الفعاليات", email: "ff-member@pmc.test", role: "MEMBER", membershipStatus: "APPROVED", departmentId: eventsDept.id, clerkUserId: "clerk_ff_member" })
    .returning();
});

const asPresident = () => api("clerk_ff_president");
const asLeader = () => api("clerk_ff_leaderx");

describe("Issue 1 - exactly one DEPARTMENT_LEADER per department via POST /president/members", () => {
  let newLeaderMemberId: string;

  it("A. creating a new leader in a department that already has one cannot leave two leaders", async () => {
    const res = await asPresident().post("/api/president/members").send({
      fullName: "قائد جديد للفعاليات",
      email: "ff-new-leader@pmc.test",
      universityId: "441000777",
      college: "Business",
      major: "Management",
      departmentId: eventsDept.id,
      role: "DEPARTMENT_LEADER",
      membershipStatus: "APPROVED",
    });
    expect(res.status).toBe(201);
    newLeaderMemberId = res.body.memberId;
  });

  it("B. the final department state contains exactly one leader", async () => {
    const leaders = await db
      .select()
      .from(membersTable)
      .where(and(eq(membersTable.departmentId, eventsDept.id), eq(membersTable.role, "DEPARTMENT_LEADER")));
    expect(leaders.length).toBe(1);
    expect(leaders[0].memberId).toBe(newLeaderMemberId);
  });

  it("C. the old leader's role state is correctly demoted to MEMBER", async () => {
    const [oldLeader] = await db.select().from(membersTable).where(eq(membersTable.memberId, leaderX.memberId));
    expect(oldLeader.role).toBe("MEMBER");
  });

  it("D. the demotion and creation both appear correctly in audit logs", async () => {
    const res = await asPresident().get("/api/president/audit-logs");
    expect(res.status).toBe(200);
    const demotion = res.body.find((l: any) => l.action === "leader_demoted" && l.target === leaderX.memberId);
    expect(demotion).toBeTruthy();
    const creation = res.body.find((l: any) => l.action === "member_created" && l.target === newLeaderMemberId);
    expect(creation).toBeTruthy();
    expect(creation.metadata.replacedLeader).toBe(leaderX.memberId);
  });

  it("also cannot leave two leaders when promoting a second existing member via PATCH", async () => {
    // newLeaderMemberId is now the department's leader; promote plainMember
    // (a different existing member of the same department) too.
    const res = await asPresident().patch(`/api/president/members/${plainMember.memberId}`).send({ role: "DEPARTMENT_LEADER" });
    expect(res.status).toBe(200);

    const leaders = await db
      .select()
      .from(membersTable)
      .where(and(eq(membersTable.departmentId, eventsDept.id), eq(membersTable.role, "DEPARTMENT_LEADER")));
    expect(leaders.length).toBe(1);
    expect(leaders[0].memberId).toBe(plainMember.memberId);

    // restore fixture state for later describe blocks in this file
    await asPresident().patch(`/api/president/departments/${eventsDept.id}`).send({ leaderMemberId: leaderX.memberId });
  });
});

describe("Issue 2 - activation check verifies name AND email", () => {
  it("A. correct name + correct approved email -> eligible", async () => {
    const res = await request(app).post("/api/auth/activation/check").send({ fullName: "سارة عضو الفعاليات", email: "ff-member@pmc.test" });
    expect(res.status).toBe(200);
    expect(res.body.eligible).toBe(true);
    expect(res.body.status).toBe("APPROVED");
    expect(res.body.memberId).toBe(plainMember.memberId);
  });

  it("B. wrong name + correct email -> generic not-found, no leak", async () => {
    const res = await request(app).post("/api/auth/activation/check").send({ fullName: "اسم خاطئ تماما", email: "ff-member@pmc.test" });
    expect(res.status).toBe(200);
    expect(res.body.eligible).toBe(false);
    expect(res.body.status).toBe("NOT_FOUND");
    expect(res.body.memberId).toBeNull();
  });

  it("C. correct name + wrong email -> generic not-found", async () => {
    const res = await request(app).post("/api/auth/activation/check").send({ fullName: "سارة عضو الفعاليات", email: "totally-different@pmc.test" });
    expect(res.status).toBe(200);
    expect(res.body.eligible).toBe(false);
    expect(res.body.status).toBe("NOT_FOUND");
  });

  it("D. harmless whitespace/case differences still succeed", async () => {
    const res = await request(app).post("/api/auth/activation/check").send({ fullName: "  سارة   عضو   الفعاليات  ", email: "  FF-Member@PMC.test  ".trim() });
    expect(res.status).toBe(200);
    expect(res.body.eligible).toBe(true);
  });
});

describe("Issue 3 - publicProfilesDefaultVisible actually gates the public profile", () => {
  it("A. enabled -> profile accessible", async () => {
    const res = await request(app).get(`/api/member/${plainMember.memberId}`);
    expect(res.status).toBe(200);
    expect(res.body.memberId).toBe(plainMember.memberId);
  });

  it("B. disabled -> profile inaccessible (404, no distinguishing info)", async () => {
    const patchRes = await asPresident().patch("/api/president/settings").send({ publicProfilesDefaultVisible: false });
    expect(patchRes.status).toBe(200);

    const res = await request(app).get(`/api/member/${plainMember.memberId}`);
    expect(res.status).toBe(404);
    expect(res.body.name).toBeUndefined();
    expect(res.body.credits).toBeUndefined();
  });

  it("C. turning it back on restores access", async () => {
    const patchRes = await asPresident().patch("/api/president/settings").send({ publicProfilesDefaultVisible: true });
    expect(patchRes.status).toBe(200);

    const res = await request(app).get(`/api/member/${plainMember.memberId}`);
    expect(res.status).toBe(200);
    expect(res.body.memberId).toBe(plainMember.memberId);
  });
});

describe("Issue 4 - credit types requiring President approval", () => {
  it("A. leader can award a normal credit type to a regular member in their own department", async () => {
    const res = await asLeader().post("/api/leader/credits").send({
      memberId: plainMember.memberId,
      creditTypeId: normalCreditType.id,
      activityName: "Test Normal Credit",
      activityDate: "2026-08-28",
    });
    expect(res.status).toBe(201);
  });

  it("B. leader cannot award a President-approval-required credit type", async () => {
    const res = await asLeader().post("/api/leader/credits").send({
      memberId: plainMember.memberId,
      creditTypeId: approvalCreditType.id,
      activityName: "Test Approval Credit",
      activityDate: "2026-08-28",
    });
    expect(res.status).toBe(403);
  });

  it("C. President can award the President-approval-required credit type", async () => {
    const res = await asPresident().post("/api/president/credits").send({
      memberId: plainMember.memberId,
      creditTypeId: approvalCreditType.id,
      activityName: "Test Approval Credit By President",
      activityDate: "2026-08-28",
    });
    expect(res.status).toBe(201);
    expect(res.body.creditValue).toBe(10);
  });
});
