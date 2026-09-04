import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { eq, and, ilike } from "drizzle-orm";
import {
  db,
  departmentsTable,
  membersTable,
  creditTypesTable,
  creditTransactionsTable,
  achievementsTable,
} from "@workspace/db";
import type { AuthedRequest } from "../middlewares/requireAuth";
import { requireMember, requireRole } from "../middlewares/requireAuth";
import { getTotalCredits, getTotalCreditsBulk, getAllLevels } from "../lib/queries";
import { toMemberRecord, toDepartmentDTO, toTransactionDTO, toAchievementDTO } from "../lib/serialize";
import { generateTransactionId, generateAchievementId, generateMemberId } from "../lib/ids";
import { logAudit } from "../lib/audit";

const router: IRouter = Router();
router.use(requireMember, requireRole("DEPARTMENT_LEADER"));

router.get("/department", async (req: AuthedRequest, res, next) => {
  try {
    const leader = req.member!;
    if (!leader.departmentId) {
      return res.status(409).json({
        error: "Leader has no assigned department",
        errorAr: "لا يوجد قسم مرتبط بحسابك حاليًا.",
      });
    }

    const [department] = await db
      .select()
      .from(departmentsTable)
      .where(eq(departmentsTable.id, leader.departmentId))
      .limit(1);

    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const conditions = [eq(membersTable.departmentId, leader.departmentId)];
    if (search) conditions.push(ilike(membersTable.fullName, `%${search}%`));

    const members = await db
      .select()
      .from(membersTable)
      .where(and(...conditions));

    const levels = await getAllLevels();
    const creditsMap = await getTotalCreditsBulk(members.map((m) => m.id));

    const memberDTOs = members.map((m) => toMemberRecord(m, department, creditsMap.get(m.id) ?? 0, levels));

    return res.json({
      department: toDepartmentDTO(department, members.length, { memberId: leader.memberId, name: leader.fullName }),
      members: memberDTOs,
    });
  } catch (err) {
    return next(err);
  }
});

const leaderMemberInputSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  universityId: z.string().min(1),
  college: z.string().min(1),
  major: z.string().min(1),
  membershipStatus: z.enum(["PENDING", "APPROVED"]).default("APPROVED"),
});

router.post("/members", async (req: AuthedRequest, res, next) => {
  try {
    const leader = req.member!;
    if (!leader.departmentId) {
      return res.status(409).json({ error: "Leader has no assigned department", errorAr: "لا يوجد قسم مرتبط بحسابك حاليًا." });
    }
    const parsed = leaderMemberInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input", errorAr: "يرجى تعبئة جميع الحقول المطلوبة بشكل صحيح." });
    }
    const input = parsed.data;
    const email = input.email.toLowerCase();
    const [existingEmail] = await db.select().from(membersTable).where(eq(membersTable.email, email)).limit(1);
    if (existingEmail) return res.status(409).json({ error: "Email already registered", errorAr: "هذا البريد مسجل مسبقًا." });
    const [existingUniId] = await db.select().from(membersTable).where(eq(membersTable.universityId, input.universityId)).limit(1);
    if (existingUniId) return res.status(409).json({ error: "University ID already registered", errorAr: "الرقم الجامعي مستخدم مسبقًا." });

    const memberId = await generateMemberId();
    const [created] = await db.insert(membersTable).values({
      memberId,
      fullName: input.fullName,
      email,
      universityId: input.universityId,
      college: input.college,
      major: input.major,
      departmentId: leader.departmentId,
      role: "MEMBER",
      membershipStatus: input.membershipStatus,
      accountActivated: false,
      emailVerified: false,
      active: true,
    }).returning();

    await logAudit({ action: "member_created_by_leader", actorMemberId: leader.id, target: created.memberId, metadata: { departmentId: leader.departmentId, membershipStatus: input.membershipStatus } });
    const [department] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, leader.departmentId)).limit(1);
    const levels = await getAllLevels();
    return res.status(201).json(toMemberRecord(created, department, 0, levels));
  } catch (err: any) {
    if (err?.code === "23505") return res.status(409).json({ error: "Duplicate value", errorAr: "البريد أو الرقم الجامعي مستخدم مسبقًا." });
    return next(err);
  }
});

const creditAwardSchema = z.object({
  memberId: z.string().min(1),
  creditTypeId: z.number().int().positive(),
  activityName: z.string().min(2),
  activityDate: z.coerce.date(),
  note: z.string().nullable().optional(),
});

router.post("/credits", async (req: AuthedRequest, res, next) => {
  try {
    const leader = req.member!;
    const parsed = creditAwardSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input", errorAr: "البيانات المدخلة غير صحيحة." });
    }
    const input = parsed.data;

    const [target] = await db.select().from(membersTable).where(eq(membersTable.memberId, input.memberId)).limit(1);
    if (!target) {
      return res.status(404).json({ error: "Member not found", errorAr: "العضو غير موجود." });
    }
    if (target.departmentId !== leader.departmentId) {
      return res.status(403).json({
        error: "Target member is outside your department",
        errorAr: "ليس لديك صلاحية لتنفيذ هذا الإجراء.",
      });
    }
    if (target.id === leader.id) {
      return res.status(403).json({ error: "Cannot credit yourself", errorAr: "لا يمكنك إضافة رصيد لنفسك." });
    }
    if (target.role !== "MEMBER") {
      return res.status(403).json({
        error: "Can only credit regular members",
        errorAr: "لا يمكنك إضافة رصيد لقائد قسم آخر.",
      });
    }

    const [creditType] = await db
      .select()
      .from(creditTypesTable)
      .where(eq(creditTypesTable.id, input.creditTypeId))
      .limit(1);
    if (!creditType || !creditType.active) {
      return res.status(400).json({ error: "Invalid credit type", errorAr: "نوع الرصيد غير صالح." });
    }
    if (creditType.requiresPresidentApproval) {
      return res.status(403).json({
        error: "This credit type requires President approval and cannot be awarded by a Department Leader",
        errorAr: "هذا النوع من الرصيد يتطلب اعتماد الرئيسة ولا يمكن لقائد القسم منحه مباشرة.",
      });
    }

    const transactionId = await generateTransactionId();
    const [tx] = await db
      .insert(creditTransactionsTable)
      .values({
        transactionId,
        memberId: target.id,
        creditTypeId: creditType.id,
        creditValue: creditType.creditValue,
        activityName: input.activityName,
        activityType: creditType.nameEn,
        activityDate: input.activityDate.toISOString().slice(0, 10),
        addedByUserId: leader.id,
        note: input.note ?? null,
        valid: true,
      })
      .returning();

    await logAudit({
      action: "credit_added",
      actorMemberId: leader.id,
      target: target.memberId,
      metadata: { transactionId, creditTypeId: creditType.id, creditValue: creditType.creditValue },
    });

    return res.status(201).json(toTransactionDTO(tx, creditType, target, leader, null));
  } catch (err) {
    return next(err);
  }
});

const achievementSchema = z.object({
  memberId: z.string().min(1),
  type: z.enum(["PROJECT", "CHALLENGE", "LEADERSHIP", "EVENT", "IDEA", "CONTRIBUTOR", "SPECIAL"]),
  title: z.string().min(2),
  activity: z.string().min(2),
  date: z.coerce.date(),
  description: z.string().nullable().optional(),
});

router.post("/achievements", async (req: AuthedRequest, res, next) => {
  try {
    const leader = req.member!;
    const parsed = achievementSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input", errorAr: "البيانات المدخلة غير صحيحة." });
    }
    const input = parsed.data;

    const [target] = await db.select().from(membersTable).where(eq(membersTable.memberId, input.memberId)).limit(1);
    if (!target) {
      return res.status(404).json({ error: "Member not found", errorAr: "العضو غير موجود." });
    }
    if (target.departmentId !== leader.departmentId || target.role !== "MEMBER") {
      return res.status(403).json({
        error: "Target member is not an eligible member of your department",
        errorAr: "ليس لديك صلاحية لتنفيذ هذا الإجراء.",
      });
    }

    const achievementId = await generateAchievementId();
    const [ach] = await db
      .insert(achievementsTable)
      .values({
        achievementId,
        memberId: target.id,
        type: input.type,
        title: input.title,
        activity: input.activity,
        achievementDate: input.date.toISOString().slice(0, 10),
        approvedByUserId: leader.id,
        description: input.description ?? null,
      })
      .returning();

    await logAudit({
      action: "achievement_added",
      actorMemberId: leader.id,
      target: target.memberId,
      metadata: { achievementId, type: input.type },
    });

    return res.status(201).json(toAchievementDTO(ach, target, leader));
  } catch (err) {
    return next(err);
  }
});

export default router;
