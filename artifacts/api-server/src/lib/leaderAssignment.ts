import { and, eq, ne } from "drizzle-orm";
import { db, membersTable } from "@workspace/db";
import type { Member } from "@workspace/db";

type Executor = Pick<typeof db, "select" | "update">;

/**
 * Enforces "exactly one active DEPARTMENT_LEADER per department" by finding
 * and demoting any other current leader of `departmentId` to MEMBER.
 *
 * MUST be called with `executor` bound to the same `db.transaction(async
 * (tx) => ...)` client as the promotion it accompanies -- every call site in
 * this codebase (POST /president/members, PATCH /president/members/:id,
 * PATCH /president/departments/:id) wraps this together with the actual
 * role/department write in one transaction, so the read-then-demote here and
 * the promotion elsewhere in the same transaction can never be observed as
 * two active leaders, even under concurrent requests (Postgres's default
 * READ COMMITTED isolation still serializes the two transactions' writes to
 * the same rows).
 *
 * Returns the demoted member (if any) so the caller can audit-log both the
 * demotion and the promotion with accurate before/after detail.
 */
export async function demoteExistingLeader(
  executor: Executor,
  departmentId: number,
  exceptMemberId: number,
): Promise<Member | null> {
  const [previousLeader] = await executor
    .select()
    .from(membersTable)
    .where(and(eq(membersTable.departmentId, departmentId), eq(membersTable.role, "DEPARTMENT_LEADER"), ne(membersTable.id, exceptMemberId)))
    .limit(1);

  if (!previousLeader) return null;

  await executor.update(membersTable).set({ role: "MEMBER" }).where(eq(membersTable.id, previousLeader.id));
  return previousLeader;
}
