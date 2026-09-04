import {
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
};

export const departmentsTable = pgTable("pmc_departments", {
  id: serial("id").primaryKey(),
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en").notNull(),
  active: boolean("active").notNull().default(true),
  ...timestamps,
});

export const membersTable = pgTable(
  "pmc_members",
  {
    id: serial("id").primaryKey(),
    clerkUserId: text("clerk_user_id").unique(),
    memberId: text("member_id").notNull().unique(),
    fullName: text("full_name").notNull(),
    email: text("email").notNull(),
    universityId: text("university_id"),
    phoneNumber: text("phone_number"),
    college: text("college"),
    major: text("major"),
    departmentId: integer("department_id").references(() => departmentsTable.id),
    role: text("role").notNull().default("MEMBER"),
    membershipStatus: text("membership_status").notNull().default("PENDING"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    accountActivated: boolean("account_activated").notNull().default(false),
    emailVerified: boolean("email_verified").notNull().default(false),
    active: boolean("active").notNull().default(true),
    rejectionNote: text("rejection_note"),
    ...timestamps,
  },
  (table) => ({
    emailUnique: uniqueIndex("pmc_members_email_unique").on(table.email),
    universityIdUnique: uniqueIndex("pmc_members_university_id_unique").on(table.universityId),
    // DB-level backstop for "exactly one active DEPARTMENT_LEADER per
    // department": application code (see lib/leaderAssignment.ts) is the
    // primary enforcement via transactional demote-then-promote, but this
    // partial unique index makes it impossible to *ever* commit two leader
    // rows for the same department, even from a bug or a future write path
    // that forgets to call the helper.
    oneLeaderPerDepartment: uniqueIndex("pmc_members_one_leader_per_department")
      .on(table.departmentId)
      .where(sql`role = 'DEPARTMENT_LEADER'`),
  }),
);

export const creditTypesTable = pgTable("pmc_credit_types", {
  id: serial("id").primaryKey(),
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en").notNull(),
  creditValue: integer("credit_value").notNull(),
  active: boolean("active").notNull().default(true),
  requiresPresidentApproval: boolean("requires_president_approval").notNull().default(false),
  description: text("description"),
  ...timestamps,
});

export const levelsTable = pgTable("pmc_levels", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en").notNull(),
  symbol: text("symbol").notNull(),
  minCredits: integer("min_credits").notNull().default(0),
  active: boolean("active").notNull().default(true),
  requiresProjectCompletion: boolean("requires_project_completion").notNull().default(false),
  requiresLeadership: boolean("requires_leadership").notNull().default(false),
  requiresPresidentApproval: boolean("requires_president_approval").notNull().default(false),
  ...timestamps,
});

export const creditTransactionsTable = pgTable("pmc_credit_transactions", {
  id: serial("id").primaryKey(),
  transactionId: text("transaction_id").notNull().unique(),
  memberId: integer("member_id").notNull().references(() => membersTable.id),
  creditTypeId: integer("credit_type_id").notNull().references(() => creditTypesTable.id),
  creditValue: integer("credit_value").notNull(),
  activityName: text("activity_name").notNull(),
  activityType: text("activity_type").notNull(),
  activityDate: date("activity_date", { mode: "string" }).notNull(),
  addedByUserId: integer("added_by_user_id").notNull().references(() => membersTable.id),
  approvedByUserId: integer("approved_by_user_id").references(() => membersTable.id),
  note: text("note"),
  valid: boolean("valid").notNull().default(true),
  ...timestamps,
});

export const achievementsTable = pgTable("pmc_achievements", {
  id: serial("id").primaryKey(),
  achievementId: text("achievement_id").notNull().unique(),
  memberId: integer("member_id").notNull().references(() => membersTable.id),
  type: text("type").notNull(),
  title: text("title").notNull(),
  activity: text("activity").notNull(),
  achievementDate: date("achievement_date", { mode: "string" }).notNull(),
  approvedByUserId: integer("approved_by_user_id").notNull().references(() => membersTable.id),
  description: text("description"),
  ...timestamps,
});

export const auditLogsTable = pgTable("pmc_audit_logs", {
  id: serial("id").primaryKey(),
  action: text("action").notNull(),
  actorMemberId: integer("actor_member_id").references(() => membersTable.id),
  target: text("target").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
});

export const settingsTable = pgTable("pmc_settings", {
  id: serial("id").primaryKey(),
  membershipYear: text("membership_year").notNull().default("2026–27"),
  publicProfilesDefaultVisible: boolean("public_profiles_default_visible").notNull().default(true),
  ...timestamps,
});

export const insertDepartmentSchema = createInsertSchema(departmentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertMemberSchema = createInsertSchema(membersTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCreditTypeSchema = createInsertSchema(creditTypesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertLevelSchema = createInsertSchema(levelsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCreditTransactionSchema = createInsertSchema(creditTransactionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertAchievementSchema = createInsertSchema(achievementsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertAuditLogSchema = createInsertSchema(auditLogsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertSettingsSchema = createInsertSchema(settingsTable).omit({ id: true, createdAt: true, updatedAt: true });

export type Department = typeof departmentsTable.$inferSelect;
export type Member = typeof membersTable.$inferSelect;
export type CreditType = typeof creditTypesTable.$inferSelect;
export type Level = typeof levelsTable.$inferSelect;
export type CreditTransaction = typeof creditTransactionsTable.$inferSelect;
export type Achievement = typeof achievementsTable.$inferSelect;
export type AuditLog = typeof auditLogsTable.$inferSelect;
export type ClubSettings = typeof settingsTable.$inferSelect;
export type InsertDepartment = z.infer<typeof insertDepartmentSchema>;
export type InsertMember = z.infer<typeof insertMemberSchema>;
export type InsertCreditType = z.infer<typeof insertCreditTypeSchema>;
export type InsertLevel = z.infer<typeof insertLevelSchema>;
export type InsertCreditTransaction = z.infer<typeof insertCreditTransactionSchema>;
export type InsertAchievement = z.infer<typeof insertAchievementSchema>;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type InsertSettings = z.infer<typeof insertSettingsSchema>;