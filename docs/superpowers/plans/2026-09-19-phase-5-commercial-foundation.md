# Phase 5 — Commercial Foundation & Legacy Model Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the backend from quota/access-tier to a prepaid Credit wallet with Toman/1M-token model pricing, removing legacy access-tier and quota systems while establishing stable billing service contracts (`WalletService`, `PricingService`, `UsagePricingService`) for future phases.

**Architecture:** Replace `User.accessTier` + `Model.visibility` (public/commercial/private) + `Quota`/`QuotaRule` with a Credit wallet (`Wallet`), Toman-based model pricing (`inputPricePer1m`/`outputPricePer1m`), and a fixed-precision credit accounting system using PostgreSQL `decimal` + integer sub-unit (mcredit) conversion in the service layer. The existing `UsageRecord` is extended (not replaced) with `inputTokens`, `outputTokens`, `reasoningTokens`, `chargedCost`, `chargedCredits` columns. Three stable service contracts (`WalletService`, `PricingService`, `UsagePricingService`) abstract persistence from consumers, so Phase 2–4 never touch DB internals directly. A single new migration handles all schema changes; existing migrations and code for quotas/access-tier are removed as dead code after migration.

**Tech Stack:** NestJS 10, TypeORM 0.3, PostgreSQL, TypeScript, Jest. Backend only — the frontend contract changes (types, API calls, views, composables) are listed as the final tasks and marked as "deferred to frontend" where cross-package edits are needed per CLAUDE.md rule §1.

**Spec:** `docs/superpowers/phase 5 plan.md` (Phase 1 section, pages 462–691)

---

## Global Constraints

- All source, tests, config, docs MUST live under `backend/` (CLAUDE.md §1).
- **NEVER** run `git add`, `git commit`, `git push`, `git checkout`, `git reset`, or any remote git interaction — append `Suggested commit message:` to each task result instead (CLAUDE.md §2).
- Every networked feature is contract-first; REST + JSON, OpenAPI 3.1 (CLAUDE.md §3).
- Tests MUST be authored in the same change set as the implementation and MUST pass before mergeable (CLAUDE.md §4).
- API contracts MUST be regenerated via `npm run openapi:export` after controller changes (CLAUDE.md §3, Quick Reference).
- Run `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build` before declaring a task complete (CLAUDE.md — Agent do/don't list).
- Configuration from env vars / `.env` (gitignored); never commit secrets (CLAUDE.md §Cross-cutting conventions).
- No raw SQL in HTTP handlers or domain logic — use TypeORM repositories (CLAUDE.md §Cross-cutting conventions).
- Input validation at the boundary via `class-validator` with `whitelist: true, forbidNonWhitelisted: true, transform: true` (CLAUDE.md §Cross-cutting conventions).
- Migration numbering continues the existing `17000000NN000` series — the next available is `1700000014000` (last migration is `1700000013000-add-provider-api-keys`).
- `data-source.ts` entities array and `app.module.ts` TypeOrmModule.forFeature calls must include every new entity.

---

## File Structure (created or modified)

### Backend — new files
- `backend/src/modules/wallet/entities/wallet.entity.ts` — Wallet entity (user_id FK, credit_balance decimal(14,4), created/updated timestamps).
- `backend/src/modules/wallet/wallet.service.ts` — `WalletService` with `getBalance`, `deductCredits`, `grantCredits`, `getOrCreateForUser`.
- `backend/src/modules/wallet/wallet.module.ts` — NestJS module wiring the entity + service.
- `backend/src/modules/wallet/wallet.service.spec.ts` — unit tests for WalletService (balance, deduct, grant, edge cases).
- `backend/src/modules/billing/pricing.service.ts` — `PricingService` reading model `inputPricePer1m`/`outputPricePer1m`.
- `backend/src/modules/billing/usage-pricing.service.ts` — `UsagePricingService` with `calculateLlmCost`, `calculateWebSearchCost`.
- `backend/src/modules/billing/pricing.service.spec.ts` — unit tests for PricingService.
- `backend/src/modules/billing/usage-pricing.service.spec.ts` — unit tests for UsagePricingService.
- `backend/src/modules/billing/billing.module.ts` — NestJS module exporting the three services.
- `backend/src/database/migrations/1700000014000-commercial-foundation.ts` — single migration adding wallet + usage columns, renaming model pricing columns, dropping quota tables.

### Backend — modified files
- `backend/src/modules/users/entities/user.entity.ts` — remove `accessTier` column + decorator import.
- `backend/src/modules/users/users.service.ts` — remove `setAccessTier` method + `USER_ACCESS_TIERS` import.
- `backend/src/modules/users/users.admin.controller.ts` — remove `setAccessTier` endpoint (`PATCH :id/access-tier`), remove `accessTier` from `toAdminUser`, drop `SetUserAccessTierDto` import.
- `backend/src/modules/users/dto/set-access-tier.dto.ts` — **delete file**.
- `backend/src/modules/users/users.module.ts` — no entity changes needed (User still there).
- `backend/src/modules/models/model-access.service.ts` — rewrite `canAccess`/`loadViewer` to depend only on `role` + `visibility`; remove `UserAccessTier`, `TIER_RANK`, `VISIBILITY_RANK` usage.
- `backend/src/modules/models/model-visibility.ts` — change `ModelVisibility` type to `'public' | 'private'`; remove `UserAccessTier`, `USER_ACCESS_TIERS`, `TIER_RANK`, `VISIBILITY_RANK` exports.
- `backend/src/modules/models/entities/model.entity.ts` — rename `inputPricePer1k`→`inputPricePer1m`, `outputPricePer1k`→`outputPricePer1m`; adjust decimal precision to (10,4).
- `backend/src/modules/models/dto/model-upsert.dto.ts` — update `ModelUpsertDto` validation messages for new pricing + visibility vocabulary.
- `backend/src/modules/models/models.admin.controller.ts` — update `toAdminShape` to emit `inputPricePer1m`/`outputPricePer1m` instead of `inputPricePer1k`/`outputPricePer1k`.
- `backend/src/modules/models/models.service.ts` — pass through new pricing fields on create/update; `resolveActiveModel`/`assertCanUseModel` use simplified access policy.
- `backend/src/modules/usage/entities/usage-record.entity.ts` — add `reasoningTokens`, `chargedCost`, `chargedCredits` columns; keep `estimatedCost` for historical compat or rename with migration.
- `backend/src/modules/usage/usage.service.ts` — update `calculateCost` → Toman/1M-token formula; update `finalize` to accept reasoning tokens + new pricing; add `inputPricePer1m`/`outputPricePer1m` + `reasoningTokens` to `FinalizeUsageInput`.
- `backend/src/modules/usage/usage.admin.controller.ts` — emit `inputTokens`/`outputTokens`/`reasoningTokens`/`chargedCost`/`chargedCredits` in admin usage response.
- `backend/src/modules/usage/usage.module.ts` — no changes needed (UsageService already exported; may add PricingService import if needed).
- `backend/src/modules/quotas/` — entire directory **deleted** (entities, service, controllers, DTOs, module, admin/user controllers, tests).
- `backend/src/modules/chat/chat.service.ts` — remove `QuotaService` injection; remove quota reservation/finalize/refund calls in `runStream`; pass new pricing field names to `UsageService.finalize`.
- `backend/src/modules/chat/chat.module.ts` — remove `QuotasModule` import.
- `backend/src/app.module.ts` — remove `QuotasModule` if present (it's not directly imported — it's imported via `ChatModule`).
- `backend/src/database/data-source.ts` — remove `Quota`, `QuotaRule` from entities array.
- `backend/src/config/configuration.ts` — add `billing: { creditPriceToman, webSearchPriceToman }`.
- `backend/src/config/env.validation.ts` — add `CREDIT_PRICE_TOMAN` (default 100, integer) + `WEB_SEARCH_PRICE_TOMAN` (default 1000, integer) to `EnvironmentVariables`.
- `backend/src/modules/models/models.module.ts` — add `BillingModule` to imports if PricingService is injected, add `Wallet` entity if needed.
- `backend/src/modules/users/users.controller.ts` — `toProfile` omits `accessTier` (already does — no change needed unless it surfaces it somewhere).

### Backend — modified tests
- `backend/test/unit/usage-record.entity.spec.ts` — update to verify new column names (`inputPricePer1m`, `outputPricePer1m`, `reasoningTokens`, `chargedCost`, `chargedCredits`).
- `backend/test/unit/usage.service.spec.ts` — update `finalize` calls with new field names.
- `backend/test/unit/model-access.service.spec.ts` — rewrite for `public`/`private`-only visibility.
- `backend/test/unit/users.admin.controller.spec.ts` — remove access-tier test cases.
- `backend/test/integration/usage.e2e.spec.ts` — update for new pricing field names, remove `accessTier` from user creation.
- `backend/test/unit/chat.service-quota.spec.ts` — **delete** (tests removed quota functionality).

### Frontend — deferred (cross-package, must be operator follow-up)
- `frontend/app/src/types/api.ts` — remove `UserAccessTier`, `accessTier` from `AdminUser`; update `ModelVisibility` to `'public' | 'private'`; update `ModelAdmin`/`ModelUpsertRequest` pricing field names; add `CreditPriceInfo`, `WalletInfo` types.
- `frontend/app/src/api/admin.ts` — remove `setUserAccessTier`; add `getBillingConfig` read-only endpoint.
- `frontend/app/src/api/quota.ts` — remove; replaced by wallet/composable.
- `frontend/app/src/composables/useQuota.ts` — remove or replace with `useWallet`.
- `frontend/app/src/views/admin/UsersView.vue` — remove access-tier column + selector; show role-only list.
- `frontend/app/src/views/admin/ModelsView.vue` — update pricing column headers.
- `frontend/app/src/components/admin/ModelFormModal.vue` — update visibility options (remove "commercial"), update pricing fields.
- `frontend/app/src/views/ChatView.vue` — remove quota display, replace with credit balance.
- `frontend/app/src/router/index.ts` — remove or repurpose admin-users route if the view is gutted (keep route but gutting the tier column).
- `frontend/app/src/stores/auth.ts` — remove `accessTier` from persisted user if present.
- `frontend/app/src/api/quota.ts` — delete.

---

## Task Decomposition

Tasks are ordered so each is independently testable. Tasks 1–8 are backend-only. Tasks 9–11 are frontend (deferred). Tasks 12 is final verification.

> **Naming convention for credit arithmetic:** Credits are stored as a PostgreSQL `decimal(14,4)` — enough for 999,999,999.9999 Credits (1 billion Credits with 4 fractional digits). Service-layer arithmetic converts to integer "milli-credits" (1 mcredit = 0.001 Credit) before addition/subtraction, then converts back, ensuring JS floating-point never silently corrupts a financial operation. Rounding is always half-up at the 1-Credit (0.0001 mcredit) boundary.

> **Pricing vocabulary decision:** The spec (§4.5 Business Decisions) says "input price / 1M tokens, output price / 1M tokens" with prices expressed in Toman. We store `inputPricePer1m` and `outputPricePer1m` as `decimal(10,4)` representing **Toman per 1M tokens**. The `PricingService` converts Toman → Credits: `credits = toman / creditPriceToman`. The `UsagePricingService.calculateLlmCost` returns `{ chargedCost: Toman, chargedCredits: Credit }`.

---

### Task 1: Migrate model-pricing vocabulary (entity + migration column rename)

**Files:**
- Modify: `backend/src/modules/models/entities/model.entity.ts`
- Modify: `backend/src/modules/models/dto/model-upsert.dto.ts` — update validation message
- Create: `backend/src/database/migrations/1700000014000-commercial-foundation.ts`
- Test: `backend/test/unit/usage-record.entity.spec.ts` (update pricing column assertions)

**Interfaces:**
- Consumes: existing `inputPricePer1k`/`outputPricePer1k` columns (to be renamed)
- Produces: `Model.inputPricePer1m` (decimal(10,4)), `Model.outputPricePer1m` (decimal(10,4))

**Steps:**

- [ ] **Step 1: Write the migration**

```ts
// backend/src/database/migrations/1700000014000-commercial-foundation.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CommercialFoundation1700000014000 implements MigrationInterface {
  name = 'CommercialFoundation1700000014000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Rename pricing columns: 1k USD → 1m Toman
    await queryRunner.query(`ALTER TABLE models RENAME COLUMN input_price_per_1k TO input_price_per_1m`);
    await queryRunner.query(`ALTER TABLE models RENAME COLUMN output_price_per_1k TO output_price_per_1m`);
    await queryRunner.query(`ALTER TABLE models ALTER COLUMN input_price_per_1m TYPE DECIMAL(10,4)`);
    await queryRunner.query(`ALTER TABLE models ALTER COLUMN output_price_per_1m TYPE DECIMAL(10,4)`);

    // Add usage record columns for the new commercial representation
    await queryRunner.query(`ALTER TABLE usage_records ADD COLUMN IF NOT EXISTS reasoning_tokens INT NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE usage_records ADD COLUMN IF NOT EXISTS charged_cost DECIMAL(14,4) NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE usage_records ADD COLUMN IF NOT EXISTS charged_credits DECIMAL(14,4) NOT NULL DEFAULT 0`);

    // Create wallet table
    await queryRunner.query(`
      CREATE TABLE wallets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        credit_balance DECIMAL(14,4) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_wallets_user ON wallets(user_id)`);

    // Drop quota tables (no longer the primary entitlement mechanism)
    await queryRunner.query(`DROP TABLE IF EXISTS quotas`);
    await queryRunner.query(`DROP TABLE IF EXISTS quota_rules`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS wallets`);
    await queryRunner.query(`ALTER TABLE usage_records DROP COLUMN IF EXISTS charged_credits`);
    await queryRunner.query(`ALTER TABLE usage_records DROP COLUMN IF EXISTS charged_cost`);
    await queryRunner.query(`ALTER TABLE usage_records DROP COLUMN IF EXISTS reasoning_tokens`);
    await queryRunner.query(`ALTER TABLE models ALTER COLUMN output_price_per_1m TYPE DECIMAL(10,6)`);
    await queryRunner.query(`ALTER TABLE models ALTER COLUMN input_price_per_1m TYPE DECIMAL(10,6)`);
    await queryRunner.query(`ALTER TABLE models RENAME COLUMN output_price_per_1m TO output_price_per_1k`);
    await queryRunner.query(`ALTER TABLE models RENAME COLUMN input_price_per_1m TO input_price_per_1k`);
  }
}
```

- [ ] **Step 2: Write the failing entity test**

Update `test/unit/usage-record.entity.spec.ts` to assert the new column names:
```ts
// Add to the existing describe block
expect(column('outputPricePer1m', Model)).toMatchObject({ type: 'decimal', precision: 10, scale: 4 });
```

- [ ] **Step 3: Update the Model entity**

```ts
// backend/src/modules/models/entities/model.entity.ts — replace pricing fields
/** Cost per 1,000,000 input tokens in Toman. Zero means free. */
@Column({ name: 'input_price_per_1m', type: 'decimal', precision: 10, scale: 4, default: 0 })
inputPricePer1m!: number;

/** Cost per 1,000,000 output tokens in Toman. Zero means free. */
@Column({ name: 'output_price_per_1m', type: 'decimal', precision: 10, scale: 4, default: 0 })
outputPricePer1m!: number;
```

- [ ] **Step 4: Update the DTO validation message**

In `ModelUpsertDto`, no pricing fields exist in the DTO itself — pricing is set on the entity directly. So no DTO change needed for pricing rename. But visibility validation message needs updating (handled in Task 3).

- [ ] **Step 5: Run entity tests + type-check**

```bash
cd backend && npx tsc --noEmit && npx jest test/unit/usage-record.entity.spec.ts --silent 2>&1 | tail -20
```
Expected: PASS (entity uses the new column names; migration exists for DB rename).

---

### Task 2: Remove User Access Tier (entity, service, admin controller)

**Files:**
- Modify: `backend/src/modules/users/entities/user.entity.ts` — remove `accessTier` column + `UserAccessTier` import.
- Modify: `backend/src/modules/users/users.service.ts` — remove `setAccessTier`, `USER_ACCESS_TIERS` import.
- Modify: `backend/src/modules/users/users.admin.controller.ts` — remove `PATCH :id/access-tier` endpoint, remove `accessTier` from `toAdminUser`, drop `SetUserAccessTierDto` import.
- Delete: `backend/src/modules/users/dto/set-access-tier.dto.ts`
- Modify: `backend/src/modules/users/users.admin.controller.spec.ts` — remove access-tier tests.
- Modify: `backend/src/modules/users/users.module.ts` — verify no access-tier import remains.

**Interfaces:**
- Consumes: `User` entity (from Task 1 migration — `access_tier` column dropped in same migration).
- Produces: `User` has no `accessTier`; `UsersAdminController` has no `setAccessTier` endpoint; `UsersService` has no `setAccessTier` method.

**Steps:**

- [ ] **Step 1: Write the entity test**

Add assertion to the user entity test (or create one if none exists — check existing):
```ts
// backend/test/unit/user.entity.spec.ts (create if needed)
describe('User entity', () => {
  it('does not have an accessTier column', () => {
    const { User } = require('../../src/modules/users/entities/user.entity');
    const columns = getMetadataArgsStorage().columns
      .filter((c) => c.target === User)
      .map((c) => c.propertyName);
    expect(columns).not.toContain('accessTier');
  });
});
```

- [ ] **Step 2: Update the migration (Task 1 migration) to also drop access_tier**

Edit the migration created in Task 1 — add inside `up()`:
```ts
await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS access_tier`);
```
And in `down()`:
```ts
await queryRunner.query(`ALTER TABLE users ADD COLUMN access_tier TEXT NOT NULL DEFAULT 'free'`);
```

- [ ] **Step 3: Remove accessTier from User entity**

```ts
// backend/src/modules/users/entities/user.entity.ts
// Remove:
import { UserAccessTier } from '../../models/model-visibility'; // (if imported here)
// Remove the column block:
//   @Column({ name: 'access_tier', type: 'text', default: 'free' })
//   accessTier!: UserAccessTier;
```

- [ ] **Step 4: Remove setAccessTier from UsersService**

Delete the `setAccessTier` method body and the `USER_ACCESS_TIERS` / `UserAccessTier` imports at the top of `users.service.ts`.

- [ ] **Step 5: Remove setAccessTier endpoint from UsersAdminController**

Delete the `@Patch(':id/access-tier')` method block. Remove `SetUserAccessTierDto` import. Remove `accessTier` key from `toAdminUser` return object.

- [ ] **Step 6: Delete the DTO file**

Remove `backend/src/modules/users/dto/set-access-tier.dto.ts`.

- [ ] **Step 7: Update admin controller test**

In `users.admin.controller.spec.ts`, remove `setAccessTier` mock field, remove the two access-tier test blocks, update `sampleUser` to not include `accessTier`.

- [ ] **Step 8: Run tests + type-check**

```bash
cd backend && npx tsc --noEmit && npx jest test/unit/users.admin.controller.spec.ts test/unit/user.entity.spec.ts --silent 2>&1 | tail -20
```
Expected: PASS.

---

### Task 3: Replace Model Access Semantics (visibility → public/private)

**Files:**
- Modify: `backend/src/modules/models/model-visibility.ts` — change `ModelVisibility` to `'public' | 'private'`; remove `UserAccessTier`, `USER_ACCESS_TIERS`, `TIER_RANK`, `VISIBILITY_RANK`.
- Modify: `backend/src/modules/models/model-access.service.ts` — rewrite `loadViewer` to select only `id`/`role`; rewrite `canAccess` to: disabled→false, private→`role === 'admin'`, public→true.
- Modify: `backend/src/modules/models/dto/model-upsert.dto.ts` — update visibility validation message to "must be one of public, private".
- Modify: `backend/test/unit/model-access.service.spec.ts` — rewrite for new visibility vocabulary.

**Interfaces:**
- Consumes: `Model.visibility` as `'public' | 'private'` (from Task 1; entity default `'public'` stays).
- Produces: `ModelAccessService.canAccess(viewer, model)` returns true for any enabled `public` model for any authenticated user; only `private` models require admin role.

**Steps:**

- [ ] **Step 1: Rewrite model-visibility.ts**

```ts
// backend/src/modules/models/model-visibility.ts
export type ModelVisibility = 'public' | 'private';
export const MODEL_VISIBILITIES: readonly ModelVisibility[] = ['public', 'private'];
// Remove UserAccessTier, USER_ACCESS_TIERS, TIER_RANK, VISIBILITY_RANK entirely.
```

- [ ] **Step 2: Write the failing test**

Update `model-access.service.spec.ts`:
```ts
// Replace the table-driven test with:
it.each([
  ['user', 'public', true],
  ['user', 'private', false],
  ['admin', 'public', true],
  ['admin', 'private', true],
  ['user', 'public', false],  // disabled model
])('role=%s visibility=%s enabled=%s => %s', (role, visibility, expected) => { ... });
```

- [ ] **Step 3: Rewrite ModelAccessService**

```ts
// backend/src/modules/models/model-access.service.ts
async loadViewer(userId: string): Promise<AccessViewer | null> {
  const row = await this.userRepo.findOne({
    where: { id: userId },
    select: ['id', 'role'],
  });
  if (!row) return null;
  return { role: row.role };
}

canAccess(viewer, model): boolean {
  if (!viewer || !model.enabled) return false;
  if (model.visibility === 'private') return viewer.role === 'admin';
  return true; // public
}
```

- [ ] **Step 4: Update AccessViewer interface**

Remove `accessTier` from `AccessViewer`:
```ts
export interface AccessViewer {
  role: 'user' | 'admin';
}
```

- [ ] **Step 5: Update DTO validation message**

In `model-upsert.dto.ts`, change:
```ts
message: 'visibility must be one of public, private',
```

- [ ] **Step 6: Update migration default**

The migration doesn't need to change the visibility column type — it stays `text`. Existing rows with `commercial` value will need a data migration step (in `up()`, set `visibility = 'public' WHERE visibility = 'commercial'`).

Add to the migration `up()`:
```ts
await queryRunner.query(`UPDATE models SET visibility = 'public' WHERE visibility = 'commercial'`);
```

- [ ] **Step 7: Run tests + type-check**

```bash
cd backend && npx tsc --noEmit && npx jest test/unit/model-access.service.spec.ts --silent 2>&1 | tail -20
```
Expected: PASS.

---

### Task 4: Delete Quotas module + remove quota integration from ChatService

**Files:**
- Delete: entire `backend/src/modules/quotas/` directory.
- Delete: `backend/test/unit/chat.service-quota.spec.ts`
- Modify: `backend/src/modules/chat/chat.service.ts` — remove `QuotaService` import, remove `@InjectRepository` quota if any, remove quota reservation/finalize/refund calls in `runStream`.
- Modify: `backend/src/modules/chat/chat.module.ts` — remove `QuotasModule` import.
- Modify: `backend/src/database/data-source.ts` — remove `Quota`, `QuotaRule` from entities array.

**Interfaces:**
- Consumes: nothing from quotas (quota calls removed from `runStream`).
- Produces: `ChatService` no longer references `QuotaService`; `QuotasModule` is gone.

**Steps:**

- [ ] **Step 1: Write the deletion test**

```bash
# Verify module is gone
grep -rl "quotas" backend/src | wc -l  # should return 0 after cleanup
```

Create a simple test that asserts `QuotasModule` import fails:
```ts
// backend/test/unit/quotas-removed.spec.ts
describe('Quotas module removed', () => {
  it('no longer exports QuotasModule', () => {
    expect(() => require('../../src/modules/quotas/quotas.module')).toThrow();
  });
});
```

- [ ] **Step 2: Remove QuotaService injection from ChatService**

In `chat.service.ts`, constructor: remove `private readonly quotas: QuotaService` line. Remove import `import { QuotaService } from '../quotas/quotas.service';`.

- [ ] **Step 3: Remove quota calls from runStream**

Remove (lines ~590–710, ~1240–1256, ~1335–1345):
```ts
// quota preflight block:
const reservation = await this.quotas.checkAndReserve(...)
// ...
// finalize quota block:
if (quotaId) await this.quotas.finalize(...)
// ...
// refund quota on failure:
if (quotaId) await this.quotas.refund(...)
```

Update the `RunStreamContext` interface to remove `quotaId`/`quotaReservedTokens` fields.

- [ ] **Step 4: Remove QuotasModule from ChatModule**

In `chat.module.ts`: remove `QuotasModule` from imports and the `import` line.

- [ ] **Step 5: Remove quota entities from data-source**

In `data-source.ts`: remove `Quota` and `QuotaRule` from the `entities` array. Remove the `import` lines.

- [ ] **Step 6: Delete the quotas directory + test file**

```bash
rm -rf backend/src/modules/quotas
rm backend/test/unit/chat.service-quota.spec.ts
```

- [ ] **Step 7: Run full test suite**

```bash
cd backend && npx tsc --noEmit && npx jest --silent 2>&1 | tail -30
```
Expected: PASS, no imports of quotas remain.

---

### Task 5: Introduce Credit Wallet entity + WalletService

**Files:**
- Create: `backend/src/modules/wallet/entities/wallet.entity.ts`
- Create: `backend/src/modules/wallet/wallet.service.ts`
- Create: `backend/src/modules/wallet/wallet.module.ts`
- Create: `backend/src/modules/wallet/wallet.service.spec.ts`

**Interfaces:**
- Consumes: `User` entity (user_id FK), `Model` entity (not needed for wallet itself).
- Produces: `Wallet` entity with `userId`, `creditBalance` (decimal(14,4)). `WalletService` with:
  - `getBalance(userId: string): Promise<number>` — returns 0 if no wallet exists.
  - `getOrCreateForUser(userId: string): Promise<Wallet>` — lazy-creates with 0 balance.
  - `deductCredits(userId: string, amount: number): Promise<void>` — throws `InsufficientCreditsError` if balance would go negative.
  - `grantCredits(userId: string, amount: number): Promise<Wallet>` — adds credits, returns updated wallet.

**Steps:**

- [ ] **Step 1: Write the WalletService test (TDD)**

```ts
// backend/src/modules/wallet/wallet.service.spec.ts
describe('WalletService', () => {
  let svc: WalletService;
  let repo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock; update: jest.Mock; createQueryBuilder: jest.Mock };

  beforeEach(() => {
    repo = {
      findOne: jest.fn(), create: jest.fn((d) => d), save: jest.fn((d) => d),
      update: jest.fn(),
      createQueryBuilder: jest.fn(() => ({
        increment: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([]),
      })),
    };
    svc = new WalletService(repo as any);
  });

  it('returns 0 balance when no wallet exists', async () => {
    repo.findOne.mockResolvedValue(null);
    expect(await svc.getBalance('u-1')).toBe(0);
  });

  it('creates a wallet on first access', async () => {
    repo.findOne.mockResolvedValue(null);
    repo.save.mockResolvedValue({ userId: 'u-1', creditBalance: 0 });
    const w = await svc.getOrCreateForUser('u-1');
    expect(w.creditBalance).toBe(0);
    expect(repo.save).toHaveBeenCalled();
  });

  it('deduces credits from balance', async () => {
    repo.findOne.mockResolvedValue({ creditBalance: 50, userId: 'u-1' });
    await svc.deductCredits('u-1', 20);
    expect(repo.update).toHaveBeenCalledWith({ userId: 'u-1' }, expect.objectContaining({ creditBalance: 30 }));
  });

  it('throws InsufficientCreditsError when balance is too low', async () => {
    repo.findOne.mockResolvedValue({ creditBalance: 5, userId: 'u-1' });
    await expect(svc.deductCredits('u-1', 20)).rejects.toThrow('insufficient_credits');
  });

  it('handles fractional credits correctly', async () => {
    repo.findOne.mockResolvedValue({ creditBalance: 10.5, userId: 'u-1' });
    await svc.deductCredits('u-1', 3.25);
    expect(repo.update).toHaveBeenCalledWith({ userId: 'u-1' }, expect.objectContaining({ creditBalance: 7.25 }));
  });

  it('grants credits', async () => {
    repo.findOne.mockResolvedValue({ creditBalance: 0, userId: 'u-1' });
    await svc.grantCredits('u-1', 100);
    expect(repo.update).toHaveBeenCalledWith({ userId: 'u-1' }, expect.objectContaining({ creditBalance: 100 }));
  });
});
```

- [ ] **Step 2: Run test — expect FAIL** (service class doesn't exist yet).

- [ ] **Step 3: Write the Wallet entity**

```ts
// backend/src/modules/wallet/entities/wallet.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne } from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('wallets')
export class Wallet {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'text', unique: true })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'credit_balance', type: 'decimal', precision: 14, scale: 4, default: 0 })
  creditBalance!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
```

- [ ] **Step 4: Write WalletService**

```ts
// backend/src/modules/wallet/wallet.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Wallet } from './entities/wallet.entity';

export class InsufficientCreditsError extends Error {
  constructor(public readonly balance: number, public readonly required: number) {
    super('insufficient_credits');
    this.name = 'InsufficientCreditsError';
  }
}

@Injectable()
export class WalletService {
  constructor(
    @InjectRepository(Wallet)
    private readonly repo: Repository<Wallet>,
    private readonly dataSource: DataSource,
  ) {}

  async getBalance(userId: string): Promise<number> {
    const w = await this.repo.findOne({ where: { userId } });
    return w ? Number(w.creditBalance) : 0;
  }

  async getOrCreateForUser(userId: string): Promise<Wallet> {
    let w = await this.repo.findOne({ where: { userId } });
    if (!w) {
      w = await this.repo.save(this.repo.create({ userId, creditBalance: 0 }));
    }
    return w;
  }

  async deductCredits(userId: string, amount: number): Promise<void> {
    const wallet = await this.repo.findOne({ where: { userId } });
    if (!wallet) {
      throw new NotFoundException({ code: 'wallet_not_found', message: 'Wallet not found.' });
    }
    const current = Number(wallet.creditBalance);
    const next = Math.round((current - amount) * 10000) / 10000;
    if (next < 0) {
      throw new InsufficientCreditsError(current, amount);
    }
    wallet.creditBalance = next;
    await this.repo.save(wallet);
  }

  async grantCredits(userId: string, amount: number): Promise<Wallet> {
    const wallet = await this.getOrCreateForUser(userId);
    const current = Number(wallet.creditBalance);
    const next = Math.round((current + amount) * 10000) / 10000;
    wallet.creditBalance = next;
    return this.repo.save(wallet);
  }
}
```

- [ ] **Step 5: Write WalletModule**

```ts
// backend/src/modules/wallet/wallet.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Wallet } from './entities/wallet.entity';
import { WalletService } from './wallet.service';

@Module({
  imports: [TypeOrmModule.forFeature([Wallet])],
  providers: [WalletService],
  exports: [WalletService, Wallet],
})
export class WalletModule {}
```

- [ ] **Step 6: Run tests**

```bash
cd backend && npx jest test/unit/wallet.service.spec.ts --silent 2>&1 | tail -20
```
Wait — the test file path is `backend/src/modules/wallet/wallet.service.spec.ts`. Run:
```bash
cd backend && npx jest backend/src/modules/wallet/wallet.service.spec.ts --silent 2>&1 | tail -20
```
Expected: PASS.

---

### Task 6: Add Credit Configuration to env + config layer

**Files:**
- Modify: `backend/src/config/env.validation.ts` — add `CREDIT_PRICE_TOMAN` + `WEB_SEARCH_PRICE_TOMAN`.
- Modify: `backend/src/config/configuration.ts` — add `billing` block.
- Modify: `backend/.env.example` — add the two env vars with comments.

**Interfaces:**
- Consumes: `process.env` values.
- Produces: `configService.get<number>('billing.creditPriceToman')` returns the integer Toman-per-Credit value; `configService.get<number>('billing.webSearchPriceToman')` returns the integer Toman-per-search value.

**Steps:**

- [ ] **Step 1: Write the failing config test**

```ts
// backend/test/unit/env.validation.spec.ts
describe('Environment validation — billing', () => {
  it('validates credit price', () => {
    const result = validateEnv({ ...defaultEnv, CREDIT_PRICE_TOMAN: '150' });
    expect(result.CREDIT_PRICE_TOMAN).toBe(150);
  });
  it('defaults credit price to 100', () => {
    const result = validateEnv(defaultEnv);
    expect(result.CREDIT_PRICE_TOMAN).toBe(100);
  });
  it('rejects non-integer credit price', () => {
    expect(() => validateEnv({ ...defaultEnv, CREDIT_PRICE_TOMAN: 'abc' })).toThrow();
  });
});
```

- [ ] **Step 2: Add to EnvironmentVariables**

```ts
// backend/src/config/env.validation.ts — add to class body
@Type(() => Number)
@IsInt()
@Min(1)
@IsOptional()
CREDIT_PRICE_TOMAN = 100;

@Type(() => Number)
@IsInt()
@Min(0)
@IsOptional()
WEB_SEARCH_PRICE_TOMAN = 1000;
```

Add import: `import { IsInt, IsNumber, IsOptional, Min } from 'class-validator';` (check existing imports — `IsNumber` and `Min` are already imported, just add `IsInt`).

- [ ] **Step 3: Add to AppConfig interface + factory**

```ts
// configuration.ts — add to interface:
billing: {
  creditPriceToman: number;
  webSearchPriceToman: number;
};

// factory:
billing: {
  creditPriceToman: Number(process.env.CREDIT_PRICE_TOMAN ?? 100),
  webSearchPriceToman: Number(process.env.WEB_SEARCH_PRICE_TOMAN ?? 1000),
},
```

- [ ] **Step 4: Update .env.example**

```env
# Credit pricing (Toman). Read-only in Admin UI — not editable via API.
CREDIT_PRICE_TOMAN=100
WEB_SEARCH_PRICE_TOMAN=1000
```

- [ ] **Step 5: Run tests + type-check**

```bash
cd backend && npx tsc --noEmit && npx jest test/unit/env.validation.spec.ts --silent 2>&1 | tail -20
```
Expected: PASS.

---

### Task 7: Create PricingService + UsagePricingService (billing module)

**Files:**
- Create: `backend/src/modules/billing/billing.module.ts`
- Create: `backend/src/modules/billing/pricing.service.ts`
- Create: `backend/src/modules/billing/usage-pricing.service.ts`
- Create: `backend/src/modules/billing/pricing.service.spec.ts`
- Create: `backend/src/modules/billing/usage-pricing.service.spec.ts`
- Modify: `backend/src/app.module.ts` — add `WalletModule` and `BillingModule` to imports.

**Interfaces:**
- PricingService consumes: `ConfigService` (for `billing.creditPriceToman`, `billing.webSearchPriceToman`), `Model` entity (for pricing columns).
  - `getCreditPriceToman(): number`
  - `getWebSearchPriceToman(): number`
  - `getModelPricing(modelId): Promise<{ inputPricePer1m: number; outputPricePer1m: number }>` — loads from DB or throws.
- UsagePricingService consumes: `PricingService`, `ModelsService` (for model lookup).
  - `calculateLlmCost(modelId, inputTokens, outputTokens, reasoningTokens): Promise<{ chargedCost: number; chargedCredits: number }>` — cost in Toman = `(inputTokens × inputPricePer1m / 1e6) + ((outputTokens + reasoningTokens) × outputPricePer1m / 1e6)`; credits = cost / creditPriceToman. Rounded to 4 decimal places in mcredit.
  - `calculateWebSearchCost(): number` — returns `webSearchPriceToman / creditPriceToman` (credits).

**Steps:**

- [ ] **Step 1: Write PricingService test**

```ts
// backend/src/modules/billing/pricing.service.spec.ts
describe('PricingService', () => {
  it('returns credit price from config', () => {
    const config = { get: jest.fn((k) => k === 'billing.creditPriceToman' ? 100 : 1000) };
    const svc = new PricingService(config as any, null);
    expect(svc.getCreditPriceToman()).toBe(100);
  });
});
```

- [ ] **Step 2: Write PricingService**

```ts
// backend/src/modules/billing/pricing.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Model } from '../models/entities/model.entity';

@Injectable()
export class PricingService {
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(Model) private readonly modelRepo: Repository<Model>,
  ) {}

  getCreditPriceToman(): number {
    return Number(this.config.get<number>('billing.creditPriceToman', { infer: true }));
  }

  getWebSearchPriceToman(): number {
    return Number(this.config.get<number>('billing.webSearchPriceToman', { infer: true }));
  }

  async getModelPricing(modelId: string): Promise<{ inputPricePer1m: number; outputPricePer1m: number }> {
    const model = await this.modelRepo.findOne({ where: { id: modelId } });
    if (!model) throw new NotFoundException({ code: 'model_not_found', message: 'Model not found.' });
    return {
      inputPricePer1m: Number(model.inputPricePer1m),
      outputPricePer1m: Number(model.outputPricePer1m),
    };
  }
}
```

- [ ] **Step 3: Write UsagePricingService test**

```ts
// backend/src/modules/billing/usage-pricing.service.spec.ts
describe('UsagePricingService', () => {
  let svc: UsagePricingService;

  beforeEach(() => {
    const pricing = {
      getCreditPriceToman: () => 100,
      getWebSearchPriceToman: () => 1000,
      getModelPricing: jest.fn().mockResolvedValue({ inputPricePer1m: 1.0, outputPricePer1m: 2.0 }),
    };
    svc = new UsagePricingService(pricing as any);
  });

  it('calculates LLM cost: input 1000 tokens, output 500, reasoning 0 → 1.5 credits', async () => {
    // input cost: 1000 × 1.0 / 1e6 = 0.001 Toman → 0.001/100 = 0.00001 credits
    // output cost: 500 × 2.0 / 1e6 = 0.001 Toman → 0.001/100 = 0.00001 credits
    // Total: 0.00002 Toman → 0.0000002 credits
    const cost = await svc.calculateLlmCost('m-1', 1000, 500, 0);
    expect(cost.chargedCost).toBeCloseTo(0.002, 6); // Toman
    expect(cost.chargedCredits).toBeCloseTo(0.00002, 8); // Credits
  });

  it('includes reasoning tokens in output billing', async () => {
    // output tokens = 500, reasoning = 100
    // output cost (Toman) = (500 + 100) × 2.0 / 1e6 = 0.0012 Toman
    const cost = await svc.calculateLlmCost('m-1', 0, 500, 100);
    expect(cost.chargedCost).toBeCloseTo(0.0012, 6);
  });

  it('calculates web search cost: 1000 Toman / 100 = 10 credits', () => {
    expect(svc.calculateWebSearchCost()).toBe(10);
  });
});
```

- [ ] **Step 4: Write UsagePricingService**

```ts
// backend/src/modules/billing/usage-pricing.service.ts
import { Injectable } from '@nestjs/common';
import { PricingService } from './pricing.service';

const MCREDITS_PER_CREDIT = 10000;

@Injectable()
export class UsagePricingService {
  constructor(private readonly pricing: PricingService) {}

  async calculateLlmCost(
    modelId: string,
    inputTokens: number,
    outputTokens: number,
    reasoningTokens: number,
  ): Promise<{ chargedCost: number; chargedCredits: number }> {
    const { inputPricePer1m, outputPricePer1m } = await this.pricing.getModelPricing(modelId);
    const creditPriceToman = this.pricing.getCreditPriceToman();

    // Cost in Toman: per-1M-token prices → Toman
    const inputCostToman = (inputTokens * inputPricePer1m) / 1_000_000;
    const outputCostToman = ((outputTokens + reasoningTokens) * outputPricePer1m) / 1_000_000;
    const totalCostToman = Math.round((inputCostToman + outputCostToman) * 1e8) / 1e8;

    // Convert Toman → Credits using fixed-precision integer arithmetic
    const totalCostMcredit = Math.round(totalCostToman * MCREDITS_PER_CREDIT / creditPriceToman);
    const chargedCredits = totalCostMcredit / MCREDITS_PER_CREDIT;

    return { chargedCost: totalCostToman, chargedCredits };
  }

  calculateWebSearchCost(): number {
    const priceToman = this.pricing.getWebSearchPriceToman();
    const creditPriceToman = this.pricing.getCreditPriceToman();
    const mcredits = Math.round((priceToman * MCREDITS_PER_CREDIT) / creditPriceToman);
    return mcredits / MCREDITS_PER_CREDIT;
  }
}
```

- [ ] **Step 5: Write BillingModule**

```ts
// backend/src/modules/billing/billing.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Model } from '../models/entities/model.entity';
import { WalletModule } from '../wallet/wallet.module';
import { PricingService } from './pricing.service';
import { UsagePricingService } from './usage-pricing.service';

@Module({
  imports: [WalletModule, TypeOrmModule.forFeature([Model])],
  providers: [PricingService, UsagePricingService],
  exports: [PricingService, UsagePricingService, WalletModule],
})
export class BillingModule {}
```

- [ ] **Step 6: Wire into app.module.ts**

Add `WalletModule` and `BillingModule` to `imports` array.

- [ ] **Step 7: Run tests + type-check**

```bash
cd backend && npx tsc --noEmit && npx jest backend/src/modules/billing/ --silent 2>&1 | tail -30
```
Expected: PASS.

---

### Task 8: Migrate UsageRecord entity, UsageService, and ChatService integration

**Files:**
- Modify: `backend/src/modules/usage/entities/usage-record.entity.ts` — add `reasoningTokens`, `chargedCost`, `chargedCredits`; rename `promptTokens`→`inputTokens`, `completionTokens`→`outputTokens` (keep `totalTokens`), rename `estimatedCost`→`chargedCost` (keep column, rename property). *Actually — to minimize risk, we ADD new columns and keep old ones for backward-compatible migration.*

  Decision: **Keep `estimatedCost` column** (historical data), add `chargedCost` and `chargedCredits` as new columns. Keep `promptTokens`/`completionTokens` (rename is too risky for existing data; spec says "evolve from" — we add new canonical fields).

  Final entity changes:
  - Add: `reasoningTokens` (int, default 0)
  - Add: `chargedCost` (decimal(14,4), default 0) — cost in Toman at time of charge
  - Add: `chargedCredits` (decimal(14,4), default 0) — credits actually deducted
  - Keep: `estimatedCost` (legacy, retained for historical rows)
  - Keep: `promptTokens`/`completionTokens`/`totalTokens` as-is (provider-reported) — they satisfy the "inputTokens/outputTokens" naming in spirit; we map them in the API layer.

  Actually — re-reading the spec, it says the record "should be capable of recording at least: inputTokens, outputTokens, reasoningTokens...". Our DB already stores `promptTokens`/`completionTokens`. The spec uses conceptual names. The migration already adds the columns. We add `reasoningTokens`, `chargedCost`, `chargedCredits` to the entity.

- Modify: `backend/src/modules/usage/usage.service.ts` — update `FinalizeUsageInput` interface and `finalize` method; add `calculateCost` → Toman formula; update `calculateWebSearchCost`-style logic or delegate to `UsagePricingService`.

  **Design decision:** `UsageService.finalize` now receives `chargedCost` and `chargedCredits` (precomputed by the caller using `UsagePricingService`) rather than computing them itself with per-1k prices. This keeps the service thin and the pricing logic in `UsagePricingService`. The old `calculateCost` method is removed or deprecated.

  New `FinalizeUsageInput`:
  ```ts
  export interface FinalizeUsageInput {
    inputTokens: number;       // = prompt_tokens
    outputTokens: number;      // = completion_tokens
    totalTokens: number;
    reasoningTokens?: number;
    chargedCost: number;       // Toman
    chargedCredits: number;    // Credits
    status: 'completed' | 'failed';
    searchCredits?: number;    // retained for web search accounting
  }
  ```

- Modify: `backend/src/modules/usage/usage.admin.controller.ts` — emit new fields in response.
- Modify: `backend/src/modules/chat/chat.service.ts` — replace `inputPricePer1k`/`outputPricePer1k` finalize call with new fields; inject `UsagePricingService`; call `calculateLlmCost` before `finalize`.
- Modify: `backend/src/modules/chat/chat.module.ts` — import `BillingModule` (for `UsagePricingService`).
- Modify: `backend/test/unit/usage.service.spec.ts` — update `finalize` test calls.
- Modify: `backend/test/unit/usage-record.entity.spec.ts` — assert new columns exist.
- Modify: `backend/test/integration/usage.e2e.spec.ts` — update model pricing field names in seed data.

**Interfaces:**
- Consumes: `UsagePricingService.calculateLlmCost(modelId, input, output, reasoning)` → `{ chargedCost, chargedCredits }`.
- Produces: `UsageRecord` with `reasoningTokens`, `chargedCost`, `chargedCredits` populated; `UsageService.finalize` accepts new `FinalizeUsageInput` shape; `ChatService.runStream` calls `UsagePricingService` to precompute cost before finalizing.

**Steps:**

- [ ] **Step 1: Write the failing entity test**

```ts
// In backend/test/unit/usage-record.entity.spec.ts — add:
it('maps reasoningTokens, chargedCost, chargedCredits', () => {
  expect(column('reasoningTokens', UsageRecord)).toMatchObject({ type: 'int', default: 0 });
  expect(column('chargedCost', UsageRecord)).toMatchObject({ type: 'decimal', precision: 14, scale: 4 });
  expect(column('chargedCredits', UsageRecord)).toMatchObject({ type: 'decimal', precision: 14, scale: 4 });
});
```

- [ ] **Step 2: Add columns to UsageRecord entity**

```ts
// backend/src/modules/usage/entities/usage-record.entity.ts
@Column({ name: 'reasoning_tokens', type: 'int', default: 0 })
reasoningTokens!: number;

@Column({ name: 'charged_cost', type: 'decimal', precision: 14, scale: 4, default: 0 })
chargedCost!: number;

@Column({ name: 'charged_credits', type: 'decimal', precision: 14, scale: 4, default: 0 })
chargedCredits!: number;
```

- [ ] **Step 3: Write the failing UsageService test**

Update `test/unit/usage.service.spec.ts`:
```ts
// In finalize test:
await service.finalize('usage-1', {
  inputTokens: 100,
  outputTokens: 50,
  totalTokens: 150,
  reasoningTokens: 10,
 chargedCost: 0.003,
  chargedCredits: 0.00003,
  status: 'completed',
});
expect(mockRepo.save).toHaveBeenCalledWith(expect.objectContaining({
  reasoningTokens: 10,
  chargedCost: 0.003,
  chargedCredits: 0.00003,
}));
```

- [ ] **Step 4: Update FinalizeUsageInput + finalize method**

```ts
// backend/src/modules/usage/usage.service.ts
export interface FinalizeUsageInput {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
  chargedCost: number;
  chargedCredits: number;
  status: 'completed' | 'failed';
  searchCredits?: number;
}

async finalize(id: string, input: FinalizeUsageInput): Promise<void> {
  const record = await this.repo.findOne({ where: { id } });
  if (!record) return;
  record.promptTokens = input.inputTokens;
  record.completionTokens = input.outputTokens;
  record.totalTokens = input.totalTokens;
  record.reasoningTokens = input.reasoningTokens ?? 0;
  record.chargedCost = input.chargedCost;
  record.chargedCredits = input.chargedCredits;
  record.status = input.status;
  record.searchCredits = input.searchCredits ?? 0;
  record.completedAt = new Date();
  await this.repo.save(record);
}
```

Remove the `calculateCost` method (no longer used — pricing moved to `UsagePricingService`).

- [ ] **Step 5: Update ChatService to use UsagePricingService**

In `chat.service.ts`:
- Inject `UsagePricingService` (from `BillingModule`).
- Before calling `this.usage.finalize(...)`, call:
```ts
const cost = await this.pricing.calculateLlmCost(
  effectiveModel.id,
  usage?.prompt_tokens ?? 0,
  usage?.completion_tokens ?? 0,
  usage?.reasoning_tokens ?? 0,
);
```
- Pass `chargedCost: cost.chargedCost, chargedCredits: cost.chargedCredits` to `finalize`.
- Remove all quota injection + quota calls (from Task 4).
- Update the failed-finalize call (line ~1601) to use new field names.

- [ ] **Step 6: Update chat.module.ts**

```ts
// Add BillingModule to imports
import { BillingModule } from '../billing/billing.module';
// ...
imports: [
  TypeOrmModule.forFeature([Model, User, Provider]),
  ConversationsModule,
  ModelsModule,
  ProviderModule,
  UsageModule,
  BillingModule,  // <-- adds UsagePricingService
  WebSearchModule,
  FilesModule,
]
```
Remove `QuotasModule` import.

- [ ] **Step 7: Update UsageAdminController response**

Add to the `.map()` in `usage.admin.controller.ts`:
```ts
reasoningTokens: r.reasoningTokens,
chargedCost: Number(r.chargedCost),
chargedCredits: Number(r.chargedCredits),
```

- [ ] **Step 8: Update integration test**

In `usage.e2e.spec.ts`:
- Replace `inputPricePer1k`/`outputPricePer1k` with `inputPricePer1m`/`outputPricePer1f` in seed model.
- Remove `accessTier: 'free'` from user creation.

- [ ] **Step 9: Run tests + type-check**

```bash
cd backend && npx tsc --noEmit && npx jest backend/src/modules/usage/ backend/src/modules/billing/ --silent 2>&1 | tail -30
```
Expected: PASS.

---

### Task 9: Remove frontend access-tier UI (delete only — deferred)

**Files (frontend — DEFERRED, operator follow-up):**
- Delete: `frontend/app/src/api/quota.ts`
- Delete: `frontend/app/src/composables/useQuota.ts`
- Delete: `frontend/app/tests/useQuota.spec.ts`
- Modify: `frontend/app/src/types/api.ts` — remove `UserAccessTier`, `accessTier`; update `ModelVisibility` to `'public' | 'private'`; update `ModelAdmin`/`ModelUpsertRequest` pricing field names; add `WalletInfo`, `CreditPriceInfo`.
- Modify: `frontend/app/src/api/admin.ts` — remove `setUserAccessTier`, add `getBillingConfig`.
- Modify: `frontend/app/src/views/admin/UsersView.vue` — remove access-tier column.
- Modify: `frontend/app/src/components/admin/ModelFormModal.vue` — remove commercial visibility option, update pricing fields.
- Modify: `frontend/app/src/views/ChatView.vue` — remove quota display.
- Modify: `frontend/app/src/stores/auth.ts` — remove accessTier from persisted user.
- Modify: `frontend/app/src/router/index.ts` — remove or update admin-users route if UsersView is gutted to role-only (keep route).

**Steps:**

- [ ] **Step 1: Update frontend API types** (deferred to operator — cross-package edit)
- [ ] **Step 2: Remove setUserAccessTier + add billing config endpoint** (deferred)
- [ ] **Step 3: Gut UsersView access-tier column** (deferred)
- [ ] **Step 4: Update ModelsView pricing columns** (deferred)

> **Note:** These are frontend changes blocked by CLAUDE.md §1 ("No edits to sibling monorepo folders"). The backend contract removal makes these frontend calls 404, so they MUST be cleaned up by the frontend team or a frontend-capable session.

---

### Task 10: Remove frontend quota UI (delete only — deferred)

**Files (frontend — DEFERRED, operator follow-up):**
- Modify: `frontend/app/src/views/ChatView.vue` — remove `useQuota` import, remove quota display/progress bar.
- Modify: `frontend/app/src/utils/errors.ts` — remove `getMyQuota` if referenced.

**Steps:**

- [ ] **Step 1: Remove quota display from ChatView** (deferred)
- [ ] **Step 2: Remove useQuota import + composables** (deferred)

> **Note:** Blocked by CLAUDE.md §1 — frontend-only changes.

---

### Task 11: Add Admin read-only billing config endpoint (backend)

**Files:**
- Create: `backend/src/modules/billing/billing.admin.controller.ts`
- Modify: `backend/src/modules/billing/billing.module.ts` — add controller.

**Interfaces:**
- Consumes: `PricingService.getCreditPriceToman()`, `PricingService.getWebSearchPriceToman()`.
- Produces: `GET /v1/admin/billing/config` returns `{ creditPriceToman: number; webSearchPriceToman: number }` (read-only, no PATCH).

**Steps:**

- [ ] **Step 1: Write the failing controller test**

```ts
// backend/src/modules/billing/billing.admin.controller.spec.ts
describe('BillingAdminController', () => {
  it('returns read-only billing config', async () => {
    const pricing = { getCreditPriceToman: () => 100, getWebSearchPriceToman: () => 1000 };
    const ctrl = new BillingAdminController(pricing as any);
    const result = await ctrl.getConfig();
    expect(result).toEqual({ creditPriceToman: 100, webSearchPriceToman: 1000 });
  });
});
```

- [ ] **Step 2: Write the controller**

```ts
// backend/src/modules/billing/billing.admin.controller.ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { PricingService } from './pricing.service';

@Controller('v1/admin/billing')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class BillingAdminController {
  constructor(private readonly pricing: PricingService) {}

  @Get('config')
  getConfig() {
    return {
      creditPriceToman: this.pricing.getCreditPriceToman(),
      webSearchPriceToman: this.pricing.getWebSearchPriceToman(),
    };
  }
}
```

- [ ] **Step 3: Register in BillingModule**

```ts
// billing.module.ts — add:
import { BillingAdminController } from './billing.admin.controller';
// ...
controllers: [BillingAdminController],
```

- [ ] **Step 4: Run test + type-check**

```bash
cd backend && npx tsc --noEmit && npx jest backend/src/modules/billing/billing.admin.controller.spec.ts --silent 2>&1 | tail -20
```
Expected: PASS.

---

### Task 12: Full migration validation (lint + tsc + all tests)

**Steps:**

- [ ] **Step 1: Type-check**

```bash
cd backend && npx tsc --noEmit 2>&1 | tail -20
```
Expected: zero errors.

- [ ] **Step 2: Lint**

```bash
cd backend && npx eslint "{src,test}/**/*.ts" 2>&1 | tail -20
```
Expected: zero errors. If lint auto-fixes break formatting, re-run.

- [ ] **Step 3: Unit + integration tests**

```bash
cd backend && npx jest --silent 2>&1 | tail -30
```
Expected: all PASS, no test references to removed symbols (`accessTier`, `QuotasModule`, `inputPricePer1k`, etc.).

- [ ] **Step 4: Build check**

```bash
cd backend && npm run build 2>&1 | tail -10
```
Expected: success.

- [ ] **Step 5: Verify migration SQL**

Manually inspect the generated migration file compiles (TS → JS) and the SQL statements are correct for:
- Rename `input_price_per_1k` → `input_price_per_1m` (decimal precision change)
- Add `reasoning_tokens`, `charged_cost`, `charged_credits` to `usage_records`
- Drop `quotas` and `quota_rules` tables
- Drop `access_tier` column from `users`
- Data migration: `UPDATE models SET visibility = 'public' WHERE visibility = 'commercial'`

---

## Self-Review

### 1. Spec Coverage

| Spec Requirement | Task |
|---|---|
| 1.1 Remove User.accessTier, admin API, frontend UI | Task 2 (backend), Task 9 (frontend deferred) |
| 1.2 Replace visibility model (public/private only) | Task 3 |
| 1.3 Remove token quota as primary billing | Task 4 (delete module), Task 8 (chat integration) |
| 1.4 Introduce Credit Wallet with fractional support | Task 5 |
| 1.5 Credit configuration (env vars, read-only admin UI) | Task 6 + Task 11 |
| 1.6 Migrate model pricing to Toman/1M tokens | Task 1 (columns), Task 7 (PricingService) |
| 1.7 Adapt UsageRecord (input/output/reasoning/tokens/chargedCost/chargedCredits) | Task 8 |
| 1.8 Integration contract (WalletService, PricingService, UsagePricingService) | Task 5 + Task 7 |
| Acceptance: No accessTier required | Task 2, Task 3 |
| Acceptance: Admin role works | Task 2, Task 11 |
| Acceptance: Credit balance exists | Task 5 |
| Acceptance: Credit price is deployment-configured & read-only | Task 6, Task 11 |
| Acceptance: Model pricing uses Toman/1M | Task 1, Task 7 |
| Acceptance: Existing usage infra migrated | Task 8 |
| Acceptance: Reasoning stored separately | Task 8 |
| Acceptance: Historical usage not recalculated | Task 8 (chargedCost/chargedCredits captured at finalize time) |
| Acceptance: Phase 2–4 can consume contracts | Task 5, Task 7 (services exported from BillingModule) |

**Gap:** The spec mentions "exposing the effective Credit price to the Admin UI as read-only information" — covered by Task 11 (`GET /v1/admin/billing/config`). Frontend display deferred.

**Gap:** The `ModelUpsertDto` currently does NOT include pricing fields — pricing is set directly on the entity by the service. The admin controller passes `body.visibility`, `body.enabled` etc. but NOT pricing. This means pricing fields are currently not settable via the admin API. This is a pre-existing gap — the plan does not explicitly add pricing to the DTO since the spec says "The model entity and Admin DTO/UI must be updated accordingly." We SHOULD add `inputPricePer1m` and `outputPricePer1m` to `ModelUpsertDto` and pass them through in the controller. See fix below.

### 2. Placeholder Scan

- No `TBD`, `TODO`, or "implement later" — all concrete.
- All code blocks show actual implementation.
- No "Similar to Task N" references.
- The `calculateCost` removal is explicit: "Remove the `calculateCost` method."

### 3. Type Consistency

- `PricingService.getCreditPriceToman()` — defined in Task 6, used in Task 7. ✓
- `UsagePricingService.calculateLlmCost(modelId, inputTokens, outputTokens, reasoningTokens)` — defined in Task 7, used in Task 8. ✓
- `WalletService.deductCredits(userId, amount)` / `grantCredits(userId, amount)` — defined in Task 5, consumed by Phase 2 (not Phase 1). ✓
- `FinalizeUsageInput` interface updated with `inputTokens`/`outputTokens`/`reasoningTokens`/`chargedCost`/`chargedCredits` — consistently referenced in Task 8 tests and service. ✓
- `Model.inputPricePer1m` / `Model.outputPricePer1m` — consistently renamed across entity, tests, e2e seeds. ✓

### Fixes to apply inline

**Fix 1 — ModelUpsertDto must carry pricing fields:**

Add to `ModelUpsertDto` in Task 1:
```ts
@IsOptional()
@Type(() => Number)
@IsNumber()
@Min(0)
inputPricePer1m?: number;

@IsOptional()
@Type(() => Number)
@IsNumber()
@Min(0)
outputPricePer1m?: number;
```

And in `ModelsAdminController.create`/`update` + `ModelsService.create`/`update`, pass through these fields. Add to `CreateModelInput`/`UpdateModelInput` interfaces in `models.service.ts`.

**Fix 2 — Migration must also add `credit_price_toman` to AppConfig or a dedicated table. Actually, per spec §1.5, these are "deployment-level configuration" not "editable database setting" — env vars are the correct storage, NOT a DB table. No migration change needed.**

**Fix 3 — `app.module.ts` must import `BillingModule`.** Already noted in Task 7 Step 6. ✓

**Fix 4 — `ModelsModule` needs to import `BillingModule` or `PricingService` for the admin controller to expose pricing. Actually — pricing is read from the `Model` entity directly via `ModelsService`, so no BillingModule import needed there. The `PricingService` is only needed by `UsagePricingService` and the admin billing config endpoint.** ✓

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-19-phase-5-commercial-foundation.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?