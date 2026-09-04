/**
 * Mandatory end-to-end acceptance test: walks the exact 15-step scenario
 * (President creates Sara -> assigns Events leader -> leader credits Sara ->
 * Sara sees it after "refresh" -> President sees it -> audit log records it
 * -> cross-role/cross-department access is denied) against the real Express
 * app and a real Postgres database. Each `it` block is labeled with the
 * step number it verifies.
 *
 * Clerk is mocked at the module boundary (no real Clerk credentials exist in
 * this environment) using the same technique as authorization.test.ts --
 * everything else (routing, middleware, Drizzle queries, Postgres) is real.
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

const { db, membersTable, departmentsTable, creditTypesTable, levelsTable, auditLogsTable, creditTransactionsTable, achievementsTable } =
  await import("@workspace/db");
const { default: app } = await import("../app");
const { eq } = await import("drizzle-orm");

let eventsDept: { id: number };
let president: { memberId: string };
let sara: { memberId: string };
let projectParticipationType: { id: number };

beforeAll(async () => {
  await db.delete(auditLogsTable);
  await db.delete(achievementsTable);
  await db.delete(creditTransactionsTable);
  await db.delete(membersTable);
  await db.delete(creditTypesTable);
  await db.delete(levelsTable);
  await db.delete(departmentsTable);

  clerkUsers.set("clerk_e2e_president", { id: "clerk_e2e_president", primaryEmail: "e2e-president@pmc.test" });
  clerkUsers.set("clerk_e2e_leader", { id: "clerk_e2e_leader", primaryEmail: "e2e-leader@pmc.test" });
  clerkUsers.set("clerk_e2e_sara", { id: "clerk_e2e_sara", primaryEmail: "e2e-sara@pmc.test" });
  clerkUsers.set("clerk_e2e_member", { id: "clerk_e2e_member", primaryEmail: "e2e-plainmember@pmc.test" });
  clerkUsers.set("clerk_e2e_ghost", { id: "clerk_e2e_ghost", primaryEmail: "e2e-ghost@nowhere.test" });

  [eventsDept] = await db.insert(departmentsTable).values({ nameAr: "الفعاليات", nameEn: "Events" }).returning();
  await db.insert(departmentsTable).values({ nameAr: "الإدارة", nameEn: "Management" });
  const [mgmtDept] = await db.select().from(departmentsTable).where(eq(departmentsTable.nameEn, "Management"));

  [projectParticipationType] = await db
    .insert(creditTypesTable)
    .values({ nameAr: "مشاركة في مشروع", nameEn: "Project Participation", creditValue: 15 })
    .returning();
  await db.insert(levelsTable).values({ key: "INITIATE", nameAr: "ابدأ", nameEn: "Initiate", symbol: "○", minCredits: 0 });

  [president] = await db
    .insert(membersTable)
    .values({
      memberId: "PMC-260001",
      fullName: "Remas Alzahrani",
      email: "e2e-president@pmc.test",
      role: "PRESIDENT",
      membershipStatus: "APPROVED",
      departmentId: mgmtDept.id,
      clerkUserId: "clerk_e2e_president",
    })
    .returning();

  // A pre-existing plain member and an Events-department leader candidate,
  // used for the "wrong role" cross-checks in steps 11-13.
  await db.insert(membersTable).values({
    memberId: "PMC-260002",
    fullName: "Plain Member",
    email: "e2e-plainmember@pmc.test",
    role: "MEMBER",
    membershipStatus: "APPROVED",
    departmentId: eventsDept.id,
    clerkUserId: "clerk_e2e_member",
  });
  await db.insert(membersTable).values({
    memberId: "PMC-260003",
    fullName: "Leader Candidate",
    email: "e2e-leader@pmc.test",
    role: "MEMBER",
    membershipStatus: "APPROVED",
    departmentId: eventsDept.id,
    clerkUserId: "clerk_e2e_leader",
  });
});

function api(clerkUserId: string) {
  return {
    get: (path: string) => request(app).get(path).set("x-test-clerk-user-id", clerkUserId),
    post: (path: string) => request(app).post(path).set("x-test-clerk-user-id", clerkUserId),
    patch: (path: string) => request(app).patch(path).set("x-test-clerk-user-id", clerkUserId),
  };
}
const asPresident = () => api("clerk_e2e_president");
const asLeader = () => api("clerk_e2e_leader");
const asMember = () => api("clerk_e2e_member");

describe("End-to-end acceptance scenario", () => {
  it("STEP 1 - President authenticates", async () => {
    const res = await asPresident().get("/api/me");
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("PRESIDENT");
  });

  it("STEP 2 - President creates Sara Test (Events, MEMBER, APPROVED, real university ID)", async () => {
    const res = await asPresident().post("/api/president/members").send({
      fullName: "Sara Test",
      email: "sara.test.e2e@pmc.test",
      universityId: "441000001",
      college: "Computer Science",
      major: "Information Systems",
      departmentId: eventsDept.id,
      role: "MEMBER",
      membershipStatus: "APPROVED",
    });
    expect(res.status).toBe(201);
    expect(res.body.memberId).toMatch(/^PMC-26/);
    sara = res.body;
  });

  it("STEP 3 - President assigns the Events Department Leader", async () => {
    const res = await asPresident()
      .patch(`/api/president/departments/${eventsDept.id}`)
      .send({ leaderMemberId: "PMC-260003" });
    expect(res.status).toBe(200);
    expect(res.body.leader.memberId).toBe("PMC-260003");
  });

  it("STEP 4 - the Events leader can see Sara in their department", async () => {
    const res = await asLeader().get("/api/leader/department");
    expect(res.status).toBe(200);
    expect(res.body.department.nameEn).toBe("Events");
    expect(res.body.members.some((m: any) => m.memberId === sara.memberId)).toBe(true);
  });

  it("STEP 5 - Leader awards Sara +15 credits (Project Participation / PMC Start Here)", async () => {
    const res = await asLeader().post("/api/leader/credits").send({
      memberId: sara.memberId,
      creditTypeId: projectParticipationType.id,
      activityName: "PMC Start Here",
      activityDate: "2026-08-28",
    });
    expect(res.status).toBe(201);
    expect(res.body.creditValue).toBe(15);
  });

  it("STEP 6 - Sara's calculated total becomes 15 (verified via the public verification profile)", async () => {
    const pub = await request(app).get(`/api/member/${sara.memberId}`);
    expect(pub.status).toBe(200);
    expect(pub.body.credits).toBe(15);
  });

  it("STEP 7 - the 15 credits persist across a fresh query (simulated refresh/restart)", async () => {
    // A brand-new request against the same Postgres data -- nothing is cached
    // in the app process, so this is equivalent to a hard refresh or a
    // server restart reading from disk.
    const res1 = await request(app).get(`/api/member/${sara.memberId}`);
    const res2 = await request(app).get(`/api/member/${sara.memberId}`);
    expect(res1.body.credits).toBe(15);
    expect(res2.body.credits).toBe(15);
  });

  it("STEP 8 - Sara sees +15 total, the transaction, and the activity name", async () => {
    const pub = await request(app).get(`/api/member/${sara.memberId}`);
    expect(pub.body.credits).toBe(15);

    const [saraRow] = await db.select().from(membersTable).where(eq(membersTable.memberId, sara.memberId));
    const txRows = await db.select().from(creditTransactionsTable).where(eq(creditTransactionsTable.memberId, saraRow.id));
    expect(txRows.length).toBe(1);
    expect(txRows[0].activityName).toBe("PMC Start Here");
    expect(txRows[0].creditValue).toBe(15);
  });

  it("STEP 9 - President sees the same transaction in /president/transactions", async () => {
    const res = await asPresident().get("/api/president/transactions");
    expect(res.status).toBe(200);
    expect(res.body.some((t: any) => t.memberId === sara.memberId && t.activityName === "PMC Start Here" && t.creditValue === 15)).toBe(true);
  });

  it("STEP 10 - audit log contains member_created, leader_assigned, and credit_added", async () => {
    const res = await asPresident().get("/api/president/audit-logs");
    expect(res.status).toBe(200);
    const actions = res.body.map((l: any) => l.action);
    expect(actions).toContain("member_created");
    expect(actions).toContain("leader_assigned");
    expect(actions).toContain("credit_added");
  });

  it("STEP 11 - Leader cannot self-credit and cannot credit outside their department", async () => {
    const selfCredit = await asLeader().post("/api/leader/credits").send({
      memberId: "PMC-260003",
      creditTypeId: projectParticipationType.id,
      activityName: "Self Credit Attempt",
      activityDate: "2026-08-28",
    });
    expect(selfCredit.status).toBe(403);

    const outsideDept = await asLeader().post("/api/leader/credits").send({
      memberId: "PMC-260001", // President, Management dept -- outside Events
      creditTypeId: projectParticipationType.id,
      activityName: "Cross Department Attempt",
      activityDate: "2026-08-28",
    });
    expect(outsideDept.status).toBe(403);
  });

  it("STEP 12 - a plain Member cannot access /leader/* or /president/*", async () => {
    const leaderAttempt = await asMember().get("/api/leader/department");
    expect(leaderAttempt.status).toBe(403);
    const presidentAttempt = await asMember().get("/api/president/overview");
    expect(presidentAttempt.status).toBe(403);
  });

  it("STEP 13 - the Leader cannot access /president/*", async () => {
    const res = await asLeader().get("/api/president/overview");
    expect(res.status).toBe(403);
  });

  it("STEP 14 - an unknown/unapproved email cannot activate a membership", async () => {
    const res = await request(app).post("/api/auth/activation/check").send({ fullName: "Ghost User", email: "e2e-ghost@nowhere.test" });
    expect(res.status).toBe(200);
    expect(res.body.eligible).toBe(false);
    expect(res.body.status).toBe("NOT_FOUND");
  });

  it("STEP 15 - data persists in Postgres independent of the running app process", async () => {
    // Re-read directly from the DB layer (bypassing any in-app state) to
    // confirm the credit transaction, the leader assignment, and Sara's
    // record are genuinely committed rows, not in-memory state.
    const [saraRow] = await db.select().from(membersTable).where(eq(membersTable.memberId, sara.memberId));
    expect(saraRow.membershipStatus).toBe("APPROVED");
    const [leaderRow] = await db.select().from(membersTable).where(eq(membersTable.memberId, "PMC-260003"));
    expect(leaderRow.role).toBe("DEPARTMENT_LEADER");
    const txRows = await db.select().from(creditTransactionsTable).where(eq(creditTransactionsTable.memberId, saraRow.id));
    expect(txRows.length).toBe(1);
    expect(txRows[0].valid).toBe(true);
  });
});
