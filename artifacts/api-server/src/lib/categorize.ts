export type ActivityBucket = "projects" | "challenges" | "leadership" | "other";

/**
 * The UI's activity filter (all/projects/challenges/leadership/other) is
 * coarser than the credit type catalog, so transactions are bucketed by
 * matching keywords in the credit type's English name rather than by a
 * separate stored column -- keeps the credit type list freely editable by
 * the President without needing to also maintain a parallel bucket field.
 */
export function categorizeActivity(creditTypeNameEn: string): ActivityBucket {
  const n = creditTypeNameEn.toLowerCase();
  if (n.includes("project")) return "projects";
  if (n.includes("challenge")) return "challenges";
  if (n.includes("leadership") || n.includes("lead")) return "leadership";
  return "other";
}
