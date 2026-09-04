import type { Response, NextFunction, Request } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { db, membersTable } from "@workspace/db";
import type { Member } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface AuthedRequest extends Request {
  clerkUserId?: string;
  member?: Member;
}

const STATUS_MESSAGES_AR: Record<string, string> = {
  PENDING: "عضويتك بانتظار الاعتماد.",
  REJECTED: "تم رفض طلب عضويتك. يرجى التواصل مع إدارة النادي.",
  INACTIVE: "تم إيقاف الوصول إلى عضويتك. يرجى التواصل مع إدارة النادي.",
};

/**
 * Resolves the authenticated Clerk session (if any) to a PMC member record.
 *
 * - If the Clerk user is already linked (clerkUserId matches), uses that.
 * - If not yet linked, looks for an approved-or-pending member row whose
 *   email matches the Clerk user's VERIFIED primary email, and links it.
 *   This is the only place a Clerk identity is ever associated with a PMC
 *   member -- it never creates a new member record.
 *
 * Never rejects the request itself; downstream middleware (requireMember /
 * requireRole) decides what to do with the result. This keeps
 * /auth/activation/check able to report status without a hard 401/403.
 */
export async function attachMember(req: AuthedRequest, _res: Response, next: NextFunction) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) return next();
    req.clerkUserId = auth.userId;

    const [linked] = await db
      .select()
      .from(membersTable)
      .where(eq(membersTable.clerkUserId, auth.userId))
      .limit(1);

    if (linked) {
      req.member = linked;
      return next();
    }

    const clerkUser = await clerkClient.users.getUser(auth.userId);
    const primaryEmail = clerkUser.emailAddresses.find(
      (e) => e.id === clerkUser.primaryEmailAddressId,
    );

    if (primaryEmail && primaryEmail.verification?.status === "verified") {
      const email = primaryEmail.emailAddress.toLowerCase();
      const [candidate] = await db
        .select()
        .from(membersTable)
        .where(eq(membersTable.email, email))
        .limit(1);

      if (candidate && !candidate.clerkUserId) {
        const [updated] = await db
          .update(membersTable)
          .set({
            clerkUserId: auth.userId,
            emailVerified: true,
            accountActivated: candidate.membershipStatus === "APPROVED",
          })
          .where(eq(membersTable.id, candidate.id))
          .returning();
        req.member = updated;
        return next();
      }

      if (candidate) {
        req.member = candidate;
        return next();
      }
    }

    return next();
  } catch (err) {
    return next(err);
  }
}

/** Requires an authenticated Clerk session AND an active, approved PMC member. */
export function requireMember(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.clerkUserId) {
    return res.status(401).json({ error: "Unauthenticated", errorAr: "الرجاء تسجيل الدخول." });
  }
  if (!req.member) {
    return res.status(403).json({
      error: "No matching PMC membership",
      errorAr: "هذا البريد غير مسجل ضمن أعضاء PMC المعتمدين.",
    });
  }
  const status = !req.member.active ? "INACTIVE" : req.member.membershipStatus;
  if (status !== "APPROVED") {
    return res.status(403).json({
      error: `Membership status is ${status}`,
      errorAr: STATUS_MESSAGES_AR[status] ?? "عضويتك غير مفعّلة حاليًا.",
    });
  }
  return next();
}

/** Requires the resolved member to have one of the given roles. Call after requireMember. */
export function requireRole(...roles: Array<Member["role"]>) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.member || !roles.includes(req.member.role)) {
      return res.status(403).json({
        error: "Forbidden",
        errorAr: "ليس لديك صلاحية لتنفيذ هذا الإجراء.",
      });
    }
    return next();
  };
}
