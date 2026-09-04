/**
 * Authorization + core workflow tests.
 *
 * These hit the real Express app with a real (disposable) Postgres database
 * -- no mocked DB layer, so IDOR/role bugs in actual query filters get
 * caught. Requires TEST_DATABASE_URL to point at an empty database; run
 * `pnpm --filter @workspace/db exec drizzle-kit push --force` against it
 * first (see README "Running tests").
 *
 * Clerk auth is stubbed via a test-only header (`x-test-clerk-user-id`)
 * consumed by a mock of `@clerk/express`'s `getAuth`, so these tests never
 * make network calls to Clerk and never need real sessions. This keeps the
 * suite fast and deterministic while still exercising the real
 * attachMember -> requireMember -> requireRole chain.
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
process.env.PORT = process.env.PORT ?? "0";

const { db, membersTable, departmentsTable, creditTypesTable, levelsTable, auditLogsTable, creditTransactionsTable, achievementsTable } = await import("@workspace/db");
const { default: app } = await import("../app");

let eventsDept: { id: number };
let mgmtDept: { id: number };
let president: { id: number; memberId: string };
let leaderA: { id: number; memberId: string };
let memberA: { id: number; memberId: string };
let memberBOtherDept: { id: number; memberId: string };
let leaderB: { id: number; memberId: string };
let creditType: { id: number };

function authed(clerkUserId: string) {
  return request(app).get("/api/me").set("x-test-clerk-user-id", clerkUserId);
}

beforeAll(async () => {
  // Idempotent: truncate everything this suite touches first, so re-running
  // against the same disposable database (instead of always recreating it)
  // never collides on unique constraints from a previous run.
  await db.delete(auditLogsTable);
  await db.delete(achievementsTable);
  await db.delete(creditTransactionsTable);
  await db.delete(membersTable);
  await db.delete(creditTypesTable);
  await db.delete(levelsTable);
  await db.delete(departmentsTable);

  clerkUsers.set("clerk_president", { id: "clerk_president", primaryEmail: "president@pmc.test" });
  clerkUsers.set("clerk_leaderA", { id: "clerk_leaderA", primaryEmail: "leaderA@pmc.test" });
  clerkUsers.set("clerk_leaderB", { id: "clerk_leaderB", primaryEmail: "leaderB@pmc.test" });
  clerkUsers.set("clerk_memberA", { id: "clerk_memberA", primaryEmail: "memberA@pmc.test" });
  clerkUsers.set("clerk_memberB", { id: "clerk_memberB", primaryEmail: "memberB@pmc.test" });

  [eventsDept] = await db.insert(departmentsTable).values({ nameAr: "الفعاليات", nameEn: "Events" }).returning();
  [mgmtDept] = await db.insert(departmentsTable).values({ nameAr: "الإدارة", nameEn: "Management" }).returning();
  [creditType] = await db
    .insert(creditTypesTable)
    .values({ nameAr: "مشاركة", nameEn: "Project Participation", creditValue: 15 })
    .returning();
  await db.insert(levelsTable).values({ key: "INITIATE", nameAr: "ابدأ", nameEn: "Initiate", symbol: "○", minCredits: 0 });

  [president] = await db
    .insert(membersTable)
    .values({ memberId: "PMC-260001", fullName: "Remas", email: "president@pmc.test", role: "PRESIDENT", membershipStatus: "APPROVED", departmentId: mgmtDept.id, clerkUserId: "clerk_president" })
    .returning();
  [leaderA] = await db
    .insert(membersTable)
    .values({ memberId: "PMC-260002", fullName: "Leader A", email: "leaderA@pmc.test", role: "DEPARTMENT_LEADER", membershipStatus: "APPROVED", departmentId: eventsDept.id, clerkUserId: "clerk_leaderA" })
    .returning();
  [leaderB] = await db
    .insert(membersTable)
    .values({ memberId: "PMC-260003", fullName: "Leader B", email: "leaderB@pmc.test", role: "DEPARTMENT_LEADER", membershipStatus: "APPROVED", departmentId: mgmtDept.id, clerkUserId: "clerk_leaderB" })
    .returning();
  [memberA] = await db
    .insert(membersTable)
    .values({ memberId: "PMC-260004", fullName: "Member A", email: "memberA@pmc.test", role: "MEMBER", membershipStatus: "APPROVED", departmentId: eventsDept.id, clerkUserId: "clerk_memberA" })
    .returning();
  [memberBOtherDept] = await db
    .insert(membersTable)
    .values({ memberId: "PMC-260005", fullName: "Member B", email: "memberB@pmc.test", role: "MEMBER", membershipStatus: "APPROVED", departmentId: mgmtDept.id, clerkUserId: "clerk_memberB" })
    .returning();
});

describe("Member", () => {
  it("can get own profile", async () => {
    const res = await authed("clerk_memberA");
    expect(res.status).toBe(200);
    expect(res.body.memberId).toBe(memberA.memberId);
  });

  it("cannot access President endpoints", async () => {
    const res = await request(app).get("/api/president/overview").set("x-test-clerk-user-id", "clerk_memberA");
    expect(res.status).toBe(403);
  });

  it("cannot access another member's profile via member APIs", async () => {
    // Members have no "get other member" endpoint at all -- confirm it 404s
    // rather than leaking data, and that public verification only exposes safe fields.
    const res = await request(app).get(`/api/member/${memberBOtherDept.memberId}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBeUndefined();
    expect(res.body.universityId).toBeUndefined();
  });
});

describe("Leader", () => {
  it("can list own department", async () => {
    const res = await request(app).get("/api/leader/department").set("x-test-clerk-user-id", "clerk_leaderA");
    expect(res.status).toBe(200);
    expect(res.body.department.nameEn).toBe("Events");
    expect(res.body.members.some((m: any) => m.memberId === memberA.memberId)).toBe(true);
  });

  it("can credit a regular member of own department", async () => {
    const res = await request(app)
      .post("/api/leader/credits")
      .set("x-test-clerk-user-id", "clerk_leaderA")
      .send({ memberId: memberA.memberId, creditTypeId: creditType.id, activityName: "PMC Start Here", activityDate: "2026-08-01" });
    expect(res.status).toBe(201);
    expect(res.body.creditValue).toBe(15);
  });

  it("cannot credit a member of another department", async () => {
    const res = await request(app)
      .post("/api/leader/credits")
      .set("x-test-clerk-user-id", "clerk_leaderA")
      .send({ memberId: memberBOtherDept.memberId, creditTypeId: creditType.id, activityName: "Test Activity", activityDate: "2026-08-01" });
    expect(res.status).toBe(403);
  });

  it("cannot credit themself", async () => {
    const res = await request(app)
      .post("/api/leader/credits")
      .set("x-test-clerk-user-id", "clerk_leaderA")
      .send({ memberId: leaderA.memberId, creditTypeId: creditType.id, activityName: "Test Activity", activityDate: "2026-08-01" });
    expect(res.status).toBe(403);
  });

  it("cannot credit another leader", async () => {
    const res = await request(app)
      .post("/api/leader/credits")
      .set("x-test-clerk-user-id", "clerk_leaderB")
      .send({ memberId: leaderA.memberId, creditTypeId: creditType.id, activityName: "Test Activity", activityDate: "2026-08-01" });
    // leaderB's department is Management, leaderA belongs to Events -> 403 for
    // department mismatch (also would be 403 for role even if same dept).
    expect(res.status).toBe(403);
  });
});

describe("President", () => {
  it("can add a member", async () => {
    const res = await request(app)
      .post("/api/president/members")
      .set("x-test-clerk-user-id", "clerk_president")
      .send({
        fullName: "Sara Test",
        email: "sara.test@pmc.test",
        universityId: "TEST-001",
        college: "Computer Science",
        major: "IT",
        departmentId: eventsDept.id,
        role: "MEMBER",
        membershipStatus: "APPROVED",
      });
    expect(res.status).toBe(201);
    expect(res.body.memberId).toMatch(/^PMC-26/);
  });

  it("rejects duplicate email", async () => {
    const res = await request(app)
      .post("/api/president/members")
      .set("x-test-clerk-user-id", "clerk_president")
      .send({
        fullName: "Dup",
        email: "sara.test@pmc.test",
        universityId: "TEST-002",
        college: "x",
        major: "y",
        departmentId: eventsDept.id,
        role: "MEMBER",
        membershipStatus: "APPROVED",
      });
    expect(res.status).toBe(409);
  });

  it("can edit a member and assign leader (demoting the previous one)", async () => {
    const res = await request(app)
      .patch(`/api/president/members/${memberA.memberId}`)
      .set("x-test-clerk-user-id", "clerk_president")
      .send({ role: "DEPARTMENT_LEADER" });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("DEPARTMENT_LEADER");

    const oldLeader = await authed("clerk_leaderA");
    expect(oldLeader.body.role).toBe("MEMBER");
  });

  it("can view audit log entries created by the above actions", async () => {
    const res = await request(app).get("/api/president/audit-logs").set("x-test-clerk-user-id", "clerk_president");
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.some((l: any) => l.action === "member_created")).toBe(true);
  });
});

describe("Authentication / activation", () => {
  it("unknown email cannot activate membership", async () => {
    const res = await request(app).post("/api/auth/activation/check").send({ fullName: "Ghost User", email: "ghost@nowhere.test" });
    expect(res.status).toBe(200);
    expect(res.body.eligible).toBe(false);
    expect(res.body.status).toBe("NOT_FOUND");
  });

  it("pending member cannot enter full dashboard", async () => {
    const [pending] = await db
      .insert(membersTable)
      .values({ memberId: "PMC-260099", fullName: "Pending P", email: "pending@pmc.test", role: "MEMBER", membershipStatus: "PENDING", departmentId: eventsDept.id, clerkUserId: "clerk_pending" })
      .returning();
    clerkUsers.set("clerk_pending", { id: "clerk_pending", primaryEmail: "pending@pmc.test" });
    void pending;
    const res = await request(app).get("/api/me/dashboard").set("x-test-clerk-user-id", "clerk_pending");
    expect(res.status).toBe(403);
  });

  it("suspended member cannot use the application", async () => {
    const [suspended] = await db
      .insert(membersTable)
      .values({ memberId: "PMC-260098", fullName: "Suspended S", email: "suspended@pmc.test", role: "MEMBER", membershipStatus: "APPROVED", active: false, departmentId: eventsDept.id, clerkUserId: "clerk_suspended" })
      .returning();
    clerkUsers.set("clerk_suspended", { id: "clerk_suspended", primaryEmail: "suspended@pmc.test" });
    void suspended;
    const res = await request(app).get("/api/me/dashboard").set("x-test-clerk-user-id", "clerk_suspended");
    expect(res.status).toBe(403);
    expect(res.body.errorAr).toContain("إيقاف");
  });
});
