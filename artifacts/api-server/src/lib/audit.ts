import { db, auditLogsTable } from "@workspace/db";

type Executor = Pick<typeof db, "insert">;

/**
 * Records an audit log entry. Pass `executor` (a transaction client) when
 * this is called from inside `db.transaction(async (tx) => ...)` so the
 * audit row commits or rolls back atomically with the change it describes --
 * otherwise it defaults to the global `db` connection, which is fine for
 * audit calls made outside any transaction.
 */
export async function logAudit(
  params: {
    action: string;
    actorMemberId: number | null;
    target: string;
    metadata?: Record<string, unknown>;
  },
  executor: Executor = db,
) {
  await executor.insert(auditLogsTable).values({
    action: params.action,
    actorMemberId: params.actorMemberId,
    target: params.target,
    metadata: params.metadata ?? {},
  });
}
