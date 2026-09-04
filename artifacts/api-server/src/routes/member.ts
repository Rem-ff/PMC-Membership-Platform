import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, achievementsTable, settingsTable } from "@workspace/db";
import { getMemberByMemberId, getTotalCredits, getAllLevels, getDepartmentName } from "../lib/queries";
import { computeLevel } from "../lib/levels";

const router: IRouter = Router();

// GET /member/:memberId -- PUBLIC digital-card verification page. Deliberately
// does not require authentication (this is what the membership card's QR
// code links to) and returns only non-sensitive fields (matches the
// PublicProfile schema in openapi.yaml exactly -- no email/phone/university
// ID/audit data is ever included here).
router.get("/member/:memberId", async (req, res, next) => {
  try {
    // President-controlled kill switch for public verification pages. When
    // disabled, respond identically to "member not found" -- same status
    // code, same generic message -- rather than a distinct "profiles are
    // disabled" response, so this endpoint never confirms or denies that a
    // given member ID exists while the setting is off.
    const [settings] = await db.select().from(settingsTable).limit(1);
    if (settings && !settings.publicProfilesDefaultVisible) {
      return res.status(404).json({ error: "Member not found", errorAr: "لا يوجد عضو بهذا الرقم." });
    }

    const member = await getMemberByMemberId(String(req.params.memberId));
    if (!member) {
      return res.status(404).json({ error: "Member not found", errorAr: "لا يوجد عضو بهذا الرقم." });
    }

    const [totalCredits, levels, department, achievements] = await Promise.all([
      getTotalCredits(member.id),
      getAllLevels(),
      getDepartmentName(member.departmentId),
      db.select().from(achievementsTable).where(eq(achievementsTable.memberId, member.id)),
    ]);

    return res.json({
      memberId: member.memberId,
      name: member.fullName,
      level: computeLevel(totalCredits, levels),
      credits: totalCredits,
      achievements: achievements.map((a) => ({
        id: a.achievementId,
        memberId: member.memberId,
        type: a.type,
        title: a.title,
        activity: a.activity,
        date: a.achievementDate,
        approvedBy: "",
        description: a.description ?? null,
      })),
      memberSince: member.joinedAt,
      department,
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
