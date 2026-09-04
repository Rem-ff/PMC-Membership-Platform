import { db, membersTable, creditTransactionsTable, levelsTable, departmentsTable } from "@workspace/db";
import type { Member } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";

export async function getTotalCredits(memberId: number): Promise<number> {
  const [{ total }] = await db
    .select({ total: sql<number>`coalesce(sum(${creditTransactionsTable.creditValue}), 0)` })
    .from(creditTransactionsTable)
    .where(and(eq(creditTransactionsTable.memberId, memberId), eq(creditTransactionsTable.valid, true)));
  return Number(total) || 0;
}

export async function getTotalCreditsBulk(memberIds: number[]): Promise<Map<number, number>> {
  if (memberIds.length === 0) return new Map();
  const rows = await db
    .select({
      memberId: creditTransactionsTable.memberId,
      total: sql<number>`coalesce(sum(${creditTransactionsTable.creditValue}), 0)`,
    })
    .from(creditTransactionsTable)
    .where(eq(creditTransactionsTable.valid, true))
    .groupBy(creditTransactionsTable.memberId);
  const map = new Map<number, number>();
  for (const r of rows) map.set(r.memberId, Number(r.total) || 0);
  return map;
}

export async function getAllLevels() {
  return db.select().from(levelsTable);
}

export async function getDepartmentName(departmentId: number | null): Promise<string | null> {
  if (!departmentId) return null;
  const [d] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, departmentId)).limit(1);
  return d ? d.nameAr : null;
}

export async function getMemberByMemberId(memberId: string): Promise<Member | undefined> {
  const [m] = await db.select().from(membersTable).where(eq(membersTable.memberId, memberId)).limit(1);
  return m;
}

export async function getMemberByDbId(id: number): Promise<Member | undefined> {
  const [m] = await db.select().from(membersTable).where(eq(membersTable.id, id)).limit(1);
  return m;
}
