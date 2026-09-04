import type { Level } from "@workspace/db";

export interface LevelSummaryDTO {
  key: string;
  nameEn: string;
  nameAr: string;
  symbol: string;
  current: number;
  nextThreshold: number | null;
  progressPercent: number;
}

/**
 * Derives a member's level from their total valid credits. Levels are
 * ordered by minCredits ascending; the member's level is the highest
 * active level whose threshold they've reached. `minCredits` is the ONLY
 * field that gates progression.
 *
 * The `requiresProjectCompletion` / `requiresLeadership` /
 * `requiresPresidentApproval` flags on a Level are NOT enforced anywhere in
 * this codebase -- they are informational metadata the President can set and
 * see (e.g. "this level is meant to also imply project completion"), with no
 * automated or process-level check behind them in this version. A member
 * reaches a level on credits alone regardless of these flags. See README
 * "Level requirement flags" for the reasoning and what a real enforcement
 * pass would need. (This is unrelated to CreditType.requiresPresidentApproval,
 * which IS enforced -- see routes/leader.ts.)
 */
export function computeLevel(totalCredits: number, levels: Level[]): LevelSummaryDTO {
  const active = [...levels].filter((l) => l.active).sort((a, b) => a.minCredits - b.minCredits);

  if (active.length === 0) {
    return {
      key: "INITIATE",
      nameEn: "Initiate",
      nameAr: "ابدأ",
      symbol: "○",
      current: totalCredits,
      nextThreshold: null,
      progressPercent: 0,
    };
  }

  let current = active[0];
  let next: Level | undefined;
  for (let i = 0; i < active.length; i++) {
    if (totalCredits >= active[i].minCredits) {
      current = active[i];
      next = active[i + 1];
    }
  }

  const progressPercent = next
    ? Math.max(
        0,
        Math.min(
          100,
          Math.round(
            ((totalCredits - current.minCredits) / (next.minCredits - current.minCredits)) * 100,
          ),
        ),
      )
    : 100;

  return {
    key: current.key,
    nameEn: current.nameEn,
    nameAr: current.nameAr,
    symbol: current.symbol,
    current: totalCredits,
    nextThreshold: next ? next.minCredits : null,
    progressPercent,
  };
}
