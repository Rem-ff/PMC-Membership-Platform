/**
 * Idempotent production seed for the PMC platform.
 *
 * Seeds ONLY:
 *   - official departments
 *   - default credit types
 *   - default levels
 *   - club settings (singleton row)
 *   - the President's member record (Remas Alzahrani), keyed by
 *     PMC_PRESIDENT_EMAIL
 *
 * Never seeds demo/mock members. Safe to re-run: every insert is
 * "insert if not exists" keyed on a natural unique field, so running this
 * against a database that already has data will not duplicate rows or
 * clobber edits made from the President Dashboard (departments/credit
 * types/levels/settings are only inserted when missing, never overwritten).
 *
 * Run with: pnpm --filter @workspace/db run seed
 */
import { db, pool } from "./index";
import {
  departmentsTable,
  creditTypesTable,
  levelsTable,
  settingsTable,
  membersTable,
} from "./schema/pmc";
import { eq } from "drizzle-orm";

const DEPARTMENTS = [
  { nameEn: "Management", nameAr: "الإدارة" },
  { nameEn: "Events", nameAr: "الفعاليات" },
  { nameEn: "Public Relations & Partnerships", nameAr: "العلاقات العامة والشراكات" },
  { nameEn: "Media", nameAr: "الإعلام" },
  { nameEn: "Documentation & Accreditation", nameAr: "التوثيق والاعتماد" },
  { nameEn: "Human Resources", nameAr: "الموارد البشرية" },
];

const CREDIT_TYPES = [
  { nameEn: "Challenge Completed", nameAr: "إنجاز تحدٍ", creditValue: 10 },
  { nameEn: "Project Participation", nameAr: "مشاركة في مشروع", creditValue: 15 },
  { nameEn: "Project Completed", nameAr: "إتمام مشروع", creditValue: 20 },
  { nameEn: "Project Leadership", nameAr: "قيادة مشروع", creditValue: 30 },
  { nameEn: "Idea Implemented", nameAr: "تنفيذ فكرة", creditValue: 15 },
  { nameEn: "External Representation", nameAr: "تمثيل خارجي", creditValue: 20 },
  {
    nameEn: "Exceptional Contribution",
    nameAr: "مساهمة استثنائية",
    creditValue: 10,
    requiresPresidentApproval: true,
  },
];

// Sensible temporary thresholds -- fully editable later from the President
// Dashboard (PATCH /president/levels/:id). Nothing here is hard-coded into
// the frontend; this is the single seeded source of truth.
const LEVELS = [
  { key: "INITIATE", nameEn: "Initiate", nameAr: "ابدأ", symbol: "○", minCredits: 0 },
  { key: "BUILD", nameEn: "Build", nameAr: "ابنِ", symbol: "⬡", minCredits: 40 },
  { key: "LEAD", nameEn: "Lead", nameAr: "قُد", symbol: "▲", minCredits: 100, requiresLeadership: true },
  { key: "DELIVER", nameEn: "Deliver", nameAr: "أنجز", symbol: "◆", minCredits: 180, requiresProjectCompletion: true },
  { key: "IMPACT", nameEn: "Impact", nameAr: "أثّر", symbol: "✦", minCredits: 300, requiresPresidentApproval: true },
];

async function upsertDepartment(row: typeof DEPARTMENTS[number]) {
  const [existing] = await db.select().from(departmentsTable).where(eq(departmentsTable.nameEn, row.nameEn)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(departmentsTable).values(row).returning();
  return created;
}

async function upsertCreditType(row: typeof CREDIT_TYPES[number]) {
  const [existing] = await db.select().from(creditTypesTable).where(eq(creditTypesTable.nameEn, row.nameEn)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(creditTypesTable).values(row).returning();
  return created;
}

async function upsertLevel(row: typeof LEVELS[number]) {
  const [existing] = await db.select().from(levelsTable).where(eq(levelsTable.key, row.key)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(levelsTable).values(row).returning();
  return created;
}

async function generateMemberId(): Promise<string> {
  const year = "26";
  // Look at existing PMC-26XXXX ids to find the next sequence number.
  const all = await db.select({ memberId: membersTable.memberId }).from(membersTable);
  const prefix = `PMC-${year}`;
  const max = all
    .map((m) => m.memberId)
    .filter((id) => id.startsWith(prefix))
    .map((id) => parseInt(id.slice(prefix.length), 10))
    .filter((n) => !Number.isNaN(n))
    .reduce((a, b) => Math.max(a, b), 0);
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

async function main() {
  console.log("Seeding PMC platform...");

  for (const d of DEPARTMENTS) {
    await upsertDepartment(d);
  }
  console.log(`Departments ready: ${DEPARTMENTS.length}`);

  for (const c of CREDIT_TYPES) {
    await upsertCreditType(c);
  }
  console.log(`Credit types ready: ${CREDIT_TYPES.length}`);

  for (const l of LEVELS) {
    await upsertLevel(l);
  }
  console.log(`Levels ready: ${LEVELS.length}`);

  const [existingSettings] = await db.select().from(settingsTable).limit(1);
  if (!existingSettings) {
    await db.insert(settingsTable).values({});
    console.log("Club settings row created.");
  }

  const presidentEmail = process.env.PMC_PRESIDENT_EMAIL;
  if (!presidentEmail) {
    console.warn(
      "PMC_PRESIDENT_EMAIL is not set -- skipping President record. " +
        "Set it and re-run this seed to create the President's member record.",
    );
  } else {
    const email = presidentEmail.trim().toLowerCase();
    const [existingPresident] = await db
      .select()
      .from(membersTable)
      .where(eq(membersTable.email, email))
      .limit(1);

    if (existingPresident) {
      // Make sure the seeded account always keeps PRESIDENT role/approval,
      // even if PMC_PRESIDENT_EMAIL was rotated onto an existing row.
      if (existingPresident.role !== "PRESIDENT" || existingPresident.membershipStatus !== "APPROVED") {
        await db
          .update(membersTable)
          .set({ role: "PRESIDENT", membershipStatus: "APPROVED", active: true })
          .where(eq(membersTable.id, existingPresident.id));
        console.log("Existing member promoted to PRESIDENT.");
      } else {
        console.log("President record already present.");
      }
    } else {
      const managementDept = await db
        .select()
        .from(departmentsTable)
        .where(eq(departmentsTable.nameEn, "Management"))
        .limit(1);

      const memberId = await generateMemberId();
      await db.insert(membersTable).values({
        memberId,
        fullName: "Remas Alzahrani",
        email,
        college: null,
        major: null,
        departmentId: managementDept[0]?.id ?? null,
        role: "PRESIDENT",
        membershipStatus: "APPROVED",
        accountActivated: false, // flips true on first real sign-in via Clerk
        emailVerified: false,
        active: true,
      });
      console.log(`President record created: ${memberId} (${email})`);
    }
  }

  console.log("Seed complete.");
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
