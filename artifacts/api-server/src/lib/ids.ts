import { db, membersTable, creditTransactionsTable, achievementsTable } from "@workspace/db";
import { sql } from "drizzle-orm";

interface MaxRow {
  max: number | string | null;
}

// db.execute() with the node-postgres ("pg") driver resolves to a
// QueryResult, whose rows live on `.rows` -- NOT a bare array. (Some other
// drivers, e.g. neon-http/postgres.js, return the rows array directly, which
// is an easy mistake to carry over.)
async function queryMax(query: ReturnType<typeof sql>): Promise<number> {
  const result = (await db.execute(query)) as unknown as { rows: MaxRow[] };
  const max = result.rows[0]?.max;
  return Number(max) || 0;
}

/**
 * Generates the next sequential PMC member ID (e.g. PMC-260001) for the
 * given membership year suffix ("26" for 2026).
 *
 * Note: this reads the current max and formats the next value without a
 * row-level lock (an aggregate-only query can't take `FOR UPDATE`). The
 * memberId column has a DB-level unique constraint, so a genuine collision
 * from two near-simultaneous member creations fails safely with a 23505
 * conflict rather than corrupting data -- it just isn't retried
 * automatically. For a small club's admin-driven creation flow this window
 * is negligible; a dedicated sequence/counter table would close it entirely
 * if higher concurrency is ever expected.
 */
export async function generateMemberId(yearSuffix = "26"): Promise<string> {
  const prefix = `PMC-${yearSuffix}`;
  const max = await queryMax(sql`
    select coalesce(max(cast(substring(member_id from (${prefix.length + 1})::integer) as integer)), 0) as max
    from ${membersTable}
    where member_id like ${prefix + "%"}
  `);
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

export async function generateTransactionId(): Promise<string> {
  const max = await queryMax(sql`
    select coalesce(max(cast(substring(transaction_id from (5)::integer) as integer)), 0) as max
    from ${creditTransactionsTable}
    where transaction_id like 'TXN-%'
  `);
  return `TXN-${String(max + 1).padStart(6, "0")}`;
}

export async function generateAchievementId(): Promise<string> {
  const max = await queryMax(sql`
    select coalesce(max(cast(substring(achievement_id from (5)::integer) as integer)), 0) as max
    from ${achievementsTable}
    where achievement_id like 'ACH-%'
  `);
  return `ACH-${String(max + 1).padStart(6, "0")}`;
}
