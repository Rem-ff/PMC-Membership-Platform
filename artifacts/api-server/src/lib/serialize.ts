import type { Member, Department, CreditType, Level, CreditTransaction, Achievement } from "@workspace/db";
import { computeLevel } from "./levels";

export function toCurrentUser(
  member: Member,
  department: Department | null | undefined,
  totalCredits: number,
  levels: Level[],
) {
  return {
    id: String(member.id),
    memberId: member.memberId,
    fullName: member.fullName,
    email: member.email,
    college: member.college ?? null,
    major: member.major ?? null,
    role: member.role,
    membershipStatus: member.active ? member.membershipStatus : "INACTIVE",
    department: department ? department.nameAr : null,
    credits: totalCredits,
    level: computeLevel(totalCredits, levels),
    joinedAt: member.joinedAt,
    emailVerified: member.emailVerified,
  };
}

export function toMemberRecord(
  member: Member,
  department: Department | null | undefined,
  totalCredits: number,
  levels: Level[],
) {
  return {
    ...toCurrentUser(member, department, totalCredits, levels),
    accountActivated: member.accountActivated,
    active: member.active,
  };
}

export function toDepartmentDTO(
  department: Department,
  memberCount: number,
  leader: { memberId: string; name: string } | null,
) {
  return {
    id: department.id,
    nameAr: department.nameAr,
    nameEn: department.nameEn,
    active: department.active,
    memberCount,
    leader,
  };
}

export function toCreditTypeDTO(ct: CreditType) {
  return {
    id: ct.id,
    nameAr: ct.nameAr,
    nameEn: ct.nameEn,
    creditValue: ct.creditValue,
    active: ct.active,
    requiresPresidentApproval: ct.requiresPresidentApproval,
    description: ct.description ?? null,
  };
}

export function toLevelDTO(level: Level) {
  return {
    id: level.id,
    key: level.key,
    nameAr: level.nameAr,
    nameEn: level.nameEn,
    symbol: level.symbol,
    minCredits: level.minCredits,
    active: level.active,
    requiresProjectCompletion: level.requiresProjectCompletion,
    requiresLeadership: level.requiresLeadership,
    requiresPresidentApproval: level.requiresPresidentApproval,
  };
}

export function toTransactionDTO(
  tx: CreditTransaction,
  creditType: CreditType,
  member: Member,
  addedBy: Member,
  approvedBy: Member | null,
) {
  return {
    id: tx.transactionId,
    memberId: member.memberId,
    memberName: member.fullName,
    creditType: toCreditTypeDTO(creditType),
    creditValue: tx.creditValue,
    activityName: tx.activityName,
    activityType: tx.activityType,
    awardedBy: addedBy.fullName,
    approvedBy: approvedBy ? approvedBy.fullName : null,
    note: tx.note ?? null,
    createdAt: tx.createdAt,
    valid: tx.valid,
  };
}

export function toAchievementDTO(ach: Achievement, member: Member, approvedBy: Member) {
  return {
    id: ach.achievementId,
    memberId: member.memberId,
    type: ach.type,
    title: ach.title,
    activity: ach.activity,
    date: ach.achievementDate,
    approvedBy: approvedBy.fullName,
    description: ach.description ?? null,
  };
}
