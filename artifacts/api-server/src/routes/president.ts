import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { eq, and, or, ilike, desc, sql, inArray } from "drizzle-orm";
import {
  db,
  membersTable,
  departmentsTable,
  creditTypesTable,
  creditTransactionsTable,
  levelsTable,
  auditLogsTable,
  settingsTable,
} from "@workspace/db";
import type { AuthedRequest } from "../middlewares/requireAuth";
import { requireMember, requireRole } from "../middlewares/requireAuth";
import { getAllLevels, getTotalCredits, getTotalCreditsBulk } from "../lib/queries";
import { toMemberRecord, toDepartmentDTO, toCreditTypeDTO, toLevelDTO, toTransactionDTO } from "../lib/serialize";
import { generateMemberId, generateTransactionId } from "../lib/ids";
import { logAudit } from "../lib/audit";
import { demoteExistingLeader } from "../lib/leaderAssignment";
import { computeLevel } from "../lib/levels";
import { categorizeActivity } from "../lib/categorize";

const router: IRouter = Router();
router.use(requireMember, requireRole("PRESIDENT"));

// ---------- Overview ----------
router.get("/overview", async (_req, res, next) => {
  try {
    const allMembers = await db.select().from(membersTable);
    const activeMembers = allMembers.filter((m) => m.active && m.membershipStatus === "APPROVED");
    const pendingMembers = allMembers.filter((m) => m.membershipStatus === "PENDING");
    const departments = await db.select().from(departmentsTable);
    const levels = await getAllLevels();
    const creditsMap = await getTotalCreditsBulk(allMembers.map((m) => m.id));

    const totalCredits = [...creditsMap.values()].reduce((a, b) => a + b, 0);

    const membersByLevelMap = new Map<string, number>();
    for (const m of activeMembers) {
      const lvl = computeLevel(creditsMap.get(m.id) ?? 0, levels);
      membersByLevelMap.set(lvl.nameEn, (membersByLevelMap.get(lvl.nameEn) ?? 0) + 1);
    }

    const recentTxRows = await db
      .select()
      .from(creditTransactionsTable)
      .innerJoin(creditTypesTable, eq(creditTransactionsTable.creditTypeId, creditTypesTable.id))
      .orderBy(desc(creditTransactionsTable.createdAt))
      .limit(10);

    const memberById = new Map(allMembers.map((m) => [m.id, m]));
    const recentTransactions = recentTxRows
      .map((r) => {
        const member = memberById.get(r.pmc_credit_transactions.memberId);
        const addedBy = memberById.get(r.pmc_credit_transactions.addedByUserId);
        if (!member || !addedBy) return null;
        return toTransactionDTO(r.pmc_credit_transactions, r.pmc_credit_types, member, addedBy, null);
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const departmentById = new Map(departments.map((d) => [d.id, d]));
    const recentMembers = [...allMembers]
      .sort((a, b) => new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime())
      .slice(0, 5)
      .map((m) => toMemberRecord(m, m.departmentId ? departmentById.get(m.departmentId) : null, creditsMap.get(m.id) ?? 0, levels));

    const closeToNextLevel = activeMembers
      .map((m) => ({ member: m, level: computeLevel(creditsMap.get(m.id) ?? 0, levels) }))
      .filter((x) => x.level.nextThreshold !== null && x.level.progressPercent >= 70)
      .sort((a, b) => b.level.progressPercent - a.level.progressPercent)
      .slice(0, 5)
      .map((x) => toMemberRecord(x.member, x.member.departmentId ? departmentById.get(x.member.departmentId) : null, x.level.current, levels));

    return res.json({
      totalActiveMembers: activeMembers.length,
      pendingMembers: pendingMembers.length,
      totalDepartments: departments.length,
      totalCredits,
      membersByLevel: [...membersByLevelMap.entries()].map(([level, count]) => ({ level, count })),
      recentTransactions,
      recentMembers,
      closeToNextLevel,
    });
  } catch (err) {
    return next(err);
  }
});

// ---------- Members ----------
router.get("/members", async (req: AuthedRequest, res, next) => {
  try {
    const { status, search } = req.query as { status?: string; search?: string };
    const conditions = [];
    if (status) conditions.push(eq(membersTable.membershipStatus, status));
    if (search) {
      conditions.push(
        or(
          ilike(membersTable.fullName, `%${search}%`),
          ilike(membersTable.memberId, `%${search}%`),
          ilike(membersTable.email, `%${search}%`),
        ),
      );
    }

    const members = await db
      .select()
      .from(membersTable)
      .where(conditions.length ? and(...conditions) : undefined);

    const departments = await db.select().from(departmentsTable);
    const departmentById = new Map(departments.map((d) => [d.id, d]));
    const levels = await getAllLevels();
    const creditsMap = await getTotalCreditsBulk(members.map((m) => m.id));

    return res.json(
      members.map((m) =>
        toMemberRecord(m, m.departmentId ? departmentById.get(m.departmentId) : null, creditsMap.get(m.id) ?? 0, levels),
      ),
    );
  } catch (err) {
    return next(err);
  }
});

const memberInputSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  universityId: z.string().min(1),
  college: z.string().min(1),
  major: z.string().min(1),
  departmentId: z.number().int().positive(),
  role: z.enum(["MEMBER", "DEPARTMENT_LEADER"]),
  membershipStatus: z.enum(["PENDING", "APPROVED", "REJECTED", "INACTIVE"]),
});

router.post("/members", async (req: AuthedRequest, res, next) => {
  try {
    const parsed = memberInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input", errorAr: "يرجى تعبئة جميع الحقول المطلوبة بشكل صحيح." });
    }
    const input = parsed.data;
    const email = input.email.toLowerCase();

    const [existingEmail] = await db.select().from(membersTable).where(eq(membersTable.email, email)).limit(1);
    if (existingEmail) {
      return res.status(409).json({ error: "Email already registered", errorAr: "هذا البريد مسجل مسبقًا." });
    }

    const [existingUniId] = await db
      .select()
      .from(membersTable)
      .where(eq(membersTable.universityId, input.universityId))
      .limit(1);
    if (existingUniId) {
      return res.status(409).json({ error: "University ID already registered", errorAr: "الرقم الجامعي مستخدم مسبقًا." });
    }

    const memberId = await generateMemberId();

    // Creating a member directly as DEPARTMENT_LEADER is another write path
    // that must uphold "exactly one active leader per department" -- demote
    // any existing leader of the target department in the SAME transaction
    // as the insert (see lib/leaderAssignment.ts), so the swap is atomic and
    // the DB-level partial unique index never has a chance to see two
    // leaders at once.
    const { created, demotedLeader } = await db.transaction(async (tx) => {
      let demoted: Awaited<ReturnType<typeof demoteExistingLeader>> = null;
      if (input.role === "DEPARTMENT_LEADER") {
        // exceptMemberId=-1: no existing row to exclude, since the new
        // member doesn't exist yet -- any DEPARTMENT_LEADER found in this
        // department is necessarily a different member.
        demoted = await demoteExistingLeader(tx, input.departmentId, -1);
        if (demoted) {
          await logAudit(
            { action: "leader_demoted", actorMemberId: req.member!.id, target: demoted.memberId, metadata: { reason: "replaced_by_new_member", departmentId: input.departmentId } },
            tx,
          );
        }
      }

      const [row] = await tx
        .insert(membersTable)
        .values({
          memberId,
          fullName: input.fullName,
          email,
          universityId: input.universityId,
          college: input.college,
          major: input.major,
          departmentId: input.departmentId,
          role: input.role,
          membershipStatus: input.membershipStatus,
          accountActivated: false,
          emailVerified: false,
          active: true,
        })
        .returning();

      return { created: row, demotedLeader: demoted };
    });

    await logAudit({
      action: "member_created",
      actorMemberId: req.member!.id,
      target: created.memberId,
      metadata: {
        role: input.role,
        membershipStatus: input.membershipStatus,
        departmentId: input.departmentId,
        ...(demotedLeader && { replacedLeader: demotedLeader.memberId }),
      },
    });

    const [department] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, input.departmentId)).limit(1);
    const levels = await getAllLevels();
    return res.status(201).json(toMemberRecord(created, department, 0, levels));
  } catch (err: any) {
    if (err?.code === "23505") {
      if (err?.constraint === "pmc_members_one_leader_per_department") {
        return res.status(409).json({
          error: "Department already has an active leader",
          errorAr: "يوجد بالفعل قائد نشط لهذا القسم.",
        });
      }
      return res.status(409).json({ error: "Duplicate value", errorAr: "هذا البريد مسجل مسبقًا." });
    }
    return next(err);
  }
});

const memberUpdateSchema = z.object({
  fullName: z.string().min(2).optional(),
  college: z.string().optional(),
  major: z.string().optional(),
  departmentId: z.number().int().positive().nullable().optional(),
  role: z.enum(["MEMBER", "DEPARTMENT_LEADER"]).optional(),
  membershipStatus: z.enum(["PENDING", "APPROVED", "REJECTED", "INACTIVE"]).optional(),
  rejectionNote: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

router.patch("/members/:memberId", async (req: AuthedRequest, res, next) => {
  try {
    const memberIdParam = String(req.params.memberId);
    const [target] = await db.select().from(membersTable).where(eq(membersTable.memberId, memberIdParam)).limit(1);
    if (!target) return res.status(404).json({ error: "Member not found", errorAr: "العضو غير موجود." });

    const parsed = memberUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input", errorAr: "تعذر حفظ التغييرات، حاول مرة أخرى." });
    }
    const input = parsed.data;
    const before = { ...target };

    // The leader-replacement (demote previous leader) and the member's own
    // update must succeed or fail together -- otherwise a mid-request crash
    // could leave a department with two active leaders. Wrapped in a single
    // DB transaction to make the swap atomic (spec section 9).
    const { updated, demotedLeader } = await db.transaction(async (tx) => {
      // If promoting this member to DEPARTMENT_LEADER for a department that
      // already has a leader, demote the previous leader to MEMBER (President
      // has effectively confirmed the replacement by submitting this update).
      let demoted: Awaited<ReturnType<typeof demoteExistingLeader>> = null;
      if (input.role === "DEPARTMENT_LEADER") {
        const deptId = input.departmentId ?? target.departmentId;
        if (deptId) {
          demoted = await demoteExistingLeader(tx, deptId, target.id);
          if (demoted) {
            await logAudit(
              { action: "leader_demoted", actorMemberId: req.member!.id, target: demoted.memberId, metadata: { reason: "replaced_by", newLeader: target.memberId } },
              tx,
            );
          }
        }
      }

      const [row] = await tx
        .update(membersTable)
        .set({
          ...(input.fullName !== undefined && { fullName: input.fullName }),
          ...(input.college !== undefined && { college: input.college }),
          ...(input.major !== undefined && { major: input.major }),
          ...(input.departmentId !== undefined && { departmentId: input.departmentId }),
          ...(input.role !== undefined && { role: input.role }),
          ...(input.membershipStatus !== undefined && { membershipStatus: input.membershipStatus }),
          ...(input.rejectionNote !== undefined && { rejectionNote: input.rejectionNote }),
          ...(input.active !== undefined && { active: input.active }),
        })
        .where(eq(membersTable.id, target.id))
        .returning();
      return { updated: row, demotedLeader: demoted };
    });

    await logAudit({
      action: "member_updated",
      actorMemberId: req.member!.id,
      target: target.memberId,
      metadata: {
        before: { role: before.role, membershipStatus: before.membershipStatus, departmentId: before.departmentId, active: before.active },
        after: { role: updated.role, membershipStatus: updated.membershipStatus, departmentId: updated.departmentId, active: updated.active },
        ...(demotedLeader && { replacedLeader: demotedLeader.memberId }),
      },
    });

    const department = updated.departmentId
      ? await db.select().from(departmentsTable).where(eq(departmentsTable.id, updated.departmentId)).then((r) => r[0])
      : null;
    const levels = await getAllLevels();
    const totalCredits = await getTotalCredits(updated.id);
    return res.json(toMemberRecord(updated, department, totalCredits, levels));
  } catch (err: any) {
    if (err?.code === "23505" && err?.constraint === "pmc_members_one_leader_per_department") {
      return res.status(409).json({
        error: "Department already has an active leader",
        errorAr: "يوجد بالفعل قائد نشط لهذا القسم.",
      });
    }
    return next(err);
  }
});

// CSV export -- President-only. Placed before /:memberId-style routes above
// don't conflict since this is its own literal path.
router.get("/members/export.csv", async (_req, res, next) => {
  try {
    const members = await db.select().from(membersTable);
    const departments = await db.select().from(departmentsTable);
    const departmentById = new Map(departments.map((d) => [d.id, d]));
    const creditsMap = await getTotalCreditsBulk(members.map((m) => m.id));

    const header = [
      "Member ID", "Full Name", "University ID", "Email", "College", "Major", "Department", "Role", "Membership Status", "Total Credits", "Joined Date",
    ];
    const rows = members.map((m) => [
      m.memberId,
      m.fullName,
      m.universityId ?? "",
      m.email,
      m.college ?? "",
      m.major ?? "",
      m.departmentId ? departmentById.get(m.departmentId)?.nameEn ?? "" : "",
      m.role,
      m.membershipStatus,
      String(creditsMap.get(m.id) ?? 0),
      new Date(m.joinedAt).toISOString().slice(0, 10),
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=pmc-members.csv");
    res.send("\uFEFF" + csv);
  } catch (err) {
    return next(err);
  }
});

// ---------- Transactions ----------
router.get("/transactions", async (req, res, next) => {
  try {
    const { search, activityType } = req.query as { search?: string; activityType?: string };
    const rows = await db
      .select()
      .from(creditTransactionsTable)
      .innerJoin(creditTypesTable, eq(creditTransactionsTable.creditTypeId, creditTypesTable.id))
      .innerJoin(membersTable, eq(creditTransactionsTable.memberId, membersTable.id))
      .orderBy(desc(creditTransactionsTable.createdAt));

    const addedByIds = [...new Set(rows.map((r) => r.pmc_credit_transactions.addedByUserId))];
    const addedByRows = addedByIds.length
      ? await db.select().from(membersTable).where(inArray(membersTable.id, addedByIds))
      : [];
    const addedById = new Map(addedByRows.map((m) => [m.id, m]));

    let filteredRows = rows;
    if (activityType && activityType !== "all") {
      filteredRows = filteredRows.filter((r) => categorizeActivity(r.pmc_credit_types.nameEn) === activityType);
    }

    let results = filteredRows.map((r) => {
      const addedBy = addedById.get(r.pmc_credit_transactions.addedByUserId);
      if (!addedBy) return null;
      return toTransactionDTO(r.pmc_credit_transactions, r.pmc_credit_types, r.pmc_members, addedBy, null);
    }).filter((x): x is NonNullable<typeof x> => x !== null);

    if (search) {
      const s = search.toLowerCase();
      results = results.filter((r) => r.memberName.toLowerCase().includes(s) || r.activityName.toLowerCase().includes(s));
    }

    return res.json(results);
  } catch (err) {
    return next(err);
  }
});

router.post("/transactions/:transactionId/reverse", async (req: AuthedRequest, res, next) => {
  try {
    const transactionIdParam = String(req.params.transactionId);
    const reasonSchema = z.object({ reason: z.string().min(2) });
    const parsed = reasonSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "A reason is required", errorAr: "يرجى توضيح سبب الإلغاء." });
    }

    const [tx] = await db
      .select()
      .from(creditTransactionsTable)
      .where(eq(creditTransactionsTable.transactionId, transactionIdParam))
      .limit(1);
    if (!tx) return res.status(404).json({ error: "Transaction not found", errorAr: "العملية غير موجودة." });

    const [updated] = await db
      .update(creditTransactionsTable)
      .set({ valid: false })
      .where(eq(creditTransactionsTable.id, tx.id))
      .returning();

    await logAudit({
      action: "credit_reversed",
      actorMemberId: req.member!.id,
      target: transactionIdParam,
      metadata: { reason: parsed.data.reason },
    });

    return res.json({ transactionId: updated.transactionId, valid: updated.valid });
  } catch (err) {
    return next(err);
  }
});

const presidentCreditAwardSchema = z.object({
  memberId: z.string().min(1),
  creditTypeId: z.number().int().positive(),
  activityName: z.string().min(2),
  activityDate: z.coerce.date(),
  note: z.string().nullable().optional(),
});

// President-level credit awarding: unlike a Leader (own-department, MEMBER
// targets only, no President-approval credit types), the President can
// credit any Member or Department Leader in any department, and is the only
// role allowed to award credit types with requiresPresidentApproval = true.
// President self-credit stays disabled by default (spec section 12): if
// ever needed, that would be its own explicit, separately-audited workflow,
// not a side effect of this general-purpose endpoint.
router.post("/credits", async (req: AuthedRequest, res, next) => {
  try {
    const president = req.member!;
    const parsed = presidentCreditAwardSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input", errorAr: "البيانات المدخلة غير صحيحة." });
    }
    const input = parsed.data;

    const [target] = await db.select().from(membersTable).where(eq(membersTable.memberId, input.memberId)).limit(1);
    if (!target) {
      return res.status(404).json({ error: "Member not found", errorAr: "العضو غير موجود." });
    }
    if (target.id === president.id) {
      return res.status(403).json({
        error: "President self-crediting is disabled",
        errorAr: "لا يمكن للرئيسة إضافة رصيد لنفسها عبر هذا الإجراء.",
      });
    }

    const [creditType] = await db.select().from(creditTypesTable).where(eq(creditTypesTable.id, input.creditTypeId)).limit(1);
    if (!creditType || !creditType.active) {
      return res.status(400).json({ error: "Invalid credit type", errorAr: "نوع الرصيد غير صالح." });
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
        addedByUserId: president.id,
        note: input.note ?? null,
        valid: true,
      })
      .returning();

    await logAudit({
      action: "credit_added",
      actorMemberId: president.id,
      target: target.memberId,
      metadata: { transactionId, creditTypeId: creditType.id, creditValue: creditType.creditValue, requiresPresidentApproval: creditType.requiresPresidentApproval },
    });

    return res.status(201).json(toTransactionDTO(tx, creditType, target, president, null));
  } catch (err) {
    return next(err);
  }
});

// ---------- Departments ----------
router.get("/departments", async (_req, res, next) => {
  try {
    const departments = await db.select().from(departmentsTable);
    const members = await db.select().from(membersTable);
    const results = departments.map((d) => {
      const deptMembers = members.filter((m) => m.departmentId === d.id);
      const leader = deptMembers.find((m) => m.role === "DEPARTMENT_LEADER");
      return toDepartmentDTO(d, deptMembers.length, leader ? { memberId: leader.memberId, name: leader.fullName } : null);
    });
    return res.json(results);
  } catch (err) {
    return next(err);
  }
});

const departmentInputSchema = z.object({ nameAr: z.string().min(2), nameEn: z.string().min(2) });

router.post("/departments", async (req: AuthedRequest, res, next) => {
  try {
    const parsed = departmentInputSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", errorAr: "يرجى تعبئة الحقول المطلوبة." });

    const [created] = await db.insert(departmentsTable).values(parsed.data).returning();
    await logAudit({ action: "department_created", actorMemberId: req.member!.id, target: created.nameEn, metadata: {} });
    return res.status(201).json(toDepartmentDTO(created, 0, null));
  } catch (err) {
    return next(err);
  }
});

const departmentUpdateSchema = z.object({
  nameAr: z.string().min(2).optional(),
  nameEn: z.string().min(2).optional(),
  active: z.boolean().optional(),
  leaderMemberId: z.string().nullable().optional(),
});

router.patch("/departments/:departmentId", async (req: AuthedRequest, res, next) => {
  try {
    const id = Number(req.params.departmentId);
    const parsed = departmentUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", errorAr: "تعذر حفظ التغييرات." });
    const { leaderMemberId, ...deptFields } = parsed.data;

    if (leaderMemberId !== undefined) {
      // Atomic: demoting the previous leader and promoting the new one must
      // never be observable as two active leaders at once (spec section 9).
      const leaderResult = await db.transaction(async (tx) => {
        if (leaderMemberId === null) {
          const demoted = await demoteExistingLeader(tx, id, -1);
          if (demoted) {
            await logAudit({ action: "leader_removed", actorMemberId: req.member!.id, target: demoted.memberId, metadata: { departmentId: id } }, tx);
          }
          return { ok: true as const };
        }

        const [newLeader] = await tx.select().from(membersTable).where(eq(membersTable.memberId, leaderMemberId)).limit(1);
        if (!newLeader) return { ok: false as const, status: 404, error: "Member not found", errorAr: "العضو غير موجود." };
        if (newLeader.departmentId !== id) {
          return { ok: false as const, status: 400, error: "Member must belong to this department", errorAr: "يجب أن يكون العضو من نفس القسم أولاً." };
        }

        const demoted = await demoteExistingLeader(tx, id, newLeader.id);
        if (demoted) {
          await logAudit(
            { action: "leader_demoted", actorMemberId: req.member!.id, target: demoted.memberId, metadata: { reason: "replaced_by", newLeader: newLeader.memberId } },
            tx,
          );
        }
        await tx.update(membersTable).set({ role: "DEPARTMENT_LEADER" }).where(eq(membersTable.id, newLeader.id));
        await logAudit({ action: "leader_assigned", actorMemberId: req.member!.id, target: newLeader.memberId, metadata: { departmentId: id } }, tx);
        return { ok: true as const };
      });

      if (!leaderResult.ok) {
        return res.status(leaderResult.status).json({ error: leaderResult.error, errorAr: leaderResult.errorAr });
      }
    }

    const [updated] = Object.keys(deptFields).length
      ? await db.update(departmentsTable).set(deptFields).where(eq(departmentsTable.id, id)).returning()
      : await db.select().from(departmentsTable).where(eq(departmentsTable.id, id)).then((r) => [r[0]]);
    if (!updated) return res.status(404).json({ error: "Department not found", errorAr: "القسم غير موجود." });

    if (Object.keys(deptFields).length) {
      await logAudit({ action: "department_updated", actorMemberId: req.member!.id, target: updated.nameEn, metadata: deptFields });
    }

    const members = await db.select().from(membersTable).where(eq(membersTable.departmentId, id));
    const leader = members.find((m) => m.role === "DEPARTMENT_LEADER");
    return res.json(toDepartmentDTO(updated, members.length, leader ? { memberId: leader.memberId, name: leader.fullName } : null));
  } catch (err) {
    return next(err);
  }
});

// ---------- Credit types ----------
router.get("/credit-types", async (_req, res, next) => {
  try {
    const types = await db.select().from(creditTypesTable);
    return res.json(types.map(toCreditTypeDTO));
  } catch (err) {
    return next(err);
  }
});

const creditTypeInputSchema = z.object({
  nameAr: z.string().min(2),
  nameEn: z.string().min(2),
  creditValue: z.number().int().positive(),
  requiresPresidentApproval: z.boolean().optional(),
  description: z.string().nullable().optional(),
});

router.post("/credit-types", async (req: AuthedRequest, res, next) => {
  try {
    const parsed = creditTypeInputSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", errorAr: "يرجى تعبئة جميع الحقول المطلوبة بشكل صحيح." });

    const [existing] = await db.select().from(creditTypesTable).where(eq(creditTypesTable.nameEn, parsed.data.nameEn)).limit(1);
    if (existing) return res.status(409).json({ error: "Credit type already exists", errorAr: "يوجد نوع رصيد بهذا الاسم مسبقًا." });

    const [created] = await db.insert(creditTypesTable).values({ ...parsed.data, active: true }).returning();
    await logAudit({ action: "credit_type_created", actorMemberId: req.member!.id, target: created.nameEn, metadata: parsed.data });
    return res.status(201).json(toCreditTypeDTO(created));
  } catch (err) {
    return next(err);
  }
});

const creditTypeUpdateSchema = z.object({
  id: z.number().int().positive(),
  nameAr: z.string().min(2).optional(),
  nameEn: z.string().min(2).optional(),
  creditValue: z.number().int().positive().optional(),
  active: z.boolean().optional(),
  requiresPresidentApproval: z.boolean().optional(),
  description: z.string().nullable().optional(),
});

router.patch("/credit-types", async (req: AuthedRequest, res, next) => {
  try {
    const parsed = creditTypeUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", errorAr: "تعذر حفظ التغييرات." });
    const { id, ...fields } = parsed.data;

    const [updated] = await db.update(creditTypesTable).set(fields).where(eq(creditTypesTable.id, id)).returning();
    if (!updated) return res.status(404).json({ error: "Credit type not found", errorAr: "نوع الرصيد غير موجود." });

    await logAudit({ action: "credit_type_updated", actorMemberId: req.member!.id, target: updated.nameEn, metadata: fields });
    return res.json(toCreditTypeDTO(updated));
  } catch (err) {
    return next(err);
  }
});

// ---------- Levels ----------
router.get("/levels", async (_req, res, next) => {
  try {
    const levels = await getAllLevels();
    return res.json(levels.map(toLevelDTO));
  } catch (err) {
    return next(err);
  }
});

const levelInputSchema = z.object({
  key: z.string().min(2),
  nameAr: z.string().min(2),
  nameEn: z.string().min(2),
  symbol: z.string().min(1),
  minCredits: z.number().int().nonnegative(),
  requiresProjectCompletion: z.boolean().optional(),
  requiresLeadership: z.boolean().optional(),
  requiresPresidentApproval: z.boolean().optional(),
});

router.post("/levels", async (req: AuthedRequest, res, next) => {
  try {
    const parsed = levelInputSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", errorAr: "يرجى تعبئة جميع الحقول المطلوبة بشكل صحيح." });

    const [existing] = await db.select().from(levelsTable).where(eq(levelsTable.key, parsed.data.key)).limit(1);
    if (existing) return res.status(409).json({ error: "Level key already exists", errorAr: "يوجد مستوى بهذا المفتاح مسبقًا." });

    const [created] = await db.insert(levelsTable).values({ ...parsed.data, active: true }).returning();
    await logAudit({ action: "level_created", actorMemberId: req.member!.id, target: created.key, metadata: parsed.data });
    return res.status(201).json(toLevelDTO(created));
  } catch (err) {
    return next(err);
  }
});

const levelUpdateSchema = z.object({
  id: z.number().int().positive(),
  minCredits: z.number().int().nonnegative().optional(),
  requiresProjectCompletion: z.boolean().optional(),
  requiresLeadership: z.boolean().optional(),
  requiresPresidentApproval: z.boolean().optional(),
  active: z.boolean().optional(),
});

router.patch("/levels", async (req: AuthedRequest, res, next) => {
  try {
    const parsed = levelUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", errorAr: "تعذر حفظ التغييرات." });
    const { id, ...fields } = parsed.data;

    const [updated] = await db.update(levelsTable).set(fields).where(eq(levelsTable.id, id)).returning();
    if (!updated) return res.status(404).json({ error: "Level not found", errorAr: "المستوى غير موجود." });

    await logAudit({ action: "level_updated", actorMemberId: req.member!.id, target: updated.key, metadata: fields });
    return res.json(toLevelDTO(updated));
  } catch (err) {
    return next(err);
  }
});

// ---------- Settings ----------
router.get("/settings", async (_req, res, next) => {
  try {
    const [settings] = await db.select().from(settingsTable).limit(1);
    return res.json(settings ?? { membershipYear: "2026–27", publicProfilesDefaultVisible: true });
  } catch (err) {
    return next(err);
  }
});

const settingsUpdateSchema = z.object({
  membershipYear: z.string().min(1).optional(),
  publicProfilesDefaultVisible: z.boolean().optional(),
});

router.patch("/settings", async (req: AuthedRequest, res, next) => {
  try {
    const parsed = settingsUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", errorAr: "تعذر حفظ التغييرات." });

    const [existing] = await db.select().from(settingsTable).limit(1);
    const [updated] = existing
      ? await db.update(settingsTable).set(parsed.data).where(eq(settingsTable.id, existing.id)).returning()
      : await db.insert(settingsTable).values(parsed.data).returning();

    await logAudit({ action: "settings_updated", actorMemberId: req.member!.id, target: "club_settings", metadata: parsed.data });
    return res.json(updated);
  } catch (err) {
    return next(err);
  }
});

// ---------- Audit logs ----------
router.get("/audit-logs", async (_req, res, next) => {
  try {
    const logs = await db.select().from(auditLogsTable).orderBy(desc(auditLogsTable.createdAt)).limit(200);
    const actorIds = [...new Set(logs.map((l) => l.actorMemberId).filter((x): x is number => x !== null))];
    const actors = actorIds.length ? await db.select().from(membersTable).where(inArray(membersTable.id, actorIds)) : [];
    const actorById = new Map(actors.map((a) => [a.id, a]));

    return res.json(
      logs.map((l) => ({
        id: String(l.id),
        action: l.action,
        actor: l.actorMemberId ? actorById.get(l.actorMemberId)?.fullName ?? "System" : "System",
        target: l.target,
        timestamp: l.createdAt,
        metadata: l.metadata,
      })),
    );
  } catch (err) {
    return next(err);
  }
});

export default router;
