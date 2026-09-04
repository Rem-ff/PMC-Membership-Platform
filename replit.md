# PMC Membership Platform

Real, database-backed membership platform for the Project Management Club
(نادي إدارة المشاريع) at Imam Mohammad Ibn Saud Islamic University. Members
sign in with Clerk, get matched against a President-managed member record,
and see their live PMC Credits, level, achievements, and digital membership
card. Department Leaders manage only their own department; the President has
full administrative control plus her own normal member profile.

## Run & Operate

```
pnpm install
cp .env.example .env               # fill in DATABASE_URL, Clerk keys, PMC_PRESIDENT_EMAIL
pnpm --filter @workspace/db run push        # create tables from the schema
pnpm --filter @workspace/db run seed        # seed departments, credit types, levels, settings, President
pnpm --filter @workspace/api-server run dev # API on :5000
pnpm --filter pmc-membership run dev        # frontend (check its package.json for the exact script name)
```

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-server run test` — authorization + workflow tests (needs `TEST_DATABASE_URL`)
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec after editing `lib/api-spec/openapi.yaml`
- Required env: see `.env.example`

## Verified build/test status (this pass)

Actually executed in a real environment with PostgreSQL 16 installed, not just reviewed:

- `pnpm install` — clean.
- `pnpm run typecheck` (all 9 workspace packages, including `api-server` and `pmc-membership`) — **passes with zero errors.**
- `pnpm run build` for `@workspace/db`, `@workspace/api-server`, and `pmc-membership` — **all build successfully** (frontend needs `PORT`, `BASE_PATH`, `VITE_CLERK_PUBLISHABLE_KEY` at build time).
- `pnpm --filter @workspace/api-server run test` against a real, freshly-migrated Postgres database — **30/30 tests pass**: 15 authorization/workflow tests (`authorization.test.ts`) plus a dedicated 15-step, step-labeled walk of the full mandated acceptance scenario (`acceptance.e2e.test.ts`) — President creates a member, assigns a department leader, the leader awards credits, the member's total is verified via a fresh query (simulating refresh), the President sees the same transaction, the audit log records every step, and every cross-role/cross-department access attempt is rejected with 403.
- The seed script (`pnpm --filter @workspace/db run seed`) was run against a clean database and correctly creates the 6 departments, 7 credit types, 5 levels, settings row, and the President record from `PMC_PRESIDENT_EMAIL`.

Real bugs this process caught and fixed (kept here since they're informative if similar patterns get added later):
- `db.execute(sql\`...substring(x from $1)...\`)`: with an untyped parameter, Postgres resolved `substring` to its regex-pattern overload instead of the integer-position overload, silently returning `NULL` for every row instead of erroring. Fixed with an explicit `::integer` cast on the position argument.
- `sql\`${col} = ANY(${jsArray})\`` doesn't bind a JS array as a Postgres array; replaced with Drizzle's `inArray()` helper.
- Mounting `leaderRouter`/`presidentRouter`/etc. all flat at `/api` meant each router's own `router.use(requireMember, requireRole(...))` guard fired for *every* request that reached that router instance, not just its own routes — so the leader router's `DEPARTMENT_LEADER` guard was intercepting `/president/*` requests before they ever reached the president router. Fixed by mounting each domain router under its own path prefix (`/api/leader`, `/api/president`, `/api/me`, `/api/auth`) with routes defined relative to that prefix.
- `noImplicitReturns` violations across most route handlers (an early `return res.status(400)...` guard followed by a bare final `res.json(...)` without `return`) — real compile errors once the workspace's strict tsconfig was actually run against this code.

No test was skipped or faked; every failure above was chased down to a real root cause and fixed, then re-verified with a clean database.


### One-time President setup

1. Set `PMC_PRESIDENT_EMAIL` to Remas Alzahrani's real email in `.env`.
2. Run the seed script (`pnpm --filter @workspace/db run seed`) — this creates her `PRESIDENT` member record with `accountActivated: false`.
3. In Clerk, she signs up / signs in with that exact email (email or Google, whichever she verifies).
4. On first authenticated request, `attachMember` links her Clerk account to that member row automatically and flips `accountActivated` to `true`. No manual DB edit needed after that.
5. Any later member the President creates through **إضافة عضو** goes through the same automatic linking the first time that person signs in with the email the President entered.

## Stack

- pnpm workspaces, Node.js 22+, TypeScript 5.9
- Frontend: React + Vite, Wouter, TanStack Query, Clerk React, generated API client (`lib/api-client-react`)
- API: Express 5, Clerk server SDK (`@clerk/express`)
- DB: PostgreSQL + Drizzle ORM (schema-push workflow, no generated SQL migration files by design of this repo — see Gotchas)
- Validation: Zod (`zod/v4`) on every mutating endpoint
- API contract: OpenAPI (`lib/api-spec/openapi.yaml`) + Orval-generated types/hooks
- Tests: Vitest + Supertest against a real (disposable) Postgres DB, Clerk mocked at the module boundary

## Where things live

- `lib/db/src/schema/pmc.ts` — source of truth for all tables (departments, members, credit types, levels, credit transactions, achievements, audit logs, settings)
- `lib/db/src/seed.ts` — idempotent seed: departments, credit types, levels, settings, President record. Never seeds demo members.
- `artifacts/api-server/src/middlewares/requireAuth.ts` — resolves the Clerk session to a PMC member (`attachMember`), then gates on active+approved status (`requireMember`) and role (`requireRole`). This is the ONLY place authorization is enforced — every route relies on it, never on the frontend hiding a button.
- `artifacts/api-server/src/routes/` — `auth.ts` (activation check), `me.ts` (personal dashboard/credits/achievements/card), `member.ts` (public QR-verification profile, no auth), `leader.ts` (own-department only), `president.ts` (full admin surface + CSV export + audit log + credit reversal).
- `artifacts/api-server/src/lib/` — `ids.ts` (collision-safe PMC-260001-style IDs), `levels.ts` (derives level from summed valid credit transactions — never trusts a stored total), `serialize.ts` (DB row → API DTO mapping), `audit.ts`, `queries.ts`.
- `lib/api-spec/openapi.yaml` / `lib/api-zod/src/generated/` — API contract and matching Zod types. `MemberInput` now includes `universityId` (see Architecture decisions).

## Architecture decisions

- **Credits are a ledger, never a stored total.** Every `/me`, `/leader/department`, `/president/*` response computes a member's credit total by summing `pmc_credit_transactions` where `valid = true`. Reversal just flips `valid` to `false` on the row (`POST /president/transactions/:transactionId/reverse`); nothing is ever hard-deleted, and totals update automatically everywhere.
- **A Clerk session alone never grants access.** `attachMember` only *links* a verified Clerk identity to an existing member row (matched by email) or reads an existing link; it never creates a member. `requireMember` then rejects anyone without an `APPROVED` + `active` row. This is what makes `/auth/activation/check` and all the Arabic pending/rejected/suspended messages work, and is also the IDOR boundary: a Leader's own `req.member.departmentId` (not a client-supplied value) is what every `leader/*` query filters on.
- **`universityId` was added to `pmc_members`** (nullable, unique) because the member-creation form and duplicate-check requirements need it and the original schema didn't have a column for it. It's optional at the DB level (so the seeded President row doesn't need one) but required by the `POST /president/members` validator.
- **Department-leader replacement is automatic and audited.** `PATCH /president/members/:memberId` with `role: DEPARTMENT_LEADER` demotes any existing leader of that department to `MEMBER` in the same request and writes a `leader_demoted` audit row — the frontend should still confirm with the President before sending that request (per the UX requirements), but the server enforces "one active leader per department" regardless of what the client sends. This is enforced through every write path that can produce a `DEPARTMENT_LEADER` (`POST /president/members`, `PATCH /president/members/:memberId`, and `PATCH /president/departments/:id` with `leaderMemberId`) via a single shared helper (`lib/leaderAssignment.ts`), always called inside the same `db.transaction()` as the promotion itself, with a partial unique index (`pmc_members_one_leader_per_department`, on `department_id` `WHERE role = 'DEPARTMENT_LEADER'`) as a DB-level backstop that makes it structurally impossible to ever commit two leader rows for the same department, even from a future write path that forgets to call the helper.
- **Level requirement flags (`requiresProjectCompletion` / `requiresLeadership` / `requiresPresidentApproval` on `Level`) are informational only, not enforced.** They're stored, editable by the President, and returned by the API, but `computeLevel()` (`lib/levels.ts`) derives a member's level purely from `minCredits` against their summed valid credits — nothing in this codebase checks whether a member has actually completed a project or led a team before granting a level that has those flags set. This is a deliberate scope decision rather than an oversight: building real enforcement would mean either (a) tying specific achievement types to specific levels and requiring at least one matching achievement before that level can be reached, or (b) a manual President-approval step before a level takes effect, and neither exists in this version. The OpenAPI schema and code comments say this explicitly so nothing in the API or docs implies these flags gate progression. If real enforcement is wanted later, achievements already have a `type` field (`PROJECT`, `LEADERSHIP`, etc.) that's the natural hook for option (a). This is unrelated to `CreditType.requiresPresidentApproval`, which **is** enforced: `POST /leader/credits` returns 403 if the selected credit type requires President approval, and only `POST /president/credits` can award it.
- **Activation lookup (`POST /auth/activation/check`) requires the name to match too, not just the email.** Matching by email alone would let anyone who knows or guesses another approved member's email address probe their membership status. The name comparison is normalized (trimmed, internal whitespace collapsed, lowercased — a no-op for Arabic script but harmless) rather than exact-byte, so legitimate whitespace differences don't block a real member. A name mismatch is indistinguishable from "no member with that email" in the response (same status, same generic message, `memberId: null`) so the endpoint never confirms an email is registered to someone who doesn't already know the correct name on file. This is intentionally separate from `attachMember`'s Clerk-session linking (`middlewares/requireAuth.ts`), which matches by verified email only — by that point the person holds a real verified Clerk session for that address, which is a stronger signal than a self-reported name.
- **`publicProfilesDefaultVisible` now actually gates `GET /member/:memberId`.** When off, the endpoint returns the same 404 it would for a nonexistent member ID, rather than a distinct "profiles disabled" response, so it never confirms or denies that a given member ID exists while the setting is off.

- **No generated SQL migration files.** This repo's existing `@workspace/db` package only ships a `drizzle-kit push` script (schema-driven, no migration history) — that convention was kept rather than introducing a second, inconsistent migration mechanism. For a team environment where you want reviewable migration diffs, switch to `drizzle-kit generate` + `migrate` and keep the same `schema/pmc.ts` as the source of truth.

## Product

- **Member**: personal dashboard, membership card with QR verification link, PMC Credits history, achievements, level + progress. All values are live from the DB; nothing is mocked after login.
- **Department Leader**: everything a Member has (`مساحتي`) plus a department-scoped console (`قسم ...`) — member list/search, awarding credits (value comes from the selected credit type, never client-supplied) and achievements to members of their own department only.
- **President**: everything a Member has (`مساحتي`) plus `مساحة الرئيس` — live overview stats, full member management (create/edit/status/department/role with duplicate email + university ID checks), department + leader assignment, credit types, levels, settings, full audit log, CSV export, and credit reversal.

## User preferences

- Preserve the existing approved UI/visual design exactly; this work is backend + data-wiring only, not a redesign.
- Arabic is the primary UI language; user-facing errors/success messages are Arabic (see the message maps in each route file for the exact approved copy from the spec).

## Gotchas

- **Frontend wiring is the largest remaining piece of work.** The backend above is real and complete for the endpoints listed in section 25 of the spec, but the React pages under `artifacts/pmc-membership/src` still need to be swept for hard-coded/mock data (e.g. a sample member like "مها العتيبي") and pointed at the generated API client's hooks. Do this page-by-page and keep testing against the seeded President + a real test member after each page, per the acceptance test in the spec.
- **Tests need a disposable Postgres database.** `TEST_DATABASE_URL` should point at an empty database; run `drizzle-kit push --force` against it before `pnpm --filter @workspace/api-server run test`. Never point it at production.
- **`clerkProxyMiddleware` only runs in production** (see the comment in that file) — in dev, Clerk talks to its Frontend API directly, which is expected.
- Regenerate `lib/api-client-react` with `pnpm --filter @workspace/api-spec run codegen` after any further edits to `lib/api-spec/openapi.yaml`, so the frontend's generated hooks stay in sync with the backend (this was done by hand for `MemberInput.universityId` in this pass — a full codegen run will pick up the rest cleanly).
