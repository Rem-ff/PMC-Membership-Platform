import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import {
  db,
  departmentsTable,
  creditTransactionsTable,
  creditTypesTable,
  achievementsTable,
  membersTable,
  settingsTable,
} from "@workspace/db";
import type { AuthedRequest } from "../middlewares/requireAuth";
import { requireMember } from "../middlewares/requireAuth";
import { getTotalCredits, getAllLevels } from "../lib/queries";
import { toCurrentUser, toTransactionDTO, toAchievementDTO } from "../lib/serialize";
import { computeLevel } from "../lib/levels";
import { categorizeActivity } from "../lib/categorize";

const router: IRouter = Router();
router.use(requireMember);

router.get("/", async (req: AuthedRequest, res, next) => {
  try {
    const member = req.member!;
    const [department, totalCredits, levels] = await Promise.all([
      member.departmentId
        ? db.select().from(departmentsTable).where(eq(departmentsTable.id, member.departmentId)).then((r) => r[0])
        : Promise.resolve(null),
      getTotalCredits(member.id),
      getAllLevels(),
    ]);
    return res.json(toCurrentUser(member, department, totalCredits, levels));
  } catch (err) {
    return next(err);
  }
});

router.get("/dashboard", async (req: AuthedRequest, res, next) => {
  try {
    const member = req.member!;
    const [department, totalCredits, levels] = await Promise.all([
      member.departmentId
        ? db.select().from(departmentsTable).where(eq(departmentsTable.id, member.departmentId)).then((r) => r[0])
        : Promise.resolve(null),
      getTotalCredits(member.id),
      getAllLevels(),
    ]);

    const txRows = await db
      .select()
      .from(creditTransactionsTable)
      .innerJoin(creditTypesTable, eq(creditTransactionsTable.creditTypeId, creditTypesTable.id))
      .innerJoin(membersTable, eq(creditTransactionsTable.addedByUserId, membersTable.id))
      .where(and(eq(creditTransactionsTable.memberId, member.id), eq(creditTransactionsTable.valid, true)))
      .orderBy(desc(creditTransactionsTable.createdAt))
      .limit(5);

    const recentCredits = txRows.map((r) =>
      toTransactionDTO(r.pmc_credit_transactions, r.pmc_credit_types, member, r.pmc_members, null),
    );

    const achRows = await db
      .select()
      .from(achievementsTable)
      .innerJoin(membersTable, eq(achievementsTable.approvedByUserId, membersTable.id))
      .where(eq(achievementsTable.memberId, member.id))
      .orderBy(desc(achievementsTable.achievementDate))
      .limit(5);

    const recentAchievements = achRows.map((r) => toAchievementDTO(r.pmc_achievements, member, r.pmc_members));

    const allAchievements = await db.select().from(achievementsTable).where(eq(achievementsTable.memberId, member.id));
    const stats = {
      projects: allAchievements.filter((a) => a.type === "PROJECT").length,
      challenges: allAchievements.filter((a) => a.type === "CHALLENGE").length,
      leadership: allAchievements.filter((a) => a.type === "LEADERSHIP").length,
      memberSince: member.joinedAt,
    };

    return res.json({
      member: toCurrentUser(member, department, totalCredits, levels),
      recentCredits,
      recentAchievements,
      stats,
    });
  } catch (err) {
    return next(err);
  }
});

router.get("/credits", async (req: AuthedRequest, res, next) => {
  try {
    const member = req.member!;
    const rows = await db
      .select()
      .from(creditTransactionsTable)
      .innerJoin(creditTypesTable, eq(creditTransactionsTable.creditTypeId, creditTypesTable.id))
      .innerJoin(membersTable, eq(creditTransactionsTable.addedByUserId, membersTable.id))
      .where(and(eq(creditTransactionsTable.memberId, member.id), eq(creditTransactionsTable.valid, true)))
      .orderBy(desc(creditTransactionsTable.createdAt));

    const activityType = typeof req.query.activityType === "string" ? req.query.activityType : "all";
    const filtered =
      activityType === "all"
        ? rows
        : rows.filter((r) => categorizeActivity(r.pmc_credit_types.nameEn) === activityType);

    return res.json(filtered.map((r) => toTransactionDTO(r.pmc_credit_transactions, r.pmc_credit_types, member, r.pmc_members, null)));
  } catch (err) {
    return next(err);
  }
});

router.get("/achievements", async (req: AuthedRequest, res, next) => {
  try {
    const member = req.member!;
    const rows = await db
      .select()
      .from(achievementsTable)
      .innerJoin(membersTable, eq(achievementsTable.approvedByUserId, membersTable.id))
      .where(eq(achievementsTable.memberId, member.id))
      .orderBy(desc(achievementsTable.achievementDate));

    return res.json(rows.map((r) => toAchievementDTO(r.pmc_achievements, member, r.pmc_members)));
  } catch (err) {
    return next(err);
  }
});

router.get("/card", async (req: AuthedRequest, res, next) => {
  try {
    const member = req.member!;
    const [totalCredits, levels, [settings]] = await Promise.all([
      getTotalCredits(member.id),
      getAllLevels(),
      db.select().from(settingsTable).limit(1),
    ]);

    const baseUrl = process.env.APP_BASE_URL || "http://localhost:5173";

    return res.json({
      memberName: member.fullName,
      memberId: member.memberId,
      membershipYear: settings?.membershipYear ?? "2026–27",
      level: computeLevel(totalCredits, levels),
      profileUrl: `${baseUrl}/member/${member.memberId}`,
      qrValue: `${baseUrl}/member/${member.memberId}`,
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
