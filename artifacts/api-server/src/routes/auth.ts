import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { db, membersTable } from "@workspace/db";

const router: IRouter = Router();

const MESSAGES: Record<string, { en: string; ar: string }> = {
  NOT_FOUND: {
    en: "This email is not registered as an approved PMC member.",
    ar: "هذا البريد غير مسجل ضمن أعضاء PMC المعتمدين.",
  },
  PENDING: {
    en: "Your membership is awaiting approval.",
    ar: "عضويتك بانتظار الاعتماد.",
  },
  REJECTED: {
    en: "Your membership application was rejected.",
    ar: "تم رفض طلب عضويتك.",
  },
  INACTIVE: {
    en: "Access to your membership has been suspended. Please contact club administration.",
    ar: "تم إيقاف الوصول إلى عضويتك. يرجى التواصل مع إدارة النادي.",
  },
  APPROVED: {
    en: "Your PMC membership is approved. You can continue to create your account.",
    ar: "عضويتك معتمدة. يمكنك المتابعة لإنشاء حسابك.",
  },
};

const inputSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
});

/** Trim, collapse internal whitespace, and lowercase for a tolerant but not
 * overly loose name comparison. Case-insensitivity is a no-op for Arabic
 * script (no case) and harmless; it only affects Latin-script names. */
function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

// PUBLIC (no auth) -- lets a prospective member check, before ever creating a
// Clerk account, whether the President has already registered them as an
// approved PMC member. Requires BOTH the approved email AND the full name to
// match the record the President created -- matching by email alone would
// let anyone who guesses/knows another member's email probe their
// membership status. This never creates a member record itself; it only
// reports the status of a record the President already created. This is
// intentionally NOT the same as linking a Clerk session (see
// middlewares/requireAuth.ts attachMember, which does the real linking on
// first authenticated request, and which -- deliberately -- matches by
// verified email only, since by that point the person already holds a
// verified Clerk session for that address).
router.post("/activation/check", async (req, res, next) => {
  try {
    const parsed = inputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input", errorAr: "يرجى إدخال الاسم والبريد الإلكتروني بشكل صحيح." });
    }

    const email = parsed.data.email.toLowerCase();
    const [member] = await db.select().from(membersTable).where(eq(membersTable.email, email)).limit(1);

    // A member exists for this email but the supplied name doesn't match --
    // respond exactly like "no member for this email" (same status code,
    // same message, same memberId: null) so a caller who doesn't already
    // know the correct name learns nothing about whether the email is
    // registered.
    const nameMatches = member ? normalizeName(member.fullName) === normalizeName(parsed.data.fullName) : false;

    if (!member || !nameMatches) {
      const m = MESSAGES.NOT_FOUND;
      return res.json({ eligible: false, status: "NOT_FOUND", message: m.en, messageAr: m.ar, memberId: null });
    }

    const status = !member.active ? "INACTIVE" : member.membershipStatus;

    if (status === "APPROVED") {
      const m = MESSAGES.APPROVED;
      return res.json({ eligible: true, status: "APPROVED", message: m.en, messageAr: m.ar, memberId: member.memberId });
    }

    const m = MESSAGES[status] ?? MESSAGES.NOT_FOUND;
    return res.json({ eligible: false, status, message: m.en, messageAr: m.ar, memberId: member.memberId });
  } catch (err) {
    return next(err);
  }
});

export default router;
