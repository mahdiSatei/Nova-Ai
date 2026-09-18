# Model Access Control (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate every model on a visibility policy so public, commercial, and private models are only ever usable, listable, and selectable by authorized users — enforced server-side and reflected in the admin configuration UI.

**Architecture:** One policy vocabulary (`public|commercial|private` on the model, `free|commercial` on the user) plus one policy service (`ModelAccessService`) that is the *only* place entitlement is decided. `Model.visibility` defaults to `public` and `User.accessTier` defaults to `free`, so every existing row keeps exactly the audience it had before this phase. The same predicate feeds the public catalog (`GET /v1/models`), the chat request resolver, the conversation model switch, and the model-preference endpoint — there is one filter, not four.

**Tech Stack:** NestJS 10 + TypeORM 0.3 + class-validator (backend), Vue 3 + Pinia + vue-router (frontend `frontend/app`), OpenAPI 3.1 (contract source of truth), Jest (backend), Vitest (frontend), PostgreSQL 5433 `chatbot_test` for integration tests.

**Spec:** `backend/specs/003-model-access-control/spec.md` (created in Task 1 from the phase brief reproduced in Appendix A).

## Decision recap

- **Three visibility tiers, one ladder.** `public` (any authenticated user) → `commercial` (user tier `commercial`) → `private` (admin role only). Visibility is defined on the model; entitlement is defined once per user as `accessTier`.
- **Admins bypass the ladder.** An admin can use every enabled model, including `private` ones. This is what makes `private` mean "operator-only / not for end users".
- **`enabled` is orthogonal and unchanged.** A disabled model stays unavailable to *everyone* (admins included) with the existing `model_unavailable` error. Entitlement failures are a distinct `model_forbidden` (403) so clients can tell "turned off" from "not yours".
- **Entitlement comes from the database, not the JWT.** `ModelAccessService.loadViewer()` reads `role` + `access_tier` per request so an admin demotion/promotion takes effect immediately instead of at token refresh. `role` in `AuthenticatedUser` is still used by `RolesGuard` for admin-only routes.
- **Filtering is in-memory over `enabled` rows.** The catalog is admin-curated and small; keeping one JS predicate (`canAccess`) shared by the list, the resolver, and the gates avoids four subtly-different SQL predicates. Revisit only if the catalog grows past a few hundred rows.
- **Default model must stay public.** `PUT /v1/admin/config` and `PATCH /v1/admin/models/{id}` both refuse to leave the system default non-public (`model_not_eligible_default` 422 / `model_is_default` 409), keeping the invariant "the configured default is usable by every user". Disabling a model keeps its existing behavior (`isDefault` flag cleared, resolver falls through).
- **Deferred (out of scope, documented):** per-user/per-group grant lists for `private` models, billing/subscription purchase flows, quotas and usage tracking, refreshing the JWT on tier change. `ModelAccessService.canAccess` is the single extension point when grants land.
- **No contract version bump.** This phase is additive (new admin paths, new optional fields) and no existing request/response schema changes shape; the same precedent as the previous phase, which added `PATCH /v1/conversations/{id}/model` without a version bump.

**Acceptance-criteria mapping:** public access → Task 4/5; restricted access + server-side rejection → Tasks 5/6/10; admin configuration → Tasks 7/8; selector never exposes inaccessible models → Task 4 + Task 11; existing chat permissions intact → Task 14 regression sweep.

---

## Global Constraints

Copied from `backend/CLAUDE.md`, the constitution, and the phase brief. Every task's requirements implicitly include this section.

- Backend source, tests and specs live under `backend/`; frontend edits live under `frontend/app/src` and `frontend/app/tests`.
- **Agents do not run git commands** (no `add`/`commit`/`checkout`/`reset`). Each task ends with a `Suggested commit message:` block; the operator commits.
- **API-first:** `backend/specs/001-multi-model-chatbot-mvp/contracts/openapi-3.1.yaml` is the source of truth and is updated before the corresponding implementation.
- Validation at the boundary: `class-validator` + `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`.
- Errors use the envelope `{ code, message, requestId }`; no stack traces in responses.
- No raw SQL in controllers or services — TypeORM repositories only. Migrations may use `queryRunner.query`.
- No new npm dependencies (backend or frontend).
- Exact vocabulary (case-sensitive): model `visibility` ∈ `public|commercial|private`; user `accessTier` ∈ `free|commercial`.
- Defaults: `models.visibility = 'public'`, `users.access_tier = 'free'` — existing behavior for existing rows is preserved by these defaults.
- Public response shape is frozen: `ModelPublic` stays exactly `{ id, displayName, isDefault }` (never add `actualName`, `enabled`, `visibility`, or timestamps).
- Unit tests need no database. Integration tests use PostgreSQL on `localhost:5433`, database `chatbot_test`, which must exist before running them.
- Commands used throughout: `cd backend && npx jest <path> --no-coverage`, `cd backend && npm run lint`, `cd backend && npx tsc --noEmit`, `cd frontend/app && npx vue-tsc --noEmit`, `cd frontend/app && npm test`.

### Environment prerequisites (read once before Task 1)

```bash
cd backend
docker compose up -d postgres        # Postgres 18 on localhost:5433 (container: nova-ai-db)
docker exec nova-ai-db psql -U postgres -c "CREATE DATABASE chatbot_test"   # once, if missing
```

Known pre-existing failures, **not** regressions caused by this plan — do not try to fix them here:

- `test/integration/models.public.e2e.spec.ts`, `models.admin.crud.e2e.spec.ts`, `admin.role-boundary.e2e.spec.ts`, `app-config.default-model.e2e.spec.ts`, `auth.e2e.spec.ts`, `app.boot.spec.ts`, `provider.e2e.spec.ts` pin `DB_DRIVER=sqlite`, and the `Provider` entity uses `type: 'timestamp'`, which SQLite rejects (`DataTypeNotSupportedError`). Their seeds also predate the required `Model.providerId` FK.
- Integration suites share the `chatbot_test` database; the older ones assume a freshly created database. Recreate the database before a full `test/integration` sweep if a suite reports duplicate keys.
- New integration tests in this plan follow the working PostgreSQL harness in `test/integration/chat.stream.e2e.spec.ts` (seed a `Provider`, seed models with `providerId`) and use run-scoped ids so they are re-runnable.

---

## File Structure

**New files**

| Path | Responsibility |
|---|---|
| `backend/specs/003-model-access-control/spec.md` | The phase brief, in-repo next to the previous phases' specs. |
| `backend/src/modules/models/model-visibility.ts` | Policy vocabulary + ranks (`ModelVisibility`, `UserAccessTier`, `MODEL_VISIBILITIES`, `USER_ACCESS_TIERS`, `VISIBILITY_RANK`, `TIER_RANK`). No Nest, no TypeORM — importable from anywhere. |
| `backend/src/modules/models/model-access.service.ts` | The single entitlement decision: load viewer, pure predicate, list filter, endpoint gate. |
| `backend/src/database/migrations/1700000006000-add-model-visibility-and-user-access-tier.ts` | Adds `models.visibility` + `users.access_tier` with backward-compatible defaults. |
| `backend/src/modules/users/users.admin.controller.ts` | `GET /v1/admin/users`, `PATCH /v1/admin/users/{id}/access-tier` (admin role). |
| `backend/src/modules/users/dto/set-access-tier.dto.ts` | `SetUserAccessTierDto`. |
| `backend/test/unit/model-access.service.spec.ts` | Unit coverage for the policy matrix. |
| `backend/test/unit/users.admin.controller.spec.ts` | Unit coverage for the admin users endpoints. |
| `backend/test/contract/access-control-contract.spec.ts` | Contract assertions for the new/changed surfaces. |
| `backend/test/integration/access-control.e2e.spec.ts` | End-to-end proof of the acceptance criteria. |
| `frontend/app/src/views/admin/UsersView.vue` | Admin page: find a user, set their access tier. |
| `frontend/app/tests/utils/errors.spec.ts` | New Persian messages for the new error codes. |
| `frontend/app/tests/api/admin.spec.ts` | Request shape of the new admin user endpoints. |

**Modified files**

| Path | Change |
|---|---|
| `backend/specs/001-multi-model-chatbot-mvp/contracts/openapi-3.1.yaml` | New admin user paths, visibility fields, 403/409 responses. |
| `backend/src/modules/models/entities/model.entity.ts` | `visibility` column. |
| `backend/src/modules/users/entities/user.entity.ts` | `accessTier` column. |
| `backend/src/modules/models/models.service.ts` | `listAccessibleFor`, access-filtered `resolveActiveModel`, visibility create/update, default-model guard. |
| `backend/src/modules/models/models.public.controller.ts` | List only models the caller may use. |
| `backend/src/modules/models/models.admin.controller.ts` | Surface `visibility`. |
| `backend/src/modules/models/models.module.ts` | Register `User` repo, provide + export `ModelAccessService`. |
| `backend/src/modules/models/dto/model-upsert.dto.ts` | `visibility` field. |
| `backend/src/modules/chat/chat.service.ts` | `model_forbidden` on explicit selection; access-aware resolution. |
| `backend/src/modules/conversations/conversations.controller.ts` | Gate `PATCH /:id/model` through `assertCanUseModel`. |
| `backend/src/modules/users/users.controller.ts` | Gate `PATCH /me/model-preference` through `assertCanUseModel`. |
| `backend/src/modules/users/users.service.ts` | `listForAdmin`, `setAccessTier`. |
| `backend/src/modules/users/users.module.ts` | Register `UsersAdminController`. |
| `backend/src/modules/app-config/app-config.service.ts` | Default model must be `public`. |
| `backend/test/unit/*.spec.ts` | Mock/expectation updates (Tasks 3–9). |
| `frontend/app/src/types/api.ts` | `ModelVisibility`, `UserAccessTier`, `visibility` on `ModelAdmin`/`ModelUpsertRequest`, `AdminUser`, `AdminUserList`. |
| `frontend/app/src/api/admin.ts` | `listAdminUsers`, `setUserAccessTier`. |
| `frontend/app/src/components/admin/ModelFormModal.vue` | Visibility select in the create/edit form. |
| `frontend/app/src/components/admin/ModelTable.vue` | Visibility badge column. |
| `frontend/app/src/components/chat/ModelPicker.vue` | Re-resolve the selection when the catalog no longer contains it; neutral empty-state copy. |
| `frontend/app/src/composables/useChatStream.ts` | On `model_forbidden`/`model_unavailable`: clear the selection, reload the catalog. |
| `frontend/app/src/utils/errors.ts` | Persian messages for the new codes. |
| `frontend/app/src/router/index.ts`, `frontend/app/src/layouts/AdminShell.vue` | Admin users route + nav entry. |

---

## Task 1: Phase spec + OpenAPI contract + contract test

**Files:**
- Create: `backend/specs/003-model-access-control/spec.md`
- Modify: `backend/specs/001-multi-model-chatbot-mvp/contracts/openapi-3.1.yaml`
- Test: `backend/test/contract/access-control-contract.spec.ts`

**Interfaces:**
- Produces (contract-level, consumed by every later task): model `visibility` field on `ModelAdmin`/`ModelCreateRequest`/`ModelPatchRequest`; `ModelVisibility` and `UserAccessTier` enums; `GET /v1/admin/users` + `PATCH /v1/admin/users/{id}/access-tier` with `AdminUser`, `AdminUserList`, `SetUserAccessTierRequest`; documented `403` on `PATCH /v1/conversations/{id}/model` and `PATCH /v1/users/me/model-preference`; documented `409` on `PATCH /v1/admin/models/{id}`; documented `422` on `PUT /v1/admin/config`.

- [ ] **Step 1: Create the phase spec**

Create `backend/specs/003-model-access-control/spec.md` with the exact content of Appendix A (phase brief verbatim). Keep the previous specs untouched.

- [ ] **Step 2: Write the failing contract test**

Create `backend/test/contract/access-control-contract.spec.ts`:

```typescript
import { readFileSync } from 'fs';
import { join } from 'path';
import YAML from 'yaml';

const document = YAML.parse(
  readFileSync(
    join(__dirname, '../../specs/001-multi-model-chatbot-mvp/contracts/openapi-3.1.yaml'),
    'utf8',
  ),
);

describe('model access-control API contract', () => {
  it('documents the admin user access endpoints as admin-only', () => {
    const pairs = [
      ['/v1/admin/users', 'get'],
      ['/v1/admin/users/{id}/access-tier', 'patch'],
    ] as const;
    for (const [path, method] of pairs) {
      const op = document.paths[path]?.[method];
      expect(op).toBeDefined();
      expect(op.security).toEqual([{ bearerAdminAuth: [] }]);
      expect(op.responses['401']).toBeDefined();
      expect(op.responses['403']).toBeDefined();
    }
  });

  it('requires visibility on ModelAdmin and keeps ModelPublic minimal', () => {
    const schemas = document.components.schemas;
    expect(schemas.ModelVisibility.enum).toEqual(['public', 'commercial', 'private']);
    expect(schemas.UserAccessTier.enum).toEqual(['free', 'commercial']);
    expect(schemas.ModelAdmin.allOf[1].required).toContain('visibility');
    expect(schemas.ModelAdmin.allOf[1].properties.visibility.$ref).toBe(
      '#/components/schemas/ModelVisibility',
    );
    expect(Object.keys(schemas.ModelPublic.properties).sort()).toEqual([
      'displayName',
      'id',
      'isDefault',
    ]);
  });

  it('accepts visibility on model create and patch, but never requires it', () => {
    const schemas = document.components.schemas;
    expect(schemas.ModelCreateRequest.properties.visibility).toBeDefined();
    expect(schemas.ModelPatchRequest.properties.visibility).toBeDefined();
    expect(schemas.ModelCreateRequest.required).not.toContain('visibility');
    expect(schemas.ModelPatchRequest.required ?? []).toEqual([]);
  });

  it('documents the entitlement rejection on both user model-selection paths', () => {
    const operations = [
      document.paths['/v1/conversations/{id}/model'].patch,
      document.paths['/v1/users/me/model-preference'].patch,
    ];
    for (const op of operations) {
      expect(op.responses['403']).toBeDefined();
      expect(op.responses['422']).toBeDefined();
    }
  });

  it('documents the default-model visibility constraint', () => {
    expect(
      document.paths['/v1/admin/models/{id}'].patch.responses['409'].description,
    ).toMatch(/default/i);
    expect(document.paths['/v1/admin/config'].put.responses['422'].description).toMatch(/public/i);
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `cd backend && npx jest test/contract/access-control-contract.spec.ts --no-coverage`
Expected: FAIL — `schemas.ModelVisibility` is undefined.

- [ ] **Step 4: Add the enum schemas and the AdminUser schemas**

In `specs/001-multi-model-chatbot-mvp/contracts/openapi-3.1.yaml`, insert immediately **before** `    ModelPublic:` (currently line 1115, right after the `UserPublic` block):

```yaml
    ModelVisibility:
      type: string
      enum: [public, commercial, private]
      description: |
        public — usable by any authenticated user; commercial — usable by users
        whose access tier is `commercial`; private — admin role only.

    UserAccessTier:
      type: string
      enum: [free, commercial]

    AdminUser:
      type: object
      required: [id, email, username, role, accessTier, createdAt]
      properties:
        id:
          type: string
          format: uuid
        email:
          type: string
          format: email
        username:
          type: string
          nullable: true
        role:
          type: string
          enum: [user, admin]
        accessTier:
          $ref: '#/components/schemas/UserAccessTier'
        createdAt:
          type: string
          format: date-time

    AdminUserList:
      type: object
      required: [items, total]
      properties:
        items:
          type: array
          items:
            $ref: '#/components/schemas/AdminUser'
        total:
          type: integer
          minimum: 0

    SetUserAccessTierRequest:
      type: object
      additionalProperties: false
      required: [accessTier]
      properties:
        accessTier:
          $ref: '#/components/schemas/UserAccessTier'
```

- [ ] **Step 5: Add `visibility` to the model schemas**

Three edits in the same file:

1. `ModelAdmin.allOf[1]` — add `visibility` to `required`:

```yaml
        - type: object
          required: [actualName, providerId, visibility, enabled, createdAt, updatedAt]
          properties:
            actualName:
              type: string
              minLength: 1
              maxLength: 200
            providerId:
              type: string
              minLength: 1
              maxLength: 80
              pattern: '^[a-z0-9-]+$'
            visibility:
              $ref: '#/components/schemas/ModelVisibility'
            enabled:
              type: boolean
```

2. `ModelCreateRequest.properties` — add after `providerId`:

```yaml
        visibility:
          allOf:
            - $ref: '#/components/schemas/ModelVisibility'
          description: Defaults to `public` when omitted.
```

3. `ModelPatchRequest.properties` — add after `providerId`:

```yaml
        visibility:
          $ref: '#/components/schemas/ModelVisibility'
```

- [ ] **Step 6: Document the new responses**

1. `PATCH /v1/conversations/{id}/model` (path at line 252): replace the `'422'` block's description and add a `'403'` block. The `responses` map becomes:

```yaml
      responses:
        '200':
          description: Conversation model updated
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ConversationSummary'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          description: The model exists and is enabled, but the caller is not entitled to it (`model_forbidden`), or the conversation belongs to another user (`forbidden`)
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
        '404':
          description: Conversation not found
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
        '422':
          description: Model not available (unknown or disabled)
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
```

2. `PATCH /v1/users/me/model-preference` (line 467): keep `'200'`, `'401'`, replace `'422'` description and add `'403'`:

```yaml
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          description: The model exists and is enabled, but the caller is not entitled to it (`model_forbidden`)
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
        '422':
          description: Model not available (unknown or disabled)
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
```

3. `PATCH /v1/admin/models/{id}` (line 586): update the summary to
   `Edit a model (display name, actual name, enabled, providerId, visibility)` and add:

```yaml
        '409':
          description: Refused because the model is the system default and the change would make it non-public (`model_is_default`)
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
```

4. `PUT /v1/admin/config` (line 952): set its `'422'` description to
   `Default model not found, disabled, or not public (code model_not_eligible_default)`.

5. `GET /v1/models` (line 142): set the summary to `List the enabled models the caller is entitled to use (display names only)` and add a description line:
   `Every enabled model whose visibility the caller satisfies: public for all authenticated users, commercial for users with accessTier=commercial, private for admins.`

- [ ] **Step 7: Add the two admin user paths**

Insert **before** `  /v1/admin/config:` (line 935):

```yaml
  /v1/admin/users:
    get:
      tags: [admin]
      summary: List user accounts with their access tier
      security:
        - bearerAdminAuth: []
      parameters:
        - in: query
          name: query
          schema:
            type: string
            maxLength: 120
          description: Case-insensitive substring match on email or username.
        - in: query
          name: limit
          schema:
            type: integer
            minimum: 1
            maximum: 100
            default: 20
        - in: query
          name: offset
          schema:
            type: integer
            minimum: 0
            default: 0
      responses:
        '200':
          description: Users list
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/AdminUserList'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          $ref: '#/components/responses/Forbidden'

  /v1/admin/users/{id}/access-tier:
    patch:
      tags: [admin]
      summary: Set a user's access tier
      description: |
        Sets the user's entitlement tier. `commercial` grants access to models
        with `visibility: commercial`; `free` is the floor. Models with
        `visibility: private` stay admin-only regardless of tier.
      security:
        - bearerAdminAuth: []
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/SetUserAccessTierRequest'
      responses:
        '200':
          description: Updated
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/AdminUser'
        '400':
          $ref: '#/components/responses/BadRequest'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          $ref: '#/components/responses/Forbidden'
        '404':
          description: User not found (`user_not_found`)
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
```

- [ ] **Step 8: Run the contract test**

Run: `cd backend && npx jest test/contract --no-coverage`
Expected: PASS (both the existing `provider-contract.spec.ts` and the new file).

- [ ] **Step 9: Suggested commit message**

```
Suggested commit message: docs(spec,contract): add phase 3 model access control surface (visibility, access tier, admin users)
```

---

## Task 2: Migration + entities

**Files:**
- Create: `backend/src/database/migrations/1700000006000-add-model-visibility-and-user-access-tier.ts`
- Modify: `backend/src/modules/models/entities/model.entity.ts`
- Modify: `backend/src/modules/users/entities/user.entity.ts`
- Test: `backend/test/unit/model-access-columns.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Model.visibility: ModelVisibility` (DB default `'public'`), `User.accessTier: UserAccessTier` (DB default `'free'`). Column names `models.visibility` and `users.access_tier`.

- [ ] **Step 1: Write the failing test**

Create `backend/test/unit/model-access-columns.spec.ts` — a fast, DB-free assertion that the entity metadata carries the new columns with the backward-compatible defaults:

```typescript
import { getMetadataArgsStorage } from 'typeorm';
import { Model } from '../../src/modules/models/entities/model.entity';
import { User } from '../../src/modules/users/entities/user.entity';

function column(name: string, target: Function) {
  const found = getMetadataArgsStorage().columns.find(
    (c) => c.target === target && c.propertyName === name,
  );
  if (!found) throw new Error(`${target.name}.${name} is not a mapped column`);
  return found.options;
}

describe('access-control columns', () => {
  it('maps models.visibility with a public default', () => {
    const options = column('visibility', Model);
    expect(options.name).toBe('visibility');
    expect(options.type).toBe('text');
    expect(options.default).toBe('public');
  });

  it('maps users.access_tier with a free default', () => {
    const options = column('accessTier', User);
    expect(options.name).toBe('access_tier');
    expect(options.type).toBe('text');
    expect(options.default).toBe('free');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd backend && npx jest test/unit/model-access-columns.spec.ts --no-coverage`
Expected: FAIL — `Model.visibility is not a mapped column`.

- [ ] **Step 3: Add the columns to the entities**

In `backend/src/modules/models/model-visibility.ts` (new file):

```typescript
/**
 * Access-control vocabulary for the model catalog.
 *
 * Kept dependency-free (no Nest, no TypeORM) so entities, DTOs, the policy
 * service and the tests all import the exact same string literals.
 */
export type ModelVisibility = 'public' | 'commercial' | 'private';
export type UserAccessTier = 'free' | 'commercial';

export const MODEL_VISIBILITIES: readonly ModelVisibility[] = ['public', 'commercial', 'private'];
export const USER_ACCESS_TIERS: readonly UserAccessTier[] = ['free', 'commercial'];

/** Ordered ladder for the tier a *viewer* holds. */
export const TIER_RANK: Record<UserAccessTier, number> = { free: 0, commercial: 1 };

/** Ordered ladder for the visibility a *model* requires. */
export const VISIBILITY_RANK: Record<ModelVisibility, number> = {
  public: 0,
  commercial: 1,
  private: 2,
};
```

In `backend/src/modules/models/entities/model.entity.ts`, add the import and the column (place it next to `providerId`):

```typescript
import type { ModelVisibility } from '../model-visibility';
```

```typescript
  /**
   * Who may use this model. `public` (the default) keeps every pre-existing
   * model visible to the same audience as before phase 3.
   */
  @Column({ type: 'text', default: 'public' })
  visibility!: ModelVisibility;
```

In `backend/src/modules/users/entities/user.entity.ts`, add the import and the column (after `role`):

```typescript
import type { UserAccessTier } from '../../models/model-visibility';
```

```typescript
  /**
   * Entitlement tier for commercial models. `free` is the floor; the admin
   * role bypasses the ladder entirely (see ModelAccessService).
   */
  @Column({ name: 'access_tier', type: 'text', default: 'free' })
  accessTier!: UserAccessTier;
```

- [ ] **Step 4: Run the entity test**

Run: `cd backend && npx jest test/unit/model-access-columns.spec.ts --no-coverage`
Expected: PASS.

- [ ] **Step 5: Write the migration**

Create `backend/src/database/migrations/1700000006000-add-model-visibility-and-user-access-tier.ts`:

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 3 (model access control).
 *
 * Both columns are added with a default so every pre-existing row keeps the
 * audience it had before this migration: models stay `public`, users stay
 * `free`. The defaults are intentionally kept in the schema (unlike the
 * provider FK migration) because `public`/`free` are the correct floor values
 * for rows inserted outside the HTTP API (seeds, fixtures, direct SQL).
 */
export class AddModelVisibilityAndUserAccessTier1700000006000 implements MigrationInterface {
  name = 'AddModelVisibilityAndUserAccessTier1700000006000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE models ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'`,
    );
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN access_tier TEXT NOT NULL DEFAULT 'free'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP COLUMN access_tier`);
    await queryRunner.query(`ALTER TABLE models DROP COLUMN visibility`);
  }
}
```

- [ ] **Step 6: Verify the migration runs and is reversible on PostgreSQL**

Run:

```bash
cd backend && npx typeorm-ts-node-commonjs migration:run -d src/database/data-source.ts
```

Expected: `AddModelVisibilityAndUserAccessTier1700000006000` reported as executed. Then:

```bash
cd backend && npx typeorm-ts-node-commonjs migration:revert -d src/database/data-source.ts && npx typeorm-ts-node-commonjs migration:run -d src/database/data-source.ts
```

Expected: revert succeeds, re-run succeeds. (If the local `data/app.sqlite`/`novadb` database is not reachable, instead run the new integration suite from Task 10 — it calls `runMigrations()` on `chatbot_test` and will fail loudly if the migration is broken.)

- [ ] **Step 7: Type-check**

Run: `cd backend && npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 8: Suggested commit message**

```
Suggested commit message: feat(models,users): add model visibility and user access tier columns with backwards-compatible defaults
```

---

## Task 3: `ModelAccessService` — the single entitlement decision

**Files:**
- Create: `backend/src/modules/models/model-access.service.ts`
- Modify: `backend/src/modules/models/models.module.ts`
- Test: `backend/test/unit/model-access.service.spec.ts`

**Interfaces:**
- Consumes: `ModelVisibility`, `UserAccessTier`, `TIER_RANK`, `VISIBILITY_RANK` (Task 2); `User` repository.
- Produces (used by Tasks 4–8):
  - `interface AccessViewer { role: 'user' | 'admin'; accessTier: UserAccessTier }`
  - `interface AccessTarget { visibility: ModelVisibility; enabled: boolean }`
  - `loadViewer(userId: string): Promise<AccessViewer | null>` — `null` when the user does not exist.
  - `canAccess(viewer: AccessViewer | null | undefined, model: AccessTarget): boolean` — pure, no DB.
  - `canAccessUser(userId: string, model: AccessTarget): Promise<boolean>`
  - `filterAccessible<T extends AccessTarget>(userId: string, models: T[]): Promise<T[]>`
  - `assertCanUseModel(userId: string, model: AccessTarget): Promise<void>` — throws `UnprocessableEntityException({ code: 'model_unavailable' })` when disabled, `ForbiddenException({ code: 'model_forbidden' })` when not entitled.

- [ ] **Step 1: Write the failing unit test**

Create `backend/test/unit/model-access.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ModelAccessService, AccessViewer } from '../../src/modules/models/model-access.service';
import { User } from '../../src/modules/users/entities/user.entity';

describe('ModelAccessService', () => {
  let svc: ModelAccessService;
  let userRepo: { findOne: jest.Mock };

  const viewer = (role: 'user' | 'admin', accessTier: 'free' | 'commercial'): AccessViewer => ({
    role,
    accessTier,
  });

  const userRow = (role: 'user' | 'admin', accessTier: 'free' | 'commercial') => ({
    id: 'u-1',
    role,
    accessTier,
  });

  beforeEach(async () => {
    userRepo = { findOne: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ModelAccessService,
        { provide: getRepositoryToken(User), useValue: userRepo },
      ],
    }).compile();
    svc = moduleRef.get(ModelAccessService);
  });

  describe('canAccess', () => {
    it.each([
      ['free', 'user', 'public', true],
      ['free', 'user', 'commercial', false],
      ['free', 'user', 'private', false],
      ['commercial', 'user', 'public', true],
      ['commercial', 'user', 'commercial', true],
      ['commercial', 'user', 'private', false],
      ['free', 'admin', 'public', true],
      ['free', 'admin', 'commercial', true],
      ['free', 'admin', 'private', true],
    ] as const)(
      'tier=%s role=%s visibility=%s => %s',
      (accessTier, role, visibility, expected) => {
        expect(svc.canAccess(viewer(role, accessTier), { visibility, enabled: true })).toBe(expected);
      },
    );

    it('denies everything to an unknown viewer', () => {
      expect(svc.canAccess(null, { visibility: 'public', enabled: true })).toBe(false);
      expect(svc.canAccess(undefined, { visibility: 'public', enabled: true })).toBe(false);
    });

    it('denies a disabled model even to an admin', () => {
      expect(svc.canAccess(viewer('admin', 'commercial'), { visibility: 'public', enabled: false })).toBe(false);
    });
  });

  describe('loadViewer', () => {
    it('loads only the fields needed by the policy', async () => {
      userRepo.findOne.mockResolvedValue(userRow('user', 'commercial'));
      const result = await svc.loadViewer('u-1');
      expect(result).toEqual({ role: 'user', accessTier: 'commercial' });
      expect(userRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'u-1' },
        select: ['id', 'role', 'accessTier'],
      });
    });

    it('returns null for an unknown user', async () => {
      userRepo.findOne.mockResolvedValue(null);
      expect(await svc.loadViewer('missing')).toBeNull();
    });
  });

  describe('canAccessUser', () => {
    it('grants a commercial model to a commercial user', async () => {
      userRepo.findOne.mockResolvedValue(userRow('user', 'commercial'));
      expect(await svc.canAccessUser('u-1', { visibility: 'commercial', enabled: true })).toBe(true);
    });

    it('denies a commercial model to a free user', async () => {
      userRepo.findOne.mockResolvedValue(userRow('user', 'free'));
      expect(await svc.canAccessUser('u-1', { visibility: 'commercial', enabled: true })).toBe(false);
    });
  });

  describe('filterAccessible', () => {
    it('keeps only entitled models and loads the viewer once', async () => {
      userRepo.findOne.mockResolvedValue(userRow('user', 'free'));
      const models = [
        { id: 'pub', visibility: 'public' as const, enabled: true },
        { id: 'com', visibility: 'commercial' as const, enabled: true },
        { id: 'priv', visibility: 'private' as const, enabled: true },
        { id: 'off', visibility: 'public' as const, enabled: false },
      ];
      const result = await svc.filterAccessible('u-1', models);
      expect(result.map((m) => m.id)).toEqual(['pub']);
      expect(userRepo.findOne).toHaveBeenCalledTimes(1);
    });
  });

  describe('assertCanUseModel', () => {
    it('throws model_unavailable for a disabled model', async () => {
      userRepo.findOne.mockResolvedValue(userRow('user', 'free'));
      await expect(
        svc.assertCanUseModel('u-1', { visibility: 'public', enabled: false }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('throws model_forbidden with a stable code for an unentitled viewer', async () => {
      userRepo.findOne.mockResolvedValue(userRow('user', 'free'));
      const err = await svc
        .assertCanUseModel('u-1', { visibility: 'commercial', enabled: true })
        .catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toMatchObject({ code: 'model_forbidden' });
      expect(userRepo.findOne).toHaveBeenCalledTimes(1);
    });

    it('resolves for a public model', async () => {
      userRepo.findOne.mockResolvedValue(userRow('user', 'free'));
      await expect(
        svc.assertCanUseModel('u-1', { visibility: 'public', enabled: true }),
      ).resolves.toBeUndefined();
    });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd backend && npx jest test/unit/model-access.service.spec.ts --no-coverage`
Expected: FAIL — cannot resolve `../../src/modules/models/model-access.service`.

- [ ] **Step 3: Implement the service**

Create `backend/src/modules/models/model-access.service.ts`:

```typescript
import {
  ForbiddenException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import {
  ModelVisibility,
  UserAccessTier,
  TIER_RANK,
  VISIBILITY_RANK,
} from './model-visibility';

/** The caller's entitlement, resolved once per request. */
export interface AccessViewer {
  role: 'user' | 'admin';
  accessTier: UserAccessTier;
}

/** The minimum a model must expose for the policy to decide. */
export interface AccessTarget {
  visibility: ModelVisibility;
  enabled: boolean;
}

/**
 * The ONE place model entitlement is decided (spec §Scope: "Backend
 * authorization guard/service").
 *
 * Policy:
 *   - a disabled model is usable by nobody (including admins) — callers keep
 *     returning the pre-existing `model_unavailable` error for that case;
 *   - `private` models are admin-only;
 *   - otherwise the viewer's tier must be >= the model's visibility rank
 *     (free < commercial); admins hold the maximum tier.
 *
 * Entitlement is read from the database on every request rather than from the
 * JWT so an access-tier change takes effect immediately. A missing user row
 * denies everything.
 */
@Injectable()
export class ModelAccessService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async loadViewer(userId: string): Promise<AccessViewer | null> {
    const row = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'role', 'accessTier'],
    });
    if (!row) return null;
    return { role: row.role, accessTier: row.accessTier };
  }

  canAccess(viewer: AccessViewer | null | undefined, model: AccessTarget): boolean {
    if (!viewer) return false;
    if (!model.enabled) return false;
    if (model.visibility === 'private') return viewer.role === 'admin';
    const tier: UserAccessTier = viewer.role === 'admin' ? 'commercial' : viewer.accessTier;
    return TIER_RANK[tier] >= VISIBILITY_RANK[model.visibility];
  }

  async canAccessUser(userId: string, model: AccessTarget): Promise<boolean> {
    return this.canAccess(await this.loadViewer(userId), model);
  }

  async filterAccessible<T extends AccessTarget>(userId: string, models: T[]): Promise<T[]> {
    const viewer = await this.loadViewer(userId);
    return models.filter((m) => this.canAccess(viewer, m));
  }

  /**
   * Endpoint gate. Callers use this instead of hand-rolling `enabled` checks so
   * "turned off" and "not yours" stay distinguishable to clients.
   */
  async assertCanUseModel(userId: string, model: AccessTarget): Promise<void> {
    if (!model.enabled) {
      throw new UnprocessableEntityException({
        code: 'model_unavailable',
        message: 'The selected model is not available.',
      });
    }
    if (!(await this.canAccessUser(userId, model))) {
      throw new ForbiddenException({
        code: 'model_forbidden',
        message: 'You do not have access to this model.',
      });
    }
  }
}
```

- [ ] **Step 4: Wire the module**

In `backend/src/modules/models/models.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Model } from './entities/model.entity';
import { Provider } from '../provider/entities/provider.entity';
import { User } from '../users/entities/user.entity';
import { ModelsService } from './models.service';
import { ModelAccessService } from './model-access.service';
import { ModelsPublicController } from './models.public.controller';
import { ModelsAdminController } from './models.admin.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Model, Provider, User])],
  controllers: [ModelsPublicController, ModelsAdminController],
  providers: [ModelsService, ModelAccessService],
  exports: [ModelsService, ModelAccessService],
})
export class ModelsModule {}
```

- [ ] **Step 5: Run the unit test and type-check**

Run: `cd backend && npx jest test/unit/model-access.service.spec.ts --no-coverage && npx tsc --noEmit`
Expected: PASS, zero type errors.

- [ ] **Step 6: Suggested commit message**

```
Suggested commit message: feat(models): add ModelAccessService as the single model entitlement policy
```

---

## Task 4: Access-filtered public catalog (`GET /v1/models`)

**Files:**
- Modify: `backend/src/modules/models/models.service.ts`
- Modify: `backend/src/modules/models/models.public.controller.ts`
- Modify: `backend/test/unit/models.public.controller.spec.ts`
- Test: `backend/test/unit/models.service.spec.ts` (additions)

**Interfaces:**
- Consumes: `ModelAccessService` (Task 3).
- Produces:
  - `ModelsService.listAccessibleFor(userId: string): Promise<Model[]>` — enabled models the caller is entitled to, ordered by `displayName` ASC.
  - `GET /v1/models` → `{ items: Array<{ id, displayName, isDefault }> }`, unchanged shape, filtered set.
  - `ModelsService` constructor gains `private readonly access: ModelAccessService` as the **second** parameter.

- [ ] **Step 1: Write the failing unit tests**

In `backend/test/unit/models.service.spec.ts`, hoist an access mock next to `let repo: any;` and add it to the module:

```typescript
// import { ModelAccessService } from '../../src/modules/models/model-access.service';

  let access: {
    loadViewer: jest.Mock;
    canAccess: jest.Mock;
    canAccessUser: jest.Mock;
    filterAccessible: jest.Mock;
    assertCanUseModel: jest.Mock;
  };

  // inside beforeEach(), next to the repo provider:
    access = {
      loadViewer: jest.fn(),
      canAccess: jest.fn().mockReturnValue(true),
      canAccessUser: jest.fn().mockResolvedValue(true),
      filterAccessible: jest.fn(async (_userId: string, models: any[]) => models),
      assertCanUseModel: jest.fn().mockResolvedValue(undefined),
    };
    // providers: [ModelsService, { provide: getRepositoryToken(Model), useValue: repo },
    //             { provide: ModelAccessService, useValue: access }]
```

Then add the new block (it must sit inside the top-level `describe('ModelsService', ...)` so it can see `svc`, `repo` and `access`):

```typescript
  describe('listAccessibleFor()', () => {
    it('returns only the enabled models the caller is entitled to, name-ordered', async () => {
      repo.__setRows([
        { id: 'com', displayName: 'Zeta', visibility: 'commercial', enabled: true },
        { id: 'pub', displayName: 'Alpha', visibility: 'public', enabled: true },
        { id: 'off', displayName: 'Beta', visibility: 'public', enabled: false },
      ] as any);
      // Deny the commercial row for this caller.
      access.filterAccessible.mockImplementation(async (_userId: string, models: any[]) =>
        models.filter((m) => m.visibility !== 'commercial'),
      );

      const result = await svc.listAccessibleFor('u-1');

      expect(result.map((m) => m.id)).toEqual(['pub']);
      expect(access.filterAccessible).toHaveBeenCalledWith('u-1', expect.any(Array));
    });
  });
```

In `backend/test/unit/models.public.controller.spec.ts`, replace the mocked `listEnabled` with `listAccessibleFor` and add an entitlement case:

```typescript
  let modelsService: {
    listAccessibleFor: jest.Mock;
  };

  // ... in beforeEach providers, unchanged otherwise ...

      modelsService.listAccessibleFor.mockResolvedValue([
        { id: 'm1', displayName: 'GPT-4o', actualName: 'gpt-4o', visibility: 'public', enabled: true, isDefault: true },
      ]);

      const result = await controller.list(user as any);

      expect(modelsService.listAccessibleFor).toHaveBeenCalledWith('u-1');
      expect(result).toEqual({ items: [{ id: 'm1', displayName: 'GPT-4o', isDefault: true }] });
```

```typescript
    it('filters the catalog by the caller (never returns another user’s models)', async () => {
      modelsService.listAccessibleFor.mockResolvedValue([]);
      const result = await controller.list({ id: 'u-restricted' } as any);
      expect(modelsService.listAccessibleFor).toHaveBeenCalledWith('u-restricted');
      expect(result).toEqual({ items: [] });
    });
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `cd backend && npx jest test/unit/models.public.controller.spec.ts test/unit/models.service.spec.ts --no-coverage`
Expected: FAIL — `listAccessibleFor` / `filterAccessible` not called (and `svc.listAccessibleFor is not a function`).

- [ ] **Step 3: Implement `listAccessibleFor` and inject the policy service**

In `backend/src/modules/models/models.service.ts`:

```typescript
import { ModelAccessService } from './model-access.service';
```

```typescript
  constructor(
    @InjectRepository(Model)
    private readonly repo: Repository<Model>,
    private readonly access: ModelAccessService,
  ) {}
```

Add next to `listEnabled()`:

```typescript
  /**
   * The catalog a given user may pick from: enabled models filtered by the
   * access policy. `listEnabled()` stays as the unfiltered primitive used
   * internally and by tests.
   */
  async listAccessibleFor(userId: string): Promise<Model[]> {
    const enabled = await this.listEnabled();
    return this.access.filterAccessible(userId, enabled);
  }
```

- [ ] **Step 4: Switch the public controller over**

In `backend/src/modules/models/models.public.controller.ts`:

```typescript
  @Get()
  @HttpCode(HttpStatus.OK)
  async list(@CurrentUser() user: AuthenticatedUser) {
    const items = await this.models.listAccessibleFor(user.id);
    return { items: items.map((m) => this.toPublic(m)) };
  }
```

Update the class doc comment to say the list is entitlement-filtered (`public` for everyone, `commercial` for tier-commercial users, `private` for admins) and that the response shape is unchanged.

- [ ] **Step 5: Run the tests and type-check**

Run: `cd backend && npx jest test/unit/models.public.controller.spec.ts test/unit/models.service.spec.ts test/unit/model-access.service.spec.ts --no-coverage && npx tsc --noEmit`
Expected: PASS, zero type errors.

- [ ] **Step 6: Suggested commit message**

```
Suggested commit message: feat(models): filter GET /v1/models by the caller's model entitlement
```

---

## Task 5: Chat streaming enforcement (`model_forbidden` in the SSE stream)

**Files:**
- Modify: `backend/src/modules/chat/chat.service.ts`
- Modify: `backend/src/modules/models/models.service.ts` (`resolveActiveModel`)
- Modify: `backend/test/unit/chat.service.spec.ts`

**Interfaces:**
- Consumes: `ModelAccessService` (Task 3), `ModelsService.resolveActiveModel` (modified below).
- Produces:
  - `ChatService` constructor gains `private readonly access: ModelAccessService`.
  - `ChatService.streamChat` emits `{ event: 'error', data: { code: 'model_forbidden' } }` for an explicit model the caller is not entitled to, before any conversation/provider work happens.
  - `ModelsService.resolveActiveModel({ explicitModelId?, userId? })` only returns models the given `userId` may use; returns `null` when `userId` is missing (no more unfiltered resolution) and logs a warning.

- [ ] **Step 1: Write the failing unit tests**

In `backend/test/unit/chat.service.spec.ts`, add the mock to the testing module and a new describe block:

```typescript
// import { ModelAccessService } from '../../src/modules/models/model-access.service';

    access = {
      loadViewer: jest.fn().mockResolvedValue({ role: 'user', accessTier: 'free' }),
      canAccess: jest.fn().mockReturnValue(true),
      canAccessUser: jest.fn().mockResolvedValue(true),
      filterAccessible: jest.fn(async (_userId: string, models: any[]) => models),
      assertCanUseModel: jest.fn().mockResolvedValue(undefined),
    };
    // providers: [..., { provide: ModelAccessService, useValue: access }]
```

```typescript
  describe('explicit model entitlement', () => {
    it('emits model_forbidden when the model exists but the caller is not entitled', async () => {
      models.findById.mockResolvedValue({ id: 'com', enabled: true, visibility: 'commercial' });
      access.canAccessUser.mockResolvedValue(false);

      const events: any[] = [];
      svc.streamChat('user-1', { message: 'hi', modelId: 'com' }).subscribe((e) => events.push(e));

      await new Promise((r) => setTimeout(r, 0));
      expect(events).toContainEqual({
        event: 'error',
        data: expect.objectContaining({ code: 'model_forbidden' }),
      });
      expect(conversations.create).not.toHaveBeenCalled();
    });

    it('keeps model_unavailable for a disabled model (no entitlement leak)', async () => {
      models.findById.mockResolvedValue({ id: 'off', enabled: false, visibility: 'public' });
      access.canAccessUser.mockResolvedValue(false);

      const events: any[] = [];
      svc.streamChat('user-1', { message: 'hi', modelId: 'off' }).subscribe((e) => events.push(e));

      await new Promise((r) => setTimeout(r, 0));
      expect(events).toContainEqual({
        event: 'error',
        data: expect.objectContaining({ code: 'model_unavailable' }),
      });
    });

    it('proceeds for an entitled explicit model', async () => {
      models.findById.mockResolvedValue({ id: 'pub', enabled: true, visibility: 'public' });
      access.canAccessUser.mockResolvedValue(true);

      const events: any[] = [];
      svc.streamChat('user-1', { message: 'hi', modelId: 'pub' }).subscribe((e) => events.push(e));

      await new Promise((r) => setTimeout(r, 0));
      expect(events.some((e) => e?.event === 'error' && e.data.code === 'model_forbidden')).toBe(false);
    });
  });
```

Every existing test in this file that exercises the explicit-`modelId` path must keep working: the default `access.canAccessUser` mock returns `true`.

- [ ] **Step 2: Run them to confirm they fail**

Run: `cd backend && npx jest test/unit/chat.service.spec.ts --no-coverage`
Expected: FAIL — `access.canAccessUser` never called; `model_forbidden` never emitted.

- [ ] **Step 3: Make `resolveActiveModel` access-aware**

In `backend/src/modules/models/models.service.ts`, replace `resolveActiveModel` with:

```typescript
  /**
   * Resolve which model should be used for a chat request.
   *
   * Resolution order (every candidate is checked against the access policy):
   *   1. explicitModelId (caller picked a model in the request body)
   *   2. caller's sticky choice (User.lastSelectedModelId)
   *   3. admin's default model (AppConfig.defaultModelId → Model.isDefault)
   *   4. null — caller surfaces 422 "no_model_available"
   *
   * The viewer is loaded ONCE so the three candidates share one entitlement
   * read. `userId` is required: without a viewer nothing is resolvable, which
   * keeps a controller that forgets to pass the user from silently handing out
   * restricted models.
   */
  async resolveActiveModel(params: {
    explicitModelId?: string | null;
    userId?: string | null;
  }): Promise<Model | null> {
    if (!params.userId) {
      this.logger.warn('resolveActiveModel called without userId; refusing to resolve a model');
      return null;
    }
    const viewer = await this.access.loadViewer(params.userId);

    // 1. Explicit selection takes priority — user chose in-request.
    if (params.explicitModelId) {
      const explicit = await this.repo.findOne({ where: { id: params.explicitModelId } });
      if (explicit && this.access.canAccess(viewer, explicit)) return explicit;
    }

    // 2. Sticky user choice (User.lastSelectedModelId).
    const userRow = await this.repo.manager
      .createQueryBuilder()
      .select('last_selected_model_id')
      .from('users', 'u')
      .where('u.id = :uid', { uid: params.userId })
      .getRawOne<{ last_selected_model_id: string }>();

    const stickyId = userRow?.last_selected_model_id;
    if (stickyId) {
      const sticky = await this.repo.findOne({ where: { id: stickyId } });
      if (sticky && this.access.canAccess(viewer, sticky)) return sticky;
    }

    // 3. Admin default model (AppConfig.default_model_id → Model).
    const appConfigRow = await this.repo.manager
      .createQueryBuilder()
      .select('ac.default_model_id')
      .from('app_config', 'ac')
      .where('ac.id = :sid', { sid: 'singleton' })
      .getRawOne<{ default_model_id: string }>();

    const defaultId = appConfigRow?.default_model_id;
    if (defaultId) {
      const defaultModel = await this.repo.findOne({ where: { id: defaultId } });
      if (defaultModel && this.access.canAccess(viewer, defaultModel)) return defaultModel;
    }
    return null;
  }
```

Add `private readonly logger = new Logger(ModelsService.name);` and the `Logger` import to `models.service.ts` (it has no logger yet).

- [ ] **Step 4: Enforce entitlement in `ChatService`**

In `backend/src/modules/chat/chat.service.ts`, add the import and the constructor dependency:

```typescript
import { ModelAccessService } from '../models/model-access.service';
```

```typescript
  constructor(
    private readonly models: ModelsService,
    private readonly access: ModelAccessService,
    private readonly runtime: ProviderRuntimeService,
    private readonly conversations: ConversationsService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}
```

Replace the explicit-model block at the top of `runStream` (the `if (dto.modelId) { ... }` setup phase, and the `if (!model)` block that follows it) with the code below. Add `import { Model } from '../models/entities/model.entity';` to the file's imports first, so both locals can be typed as the entity instead of an inline shape:

```typescript
      let model: Model | null = null;

      // Explicit modelId validation: when the client picks a specific model we
      // verify existence + enabled FIRST (preserving the existing
      // `model_unavailable` contract for unknown/disabled ids), then verify
      // entitlement (`model_forbidden`). No conversation or provider work
      // happens for either failure.
      if (dto.modelId) {
        let explicit: Model | null = null;
        try {
          explicit = await this.models.findById(dto.modelId);
        } catch (err) {
          if (err instanceof NotFoundException) {
            explicit = null;
          } else {
            throw err;
          }
        }

        if (!explicit || !explicit.enabled) {
          if (isActive()) {
            observer.next({
              event: 'error',
              data: {
                code: 'model_unavailable',
                message: 'The selected model is not available. Choose another model or remove the selection.',
              },
            });
          }
          observer.complete();
          return;
        }

        if (!(await this.access.canAccessUser(userId, explicit))) {
          if (isActive()) {
            observer.next({
              event: 'error',
              data: {
                code: 'model_forbidden',
                message: 'You do not have access to this model.',
              },
            });
          }
          observer.complete();
          return;
        }

        model = explicit;
      }

      if (!model) {
        // No explicit selection (or it failed) → sticky/default resolver, which
        // is itself access-filtered.
        model = await this.models.resolveActiveModel({ explicitModelId: null, userId });
        if (!model) {
          if (isActive()) {
            observer.next({
              event: 'error',
              data: {
                code: 'no_model_available',
                message: 'No model is available for your account. Ask an admin to grant access or set a default model.',
              },
            });
          }
          observer.complete();
          return;
        }
      }
```

The net effect is that both old blocks (the explicit-selection validation and the following `if (!model) { if (dto.modelId) { ... } else { ... } }` fallback) are replaced by the single flow above: explicit selection first (`model_unavailable` → `model_forbidden` → proceed), and only when nothing was explicitly selected does the sticky/default resolver run.

- [ ] **Step 5: Run the chat tests**

Run: `cd backend && npx jest test/unit/chat.service.spec.ts --no-coverage`
Expected: PASS (new entitlement cases + all pre-existing cases).

- [ ] **Step 6: Type-check**

Run: `cd backend && npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 7: Suggested commit message**

```
Suggested commit message: feat(chat): reject unentitled models with model_forbidden and resolve models per caller entitlement
```

---

## Task 6: Entitlement gates on the two user model-selection endpoints

**Files:**
- Modify: `backend/src/modules/conversations/conversations.controller.ts`
- Modify: `backend/src/modules/users/users.controller.ts`
- Modify: `backend/test/unit/users.controller.spec.ts`
- Test: `backend/test/unit/conversations-controller-model.spec.ts` (new)

**Interfaces:**
- Consumes: `ModelAccessService.assertCanUseModel` (Task 3).
- Produces:
  - `PATCH /v1/conversations/{id}/model`: unknown **or** disabled model → `422 model_unavailable`; existing+enabled but unentitled → `403 model_forbidden`; non-owner → `403 forbidden`; missing conversation → `404 conversation_not_found`; success → `200` `ConversationSummary`.
  - `PATCH /v1/users/me/model-preference`: same three model outcomes (422 / 403 / 200); `null`/omitted clears the preference.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/unit/conversations-controller-model.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConversationsController } from '../../src/modules/conversations/conversations.controller';
import { ConversationsService } from '../../src/modules/conversations/conversations.service';
import { ModelsService } from '../../src/modules/models/models.service';
import { ModelAccessService } from '../../src/modules/models/model-access.service';

describe('ConversationsController.setModel', () => {
  let controller: ConversationsController;
  let conversations: { setModel: jest.Mock };
  let models: { findById: jest.Mock };
  let access: { assertCanUseModel: jest.Mock };

  const conversation = {
    id: 'conv-1',
    modelId: 'pub',
    title: 't',
    pinned: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  beforeEach(async () => {
    conversations = { setModel: jest.fn().mockResolvedValue(conversation) };
    models = { findById: jest.fn() };
    access = { assertCanUseModel: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      controllers: [ConversationsController],
      providers: [
        { provide: ConversationsService, useValue: conversations },
        { provide: ModelsService, useValue: models },
        { provide: ModelAccessService, useValue: access },
      ],
    }).compile();

    controller = moduleRef.get(ConversationsController);
  });

  it('maps an unknown model to 422 model_unavailable (never a 404)', async () => {
    models.findById.mockRejectedValue(new NotFoundException({ code: 'model_not_found', message: 'Model not found.' }));

    const err = await controller
      .setModel({ id: 'u-1' } as never, 'conv-1', { modelId: 'nope' })
      .catch((e) => e);

    expect(err.getStatus()).toBe(422);
    expect(err.getResponse()).toMatchObject({ code: 'model_unavailable' });
    expect(conversations.setModel).not.toHaveBeenCalled();
  });

  it('delegates entitlement to ModelAccessService and returns the updated summary', async () => {
    models.findById.mockResolvedValue({ id: 'com', enabled: true, visibility: 'commercial' });

    const result = await controller.setModel({ id: 'u-1' } as never, 'conv-1', { modelId: 'com' });

    expect(access.assertCanUseModel).toHaveBeenCalledWith('u-1', expect.objectContaining({ id: 'com' }));
    expect(result.id).toBe('conv-1');
  });

  it('propagates the 403 model_forbidden raised by the policy service', async () => {
    models.findById.mockResolvedValue({ id: 'priv', enabled: true, visibility: 'private' });
    access.assertCanUseModel.mockRejectedValue(
      new ForbiddenException({ code: 'model_forbidden', message: 'no' }),
    );

    const err = await controller
      .setModel({ id: 'u-1' } as never, 'conv-1', { modelId: 'priv' })
      .catch((e) => e);

    expect(err.getStatus()).toBe(403);
    expect(err.getResponse()).toMatchObject({ code: 'model_forbidden' });
    expect(conversations.setModel).not.toHaveBeenCalled();
  });
});
```

In `backend/test/unit/users.controller.spec.ts`, add `ModelAccessService` to the providers and assert delegation:

```typescript
// import { ModelAccessService } from '../../src/modules/models/model-access.service';

  let access: { assertCanUseModel: jest.Mock };

  beforeEach(async () => {
    // ...
    access = { assertCanUseModel: jest.fn().mockResolvedValue(undefined) };
    // providers: [..., { provide: ModelAccessService, useValue: access }]
  });
```

```typescript
    it('denies an unentitled but enabled model with model_forbidden', async () => {
      models.findById.mockResolvedValue({ id: 'com', enabled: true, visibility: 'commercial' });
      access.assertCanUseModel.mockRejectedValue(
        new ForbiddenException({ code: 'model_forbidden', message: 'no' }),
      );

      const err = await controller
        .setModelPreference({ id: 'u-1' } as never, { modelId: 'com' })
        .catch((e) => e);

      expect(err.getStatus()).toBe(403);
      expect(err.getResponse()).toMatchObject({ code: 'model_forbidden' });
      expect(users.setModelPreference).not.toHaveBeenCalled();
    });

    it('maps an unknown model id to 422 model_unavailable', async () => {
      models.findById.mockRejectedValue(new NotFoundException({ code: 'model_not_found', message: 'x' }));

      const err = await controller
        .setModelPreference({ id: 'u-1' } as never, { modelId: 'nope' })
        .catch((e) => e);

      expect(err.getStatus()).toBe(422);
      expect(err.getResponse()).toMatchObject({ code: 'model_unavailable' });
    });
```

(`ForbiddenException` / `NotFoundException` imports must be added to that spec's `@nestjs/common` import.)

- [ ] **Step 2: Run them to confirm they fail**

Run: `cd backend && npx jest test/unit/conversations-controller-model.spec.ts test/unit/users.controller.spec.ts --no-coverage`
Expected: FAIL — the controllers do not inject `ModelAccessService`, and unknown ids surface as 404.

- [ ] **Step 3: Add a shared gated lookup to `ConversationsController`**

In `backend/src/modules/conversations/conversations.controller.ts`:

```typescript
import { ModelAccessService } from '../models/model-access.service';
import { Model } from '../models/entities/model.entity';
```

```typescript
  constructor(
    private readonly conversations: ConversationsService,
    private readonly models: ModelsService,
    private readonly access: ModelAccessService,
  ) {}
```

Replace the body of `setModel`'s model check with the helper:

```typescript
  @Patch(':id/model')
  async setModel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SetConversationModelDto,
  ): Promise<{ id: string; modelId: string; modelDisplayName: string | null; title: string | null; pinned: boolean; createdAt: string; updatedAt: string }> {
    await this.requireUsableModel(user.id, dto.modelId);
    const updated = await this.conversations.setModel(id, user.id, dto.modelId);
    if (!updated) {
      throw new NotFoundException({
        code: 'conversation_not_found',
        message: 'Conversation not found.',
      });
    }
    return this.toSummary(updated);
  }
```

Add the helper to the same controller (private section, next to `toSummary`):

```typescript
  /**
   * Resolve a client-supplied model id into "usable by this caller".
   *
   * Contract mapping (spec 003 §Acceptance criteria — "unauthorized model
   * requests are rejected server-side"):
   *   - unknown id  → 422 model_unavailable (an unknown id is never a 404 here;
   *     that would leak the difference between "no such model" and "not yours")
   *   - disabled    → 422 model_unavailable
   *   - unentitled  → 403 model_forbidden
   */
  private async requireUsableModel(userId: string, modelId: string): Promise<Model> {
    let model: Model | null = null;
    try {
      model = await this.models.findById(modelId);
    } catch (err) {
      if (!(err instanceof NotFoundException)) throw err;
    }
    if (!model) {
      throw new UnprocessableEntityException({
        code: 'model_unavailable',
        message: 'The selected model is not available.',
      });
    }
    await this.access.assertCanUseModel(userId, model);
    return model;
  }
```

- [ ] **Step 4: Apply the same gate to `users.controller.ts`**

In `backend/src/modules/users/users.controller.ts`:

```typescript
import { ModelsService } from '../models/models.service';
import { ModelAccessService } from '../models/model-access.service';
```

```typescript
  constructor(
    private readonly users: UsersService,
    private readonly models: ModelsService,
    private readonly access: ModelAccessService,
  ) {}
```

```typescript
  @Patch('me/model-preference')
  async setModelPreference(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SetModelPreferenceDto,
  ): Promise<{ modelId: string | null }> {
    let modelId: string | null = null;
    if (dto.modelId !== undefined && dto.modelId !== null) {
      let model;
      try {
        model = await this.models.findById(dto.modelId);
      } catch (err) {
        if (!(err instanceof NotFoundException)) throw err;
        model = null;
      }
      if (!model) {
        throw new UnprocessableEntityException({
          code: 'model_unavailable',
          message: 'The selected model is not available.',
        });
      }
      await this.access.assertCanUseModel(user.id, model);
      modelId = dto.modelId;
    }
    await this.users.setModelPreference(user.id, modelId);
    return { modelId };
  }
```

Add `NotFoundException` to the `@nestjs/common` imports of that file.

- [ ] **Step 5: Run the unit tests**

Run: `cd backend && npx jest test/unit/conversations-controller-model.spec.ts test/unit/users.controller.spec.ts test/unit/conversations.service.spec.ts --no-coverage`
Expected: PASS.

- [ ] **Step 6: Type-check**

Run: `cd backend && npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 7: Suggested commit message**

```
Suggested commit message: feat(conversations,users): gate conversation-model switch and model preference on model entitlement
```

---

## Task 7: Admin model visibility configuration

**Files:**
- Modify: `backend/src/modules/models/models.service.ts` (`CreateModelInput`, `UpdateModelInput`, `create`, `update`)
- Modify: `backend/src/modules/models/dto/model-upsert.dto.ts`
- Modify: `backend/src/modules/models/models.admin.controller.ts`
- Modify: `backend/test/unit/models.service.spec.ts`

**Interfaces:**
- Consumes: `MODEL_VISIBILITIES`, `ModelVisibility` (Task 2).
- Produces:
  - `CreateModelInput.visibility?: ModelVisibility` (default `public`), `UpdateModelInput.visibility?: ModelVisibility`.
  - `POST /v1/admin/models` and `PATCH /v1/admin/models/{id}` accept `visibility`; both echo `visibility` in the response.
  - `PATCH /v1/admin/models/{id}` refuses to make the current system default non-public: `409 { code: 'model_is_default' }`.

- [ ] **Step 1: Write the failing unit tests**

Add to `backend/test/unit/models.service.spec.ts`:

```typescript
  describe('create() visibility', () => {
    it('defaults to public and stores an explicit visibility', async () => {
      const created = await svc.create({
        displayName: 'Internal',
        actualName: 'internal-1',
        providerId: 'p1',
        visibility: 'private',
      });
      expect(created.visibility).toBe('private');
    });
  });

  describe('update() visibility', () => {
    it('refuses to demote the system default away from public', async () => {
      repo.__setRows([
        { id: 'm-default', displayName: 'Default', actualName: 'd', providerId: 'p1', visibility: 'public', enabled: true, isDefault: true },
      ] as any);

      const err = await svc
        .update('m-default', { visibility: 'commercial' })
        .catch((e) => e);

      expect(err.getStatus()).toBe(409);
      expect(err.getResponse()).toMatchObject({ code: 'model_is_default' });
    });

    it('allows demoting a non-default model', async () => {
      repo.__setRows([
        { id: 'm-plain', displayName: 'Plain', actualName: 'p', providerId: 'p1', visibility: 'public', enabled: true, isDefault: false },
      ] as any);

      const updated = await svc.update('m-plain', { visibility: 'private' });
      expect(updated.visibility).toBe('private');
    });
  });
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `cd backend && npx jest test/unit/models.service.spec.ts --no-coverage`
Expected: FAIL — `visibility` is ignored on create/update.

- [ ] **Step 3: Extend the service inputs and behavior**

In `backend/src/modules/models/models.service.ts`:

```typescript
import { ConflictException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { MODEL_VISIBILITIES, ModelVisibility } from './model-visibility';
```

```typescript
export interface CreateModelInput {
  displayName: string;
  actualName: string;
  providerId: string;
  visibility?: ModelVisibility;
  enabled?: boolean;
}

export interface UpdateModelInput {
  displayName?: string;
  actualName?: string;
  providerId?: string;
  visibility?: ModelVisibility;
  enabled?: boolean;
}
```

In `create()`, pass it through:

```typescript
    const created = this.repo.create({
      displayName,
      actualName,
      providerId: input.providerId,
      visibility: input.visibility ?? 'public',
      enabled,
      isDefault: false,
    });
    return this.repo.save(created);
```

In `update()`, add the guard **before** applying the patch, and then apply it:

```typescript
    if (input.visibility !== undefined) {
      if (!MODEL_VISIBILITIES.includes(input.visibility)) {
        throw new UnprocessableEntityException({
          code: 'validation_failed',
          message: 'visibility must be one of public, commercial, private.',
        });
      }
      // Invariant: the configured system default must stay usable by every
      // user. Demoting it would silently strand the default for most users,
      // so refuse and let the admin pick another default first.
      const cfg = await this.repo.manager
        .createQueryBuilder()
        .select('ac.default_model_id', 'default_model_id')
        .from('app_config', 'ac')
        .where('ac.id = :sid', { sid: 'singleton' })
        .getRawOne<{ default_model_id: string | null }>();
      if (input.visibility !== 'public' && (model.isDefault || cfg?.default_model_id === id)) {
        throw new ConflictException({
          code: 'model_is_default',
          message: 'This model is the system default. Choose another default before restricting its visibility.',
        });
      }
      model.visibility = input.visibility;
    }
```

Place this block right after the `input.providerId` handling and before `if (input.enabled !== undefined)`.

- [ ] **Step 4: Accept `visibility` in the DTO and echo it from the admin controller**

In `backend/src/modules/models/dto/model-upsert.dto.ts`:

```typescript
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength, Matches } from 'class-validator';
import { PROVIDER_ID_PATTERN } from '../../provider/dto/create-provider.dto';
import { MODEL_VISIBILITIES, ModelVisibility } from '../model-visibility';
```

```typescript
  @IsOptional()
  @IsIn(MODEL_VISIBILITIES as unknown as string[], {
    message: 'visibility must be one of public, commercial, private',
  })
  visibility?: ModelVisibility;
```

In `backend/src/modules/models/models.admin.controller.ts` — pass `visibility` into both service calls and include it in `toAdminShape` plus the `list()` projection:

```typescript
      items: all.map((m) => ({
        id: m.id,
        displayName: m.displayName,
        actualName: m.actualName,
        providerId: m.providerId,
        visibility: m.visibility,
        enabled: m.enabled,
        isDefault: m.isDefault,
        createdAt: m.createdAt.toISOString(),
        updatedAt: m.updatedAt.toISOString(),
      })),
```

```typescript
    const m = await this.models.create({
      displayName: body.displayName!,
      actualName: body.actualName!,
      providerId: body.providerId!,
      visibility: body.visibility,
      enabled: body.enabled,
    });
```

```typescript
    const m = await this.models.update(id, {
      displayName: body.displayName,
      actualName: body.actualName,
      providerId: body.providerId,
      visibility: body.visibility,
      enabled: body.enabled,
    });
```

and in `toAdminShape`'s parameter type add `visibility: ModelVisibility;` (import the type) and `visibility: m.visibility,` in the returned object.

- [ ] **Step 5: Run the tests and type-check**

Run: `cd backend && npx jest test/unit/models.service.spec.ts test/unit/models.public.controller.spec.ts --no-coverage && npx tsc --noEmit`
Expected: PASS, zero type errors.

- [ ] **Step 6: Suggested commit message**

```
Suggested commit message: feat(models): let admins configure model visibility and protect the system default
```

---

## Task 8: Admin user access-tier management

**Files:**
- Create: `backend/src/modules/users/dto/set-access-tier.dto.ts`
- Create: `backend/src/modules/users/users.admin.controller.ts`
- Modify: `backend/src/modules/users/users.service.ts`
- Modify: `backend/src/modules/users/users.module.ts`
- Test: `backend/test/unit/users.admin.controller.spec.ts`

**Interfaces:**
- Consumes: `USER_ACCESS_TIERS`, `UserAccessTier` (Task 2).
- Produces:
  - `UsersService.listForAdmin({ query?, limit, offset }): Promise<{ items: User[]; total: number }>` — case-insensitive substring match on email or username, ordered by email ASC.
  - `UsersService.setAccessTier(id: string, accessTier: UserAccessTier): Promise<User>` — throws `NotFoundException({ code: 'user_not_found' })`.
  - `SetUserAccessTierDto { accessTier: UserAccessTier }`.
  - `GET /v1/admin/users?query=&limit=&offset=` → `{ items: AdminUser[], total }`; `PATCH /v1/admin/users/{id}/access-tier` → `AdminUser`.
  - `AdminUser = { id, email, username, role, accessTier, createdAt }` — never the password hash.

- [ ] **Step 1: Write the failing unit test**

Create `backend/test/unit/users.admin.controller.spec.ts`:

```typescript
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UsersAdminController } from '../../src/modules/users/users.admin.controller';
import { UsersService } from '../../src/modules/users/users.service';
import { User } from '../../src/modules/users/entities/user.entity';

describe('UsersAdminController', () => {
  let controller: UsersAdminController;
  let users: { listForAdmin: jest.Mock; setAccessTier: jest.Mock };

  const sampleUser = (overrides: Partial<User> = {}): User =>
    ({
      id: 'u-1',
      email: 'a@example.com',
      username: 'john_doe',
      passwordHash: 'super-secret-hash',
      role: 'user',
      accessTier: 'free',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      ...overrides,
    } as User);

  beforeEach(async () => {
    users = {
      listForAdmin: jest.fn(),
      setAccessTier: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [UsersAdminController],
      providers: [{ provide: UsersService, useValue: users }],
    }).compile();
    controller = moduleRef.get(UsersAdminController);
  });

  it('lists users without leaking the password hash and defaults pagination', async () => {
    users.listForAdmin.mockResolvedValue({ items: [sampleUser()], total: 1 });

    const result = await controller.list(undefined, undefined, undefined);

    expect(users.listForAdmin).toHaveBeenCalledWith({ query: undefined, limit: 20, offset: 0 });
    expect(result.total).toBe(1);
    expect(result.items[0]).toEqual({
      id: 'u-1',
      email: 'a@example.com',
      username: 'john_doe',
      role: 'user',
      accessTier: 'free',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(JSON.stringify(result)).not.toContain('super-secret-hash');
  });

  it('clamps limit to 100 and forwards the search term', async () => {
    users.listForAdmin.mockResolvedValue({ items: [], total: 0 });
    await controller.list('ali', '500', '5');
    expect(users.listForAdmin).toHaveBeenCalledWith({ query: 'ali', limit: 100, offset: 5 });
  });

  it('returns 404 user_not_found from the service', async () => {
    users.setAccessTier.mockRejectedValue(
      new NotFoundException({ code: 'user_not_found', message: 'User not found.' }),
    );

    const err = await controller.setAccessTier('missing', { accessTier: 'commercial' }).catch((e) => e);

    expect(err.getStatus()).toBe(404);
    expect(err.getResponse()).toMatchObject({ code: 'user_not_found' });
  });

  it('returns the updated tier', async () => {
    users.setAccessTier.mockResolvedValue(sampleUser({ accessTier: 'commercial' }));

    const result = await controller.setAccessTier('u-1', { accessTier: 'commercial' });

    expect(users.setAccessTier).toHaveBeenCalledWith('u-1', 'commercial');
    expect(result.accessTier).toBe('commercial');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd backend && npx jest test/unit/users.admin.controller.spec.ts --no-coverage`
Expected: FAIL — `UsersAdminController` does not exist.

- [ ] **Step 3: Add the DTO**

Create `backend/src/modules/users/dto/set-access-tier.dto.ts`:

```typescript
import { IsIn } from 'class-validator';
import { USER_ACCESS_TIERS, UserAccessTier } from '../../models/model-visibility';

/**
 * Body of PATCH /v1/admin/users/:id/access-tier.
 *
 * `free` is the floor every account starts at; `commercial` unlocks models
 * whose visibility is `commercial`. `IsIn` (not IsEnum) keeps the vocabulary
 * in one place — `models/model-visibility.ts`.
 */
export class SetUserAccessTierDto {
  @IsIn(USER_ACCESS_TIERS as unknown as string[], {
    message: 'accessTier must be one of free, commercial',
  })
  accessTier!: UserAccessTier;
}
```

- [ ] **Step 4: Add the service methods**

In `backend/src/modules/users/users.service.ts`, add the import and the two methods:

```typescript
import { USER_ACCESS_TIERS, UserAccessTier } from '../models/model-visibility';
```

```typescript
  /**
   * Admin: paginated user list with an optional case-insensitive substring
   * match on email or username. Returns the rows plus the unpaginated total so
   * the admin UI can show "n of m". Ordering is by email for stability.
   */
  async listForAdmin(params: {
    query?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: User[]; total: number }> {
    const qb = this.repo
      .createQueryBuilder('u')
      .orderBy('u.email', 'ASC')
      .skip(params.offset)
      .take(params.limit);

    const term = params.query?.trim();
    if (term) {
      qb.where('LOWER(u.email) LIKE :term OR LOWER(u.username) LIKE :term', {
        term: `%${term.toLowerCase()}%`,
      });
    }

    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }

  /**
   * Admin: set a user's entitlement tier. Throws 404 `user_not_found` for an
   * unknown id so the admin UI can distinguish "gone" from "invalid input".
   */
  async setAccessTier(id: string, accessTier: UserAccessTier): Promise<User> {
    if (!USER_ACCESS_TIERS.includes(accessTier)) {
      throw new UnprocessableEntityException({
        code: 'validation_failed',
        message: 'accessTier must be one of free, commercial.',
      });
    }
    const user = await this.repo.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException({ code: 'user_not_found', message: 'User not found.' });
    }
    user.accessTier = accessTier;
    return this.repo.save(user);
  }
```

Add `UnprocessableEntityException` to the `@nestjs/common` import list of that file.

- [ ] **Step 5: Add the controller**

Create `backend/src/modules/users/users.admin.controller.ts`:

```typescript
import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UsersService } from './users.service';
import { SetUserAccessTierDto } from './dto/set-access-tier.dto';
import type { User } from './entities/user.entity';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Admin-only access-tier management (spec 003 §Scope — "Associate models with
 * the required role, subscription, or user group").
 *
 * Deliberately narrow: this surface assigns the entitlement tier a model's
 * visibility is checked against. It is NOT account administration (no create,
 * disable, delete, or password reset) — that remains out of scope per spec 001.
 */
@Controller('v1/admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class UsersAdminController {
  constructor(private readonly users: UsersService) {}

  @Get()
  async list(
    @Query('query') query?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const parsedLimit = Number.parseInt(limit ?? '', 10);
    const parsedOffset = Number.parseInt(offset ?? '', 10);
    const safeLimit =
      Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, MAX_LIMIT) : DEFAULT_LIMIT;
    const safeOffset = Number.isFinite(parsedOffset) && parsedOffset > 0 ? parsedOffset : 0;

    const { items, total } = await this.users.listForAdmin({
      query,
      limit: safeLimit,
      offset: safeOffset,
    });
    return { items: items.map((u) => this.toAdminUser(u)), total };
  }

  @Patch(':id/access-tier')
  async setAccessTier(@Param('id') id: string, @Body() dto: SetUserAccessTierDto) {
    const updated = await this.users.setAccessTier(id, dto.accessTier);
    return this.toAdminUser(updated);
  }

  private toAdminUser(u: User) {
    return {
      id: u.id,
      email: u.email,
      username: u.username,
      role: u.role,
      accessTier: u.accessTier,
      createdAt: u.createdAt.toISOString(),
    };
  }
}
```

- [ ] **Step 6: Register the controller**

In `backend/src/modules/users/users.module.ts`:

```typescript
import { UsersAdminController } from './users.admin.controller';
```

```typescript
  controllers: [UsersController, UsersAdminController],
```

- [ ] **Step 7: Run the tests and type-check**

Run: `cd backend && npx jest test/unit/users.admin.controller.spec.ts test/unit/users.service.spec.ts test/unit/users.controller.spec.ts --no-coverage && npx tsc --noEmit`
Expected: PASS, zero type errors.

- [ ] **Step 8: Suggested commit message**

Suggested commit message:

```
Suggested commit message: feat(users): add admin user listing and access-tier assignment endpoints
```

---

## Task 9: Default model must be public

**Files:**
- Modify: `backend/src/modules/app-config/app-config.service.ts`
- Modify: `backend/test/unit/app-config.service.spec.ts`

**Interfaces:**
- Consumes: `Model.visibility` (Task 2).
- Produces: `AppConfigService.update()` rejects a default model whose visibility is not `public` with `422 { code: 'model_not_eligible_default' }` (the existing code, extended); disabled models keep the same error.

- [ ] **Step 1: Write the failing unit test**

The spec's `seedModel` helper currently builds rows as `{ id, enabled, isDefault }`. Give it the visibility field (defaulting to `public`, so every existing case keeps passing) and add the new case:

```typescript
  function seedModel(
    id: string,
    enabled = true,
    isDefault = false,
    visibility: 'public' | 'commercial' | 'private' = 'public',
  ) {
    models.set(id, { id, enabled, isDefault, visibility });
  }
```

```typescript
    it('rejects with 422 when the referenced model is not public', async () => {
      seedModel('com-1', true, false, 'commercial');

      const err = await svc.update({ defaultModelId: 'com-1' }).catch((e) => e);

      expect(err).toBeInstanceOf(UnprocessableEntityException);
      expect(err.getResponse()).toMatchObject({ code: 'model_not_eligible_default' });
      expect(err.getResponse().message).toMatch(/public/i);
    });
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd backend && npx jest test/unit/app-config.service.spec.ts --no-coverage`
Expected: FAIL — a commercial model is accepted as the default.

- [ ] **Step 3: Enforce it**

In `backend/src/modules/app-config/app-config.service.ts`, inside `update()`'s validation block:

```typescript
      if (!m.enabled) {
        throw new UnprocessableEntityException({
          code: 'model_not_eligible_default',
          message: 'Only enabled models can be the default.',
        });
      }
      // The default model is preselected for every user, so it must be visible
      // to everyone (spec 003 §Decision recap). Commercial/private models can
      // still be selected explicitly by entitled users.
      if (m.visibility !== 'public') {
        throw new UnprocessableEntityException({
          code: 'model_not_eligible_default',
          message: 'Only public models can be the default. Set the model visibility to public first.',
        });
      }
```

- [ ] **Step 4: Run the tests and type-check**

Run: `cd backend && npx jest test/unit/app-config.service.spec.ts --no-coverage && npx tsc --noEmit`
Expected: PASS, zero type errors.

- [ ] **Step 5: Suggested commit message**

```
Suggested commit message: feat(app-config): require the default model to be public
```

---

## Task 10: End-to-end acceptance suite

**Files:**
- Create: `backend/test/integration/access-control.e2e.spec.ts`

**Interfaces:**
- Consumes: everything above; the working PostgreSQL harness pattern from `test/integration/chat.stream.e2e.spec.ts`.
- Produces: executable proof of the phase's acceptance criteria (public access, restricted access, server-side rejection, admin configuration, catalog never exposing inaccessible models, existing chat permissions intact).

- [ ] **Step 1: Write the suite**

Create `backend/test/integration/access-control.e2e.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { Provider } from '../../src/modules/provider/entities/provider.entity';
import { Model } from '../../src/modules/models/entities/model.entity';
import { User } from '../../src/modules/users/entities/user.entity';
import { AppConfig } from '../../src/modules/app-config/entities/app-config.entity';
import { ConversationsService } from '../../src/modules/conversations/conversations.service';
import { encrypt } from '../../src/common/crypto/credential-cipher';

/**
 * Phase 3 acceptance suite (PostgreSQL on localhost:5433, database
 * `chatbot_test`).
 *
 * Runs are id-scoped (`RUN`) so the suite is re-runnable against a shared test
 * database, and assertions are containment-based because other suites may have
 * seeded their own public models alongside ours.
 */
describe('Model access control — e2e', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tokens: { free: string; commercial: string; admin: string };
  let freeUserId: string;

  const RUN = Date.now().toString(36);
  const PASSWORD = 'correct-horse-battery-staple';
  const EMAILS = {
    free: `access-free-${RUN}@example.com`,
    commercial: `access-com-${RUN}@example.com`,
    admin: `access-admin-${RUN}@example.com`,
  };
  const IDS = {
    public: `pub-${RUN}`,
    commercial: `com-${RUN}`,
    private: `priv-${RUN}`,
    disabled: `dis-${RUN}`,
  };

  jest.setTimeout(60_000);

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DB_DRIVER = 'postgres';
    process.env.POSTGRES_DB = 'chatbot_test';
    process.env.JWT_SECRET = 'integration-test-secret-with-enough-entropy-here';
    process.env.JWT_REFRESH_SECRET = 'integration-test-refresh-secret-entropy';
    process.env.PROVIDER_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64');

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    ds = app.get(DataSource);
    await ds.runMigrations();

    const providerRepo = ds.getRepository(Provider);
    await providerRepo.save(
      providerRepo.create({
        id: `prov-${RUN}`,
        name: `Access Provider ${RUN}`,
        type: 'openai-compatible',
        baseUrl: 'http://localhost:9999',
        apiKeyEncrypted: encrypt('test-api-key'),
        isActive: true,
      }),
    );

    const modelRepo = ds.getRepository(Model);
    await modelRepo.save([
      modelRepo.create({ id: IDS.public, displayName: `Public ${RUN}`, actualName: 'pub', providerId: `prov-${RUN}`, visibility: 'public', enabled: true }),
      modelRepo.create({ id: IDS.commercial, displayName: `Commercial ${RUN}`, actualName: 'com', providerId: `prov-${RUN}`, visibility: 'commercial', enabled: true }),
      modelRepo.create({ id: IDS.private, displayName: `Private ${RUN}`, actualName: 'priv', providerId: `prov-${RUN}`, visibility: 'private', enabled: true }),
      modelRepo.create({ id: IDS.disabled, displayName: `Disabled ${RUN}`, actualName: 'dis', providerId: `prov-${RUN}`, visibility: 'public', enabled: false }),
    ]);

    const userRepo = ds.getRepository(User);
    const passwordHash = await argon2.hash(PASSWORD);
    await userRepo.save([
      userRepo.create({ email: EMAILS.free, passwordHash, role: 'user', accessTier: 'free' }),
      userRepo.create({ email: EMAILS.commercial, passwordHash, role: 'user', accessTier: 'commercial' }),
      userRepo.create({ email: EMAILS.admin, passwordHash, role: 'admin', accessTier: 'free' }),
    ]);

    const userLogin = async (email: string): Promise<string> =>
      (
        await request(app.getHttpServer())
          .post('/v1/auth/login')
          .send({ email, password: PASSWORD })
      ).body.accessToken;

    const adminLogin = await request(app.getHttpServer())
      .post('/v1/admin/auth/login')
      .send({ email: EMAILS.admin, password: PASSWORD });

    tokens = {
      free: await userLogin(EMAILS.free),
      commercial: await userLogin(EMAILS.commercial),
      admin: adminLogin.body.accessToken,
    };
    freeUserId = (await userRepo.findOneOrFail({ where: { email: EMAILS.free } })).id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  async function catalogIds(token: string): Promise<string[]> {
    const res = await request(app.getHttpServer())
      .get('/v1/models')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body.items.map((i: { id: string }) => i.id);
  }

  async function createConversation(): Promise<string> {
    const conversations = app.get(ConversationsService);
    const conv = await conversations.create({
      userId: freeUserId,
      modelId: IDS.public,
      userMessage: 'seed',
    });
    return conv.id;
  }

  it('AC: a free user sees only public enabled models', async () => {
    const ids = await catalogIds(tokens.free);
    expect(ids).toContain(IDS.public);
    expect(ids).not.toContain(IDS.commercial);
    expect(ids).not.toContain(IDS.private);
    expect(ids).not.toContain(IDS.disabled);
  });

  it('AC: a commercial user additionally sees commercial models', async () => {
    const ids = await catalogIds(tokens.commercial);
    expect(ids).toContain(IDS.public);
    expect(ids).toContain(IDS.commercial);
    expect(ids).not.toContain(IDS.private);
  });

  it('AC: an admin sees private models but never disabled ones', async () => {
    const ids = await catalogIds(tokens.admin);
    expect(ids).toContain(IDS.public);
    expect(ids).toContain(IDS.commercial);
    expect(ids).toContain(IDS.private);
    expect(ids).not.toContain(IDS.disabled);
  });

  it('the public catalog never exposes admin-only fields', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/models')
      .set('Authorization', `Bearer ${tokens.free}`);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('actualName');
    expect(serialized).not.toContain('enabled');
    for (const item of res.body.items) {
      expect(Object.keys(item).sort()).toEqual(['displayName', 'id', 'isDefault']);
    }
  });

  it('AC: switching a conversation to an unentitled model is rejected server-side', async () => {
    const conversationId = await createConversation();

    const commercial = await request(app.getHttpServer())
      .patch(`/v1/conversations/${conversationId}/model`)
      .set('Authorization', `Bearer ${tokens.free}`)
      .send({ modelId: IDS.commercial });
    expect(commercial.status).toBe(403);
    expect(commercial.body.code).toBe('model_forbidden');

    const priv = await request(app.getHttpServer())
      .patch(`/v1/conversations/${conversationId}/model`)
      .set('Authorization', `Bearer ${tokens.free}`)
      .send({ modelId: IDS.private });
    expect(priv.status).toBe(403);
    expect(priv.body.code).toBe('model_forbidden');

    const unknown = await request(app.getHttpServer())
      .patch(`/v1/conversations/${conversationId}/model`)
      .set('Authorization', `Bearer ${tokens.free}`)
      .send({ modelId: '00000000-0000-4000-8000-000000000999' });
    expect(unknown.status).toBe(422);
    expect(unknown.body.code).toBe('model_unavailable');

    const disabled = await request(app.getHttpServer())
      .patch(`/v1/conversations/${conversationId}/model`)
      .set('Authorization', `Bearer ${tokens.free}`)
      .send({ modelId: IDS.disabled });
    expect(disabled.status).toBe(422);
    expect(disabled.body.code).toBe('model_unavailable');

    // The model is untouched by every rejected attempt.
    const detail = await request(app.getHttpServer())
      .get(`/v1/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${tokens.free}`);
    expect(detail.body.modelId).toBe(IDS.public);
  });

  it('AC: the sticky model preference rejects unentitled models', async () => {
    const denied = await request(app.getHttpServer())
      .patch('/v1/users/me/model-preference')
      .set('Authorization', `Bearer ${tokens.free}`)
      .send({ modelId: IDS.commercial });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('model_forbidden');

    const allowed = await request(app.getHttpServer())
      .patch('/v1/users/me/model-preference')
      .set('Authorization', `Bearer ${tokens.free}`)
      .send({ modelId: IDS.public });
    expect(allowed.status).toBe(200);
    expect(allowed.body.modelId).toBe(IDS.public);
  });

  it('AC: the chat stream emits model_forbidden for an unentitled explicit model', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/chat/stream')
      .set('Authorization', `Bearer ${tokens.free}`)
      .set('Accept', 'text/event-stream')
      .send({ message: 'hello', modelId: IDS.private });

    expect(res.status).toBe(200);
    expect(res.text).toContain('model_forbidden');
  });    it('AC: an admin can configure model access and the change takes effect immediately', async () =>
 {
    const create = await request(app.getHttpServer())
      .post('/v1/admin/models')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({
        displayName: `Granted ${RUN}`,
        actualName: 'granted',
        providerId: `prov-${RUN}`,
        visibility: 'commercial',
      });
    expect(create.status).toBe(201);
    expect(create.body.visibility).toBe('commercial');

    await request(app.getHttpServer())
      .patch(`/v1/admin/models/${IDS.commercial}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ visibility: 'public' })
      .expect(200);

    expect(await catalogIds(tokens.free)).toContain(IDS.commercial);

    await request(app.getHttpServer())
      .patch(`/v1/admin/models/${IDS.commercial}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ visibility: 'commercial' })
      .expect(200);

    expect(await catalogIds(tokens.free)).not.toContain(IDS.commercial);
  });

  it('AC: an admin can grant a tier and the user gains access on the next request', async () => {
    const list = await request(app.getHttpServer())
      .get(`/v1/admin/users?query=${encodeURIComponent(EMAILS.free)}`)
      .set('Authorization', `Bearer ${tokens.admin}`);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].accessTier).toBe('free');

    const grant = await request(app.getHttpServer())
      .patch(`/v1/admin/users/${freeUserId}/access-tier`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ accessTier: 'commercial' });
    expect(grant.status).toBe(200);
    expect(grant.body.accessTier).toBe('commercial');

    expect(await catalogIds(tokens.free)).toContain(IDS.commercial);

    await request(app.getHttpServer())
      .patch(`/v1/admin/users/${freeUserId}/access-tier`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ accessTier: 'free' })
      .expect(200);
    expect(await catalogIds(tokens.free)).not.toContain(IDS.commercial);
  });

  it('non-admins cannot reach the admin access surface', async () => {
    const list = await request(app.getHttpServer())
      .get('/v1/admin/users')
      .set('Authorization', `Bearer ${tokens.free}`);
    expect(list.status).toBe(403);

    const grant = await request(app.getHttpServer())
      .patch(`/v1/admin/users/${freeUserId}/access-tier`)
      .set('Authorization', `Bearer ${tokens.free}`)
      .send({ accessTier: 'commercial' });
    expect(grant.status).toBe(403);

    const patchModel = await request(app.getHttpServer())
      .patch(`/v1/admin/models/${IDS.commercial}`)
      .set('Authorization', `Bearer ${tokens.free}`)
      .send({ visibility: 'public' });
    expect(patchModel.status).toBe(403);
  });

  it('an invalid access tier is rejected at the boundary', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/v1/admin/users/${freeUserId}/access-tier`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ accessTier: 'enterprise' });
    expect(res.status).toBe(400);
  });

  it('the system default cannot be made non-public', async () => {
    const cfgRepo = ds.getRepository(AppConfig);
    const previous = await cfgRepo.findOne({ where: { id: 'singleton' } });

    const put = await request(app.getHttpServer())
      .put('/v1/admin/config')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ defaultModelId: IDS.commercial });
    expect(put.status).toBe(422);
    expect(put.body.code).toBe('model_not_eligible_default');

    const setPublic = await request(app.getHttpServer())
      .put('/v1/admin/config')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ defaultModelId: IDS.public });
    expect(setPublic.status).toBe(200);

    const demote = await request(app.getHttpServer())
      .patch(`/v1/admin/models/${IDS.public}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ visibility: 'private' });
    expect(demote.status).toBe(409);
    expect(demote.body.code).toBe('model_is_default');

    // Restore the singleton pointer.
    if (previous?.defaultModelId) {
      await request(app.getHttpServer())
        .put('/v1/admin/config')
        .set('Authorization', `Bearer ${tokens.admin}`)
        .send({ defaultModelId: previous.defaultModelId });
    }
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd backend && npx jest test/integration/access-control.e2e.spec.ts --no-coverage`
Expected: PASS. If the database is missing, create it first (see prerequisites) — the error will read `database "chatbot_test" does not exist`.

- [ ] **Step 3: Suggested commit message**

```
Suggested commit message: test(integration): cover model access control acceptance criteria end to end
```

---

## Task 11: Frontend — restricted-model handling in the chat surface

**Files:**
- Modify: `frontend/app/src/utils/errors.ts`
- Modify: `frontend/app/src/composables/useChatStream.ts`
- Modify: `frontend/app/src/components/chat/ModelPicker.vue`
- Test: `frontend/app/tests/utils/errors.spec.ts`

**Interfaces:**
- Consumes: backend `model_forbidden` (Tasks 5/6), `GET /v1/models` filtered catalog (Task 4).
- Produces:
  - `streamErrorMessage('model_forbidden')` and `apiErrorMessage` for the new codes.
  - `useChatStream` clears an unusable selection and reloads the catalog when the server rejects the model.
  - `ModelPicker` re-resolves its value whenever the catalog no longer contains the current selection.

- [ ] **Step 1: Write the failing test**

Create `frontend/app/tests/utils/errors.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { streamErrorMessage } from '@/utils/errors'

describe('streamErrorMessage', () => {
  it('explains an entitlement rejection', () => {
    expect(streamErrorMessage('model_forbidden')).toBe('این مدل برای حساب شما در دسترس نیست.')
  })

  it('explains a protected system default', () => {
    expect(streamErrorMessage('model_is_default')).toBe(
      'این مدل پیش‌فرض سیستم است؛ ابتدا مدل پیش‌فرض دیگری انتخاب کنید.',
    )
  })

  it('explains a missing user', () => {
    expect(streamErrorMessage('user_not_found')).toBe('کاربر یافت نشد.')
  })

  it('still falls back for unknown codes', () => {
    expect(streamErrorMessage('brand_new_code', 'server text')).toBe('server text')
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd frontend/app && npx vitest run tests/utils/errors.spec.ts`
Expected: FAIL — unknown codes fall through to the fallback string.

- [ ] **Step 3: Add the messages**

In `frontend/app/src/utils/errors.ts`, add to `MESSAGES` next to the existing `model_unavailable` entry:

```typescript
  model_forbidden: 'این مدل برای حساب شما در دسترس نیست.',
  model_is_default: 'این مدل پیش‌فرض سیستم است؛ ابتدا مدل پیش‌فرض دیگری انتخاب کنید.',
  user_not_found: 'کاربر یافت نشد.',
```

- [ ] **Step 4: Make the picker re-resolve a stale selection**

In `frontend/app/src/components/chat/ModelPicker.vue`, replace the watch body:

```typescript
watch(
  () => models.items,
  (items) => {
    // Re-resolve whenever the current value is not in the (entitlement-filtered)
    // catalog — e.g. an admin restricted the model after this client loaded it,
    // or the user's own access changed. Never leave an inaccessible model
    // selected.
    const current = props.modelValue
    if (current && items.some((m) => m.id === current)) return

    const last = (() => {
      try {
        return sessionStorage.getItem('mmcb.lastModelId')
      } catch {
        return null
      }
    })()
    const explicitId = items.find((m) => m.id === last)?.id
    const defaultId = items.find((m) => m.isDefault)?.id
    const fallbackId = items[0]?.id ?? null
    const resolved = explicitId ?? defaultId ?? fallbackId
    if (resolved !== current) emit('update:modelValue', resolved)
  },
  { immediate: true },
)
```

Also update the empty-state copy in the non-inline branch so it does not claim the admin configured nothing:

```html
      <EmptyState
        title="چت هنوز پیکربندی نشده است"
        description="هیچ مدلی برای حساب شما در دسترس نیست."
      >
```

- [ ] **Step 5: Clear the selection and refresh the catalog on a rejection**

In `frontend/app/src/composables/useChatStream.ts`, add above `useChatStream()`:

```typescript
/**
 * Codes that mean "the model this client holds is not usable by this account".
 * When one arrives, drop the selection and reload the entitlement-filtered
 * catalog so the picker repopulates with what is actually available.
 */
const MODEL_REJECTION_CODES = new Set(['model_forbidden', 'model_unavailable'])
```

Inside `useChatStream()`, after `inputDisabled`, add:

```typescript
  /**
   * Recover from a server-side model rejection. The store is imported lazily so
   * this composable stays usable without an active Pinia instance (unit tests).
   */
  async function recoverFromModelRejection(code: string | undefined): Promise<boolean> {
    if (!code || !MODEL_REJECTION_CODES.has(code)) return false
    selectedModelId.value = null
    try {
      sessionStorage.removeItem(SESSION_KEY)
    } catch {
      /* ignore */
    }
    try {
      const { useModelsStore } = await import('@/stores/models')
      await useModelsStore().load(true)
    } catch {
      /* catalog refresh is best-effort; the banner still explains the rejection */
    }
    return true
  }
```

In `send()`'s `onError` handler, after `generationState.value = 'failed'` and `controller = null`, add:

```typescript
        void recoverFromModelRejection(err.code)
```

In `setModel()`, extend the catch:

```typescript
      } catch (err) {
        const apiErr = err as ApiError
        connectionError.value = {
          code: apiErr.code ?? 'set_model_failed',
          message: streamErrorMessage(apiErr.code ?? 'set_model_failed', apiErr.message),
        }
        await recoverFromModelRejection(apiErr.code)
      }
```

- [ ] **Step 6: Run the frontend checks**

Run: `cd frontend/app && npx vitest run`
Expected: all specs PASS (including the existing `tests/useChatStream.spec.ts`).

Run: `cd frontend/app && npx vue-tsc --noEmit`
Expected: zero errors.

- [ ] **Step 7: Suggested commit message**

```
Suggested commit message: feat(frontend): recover from model entitlement rejections and never keep an inaccessible model selected
```

---

## Task 12: Frontend — admin model visibility configuration

**Files:**
- Modify: `frontend/app/src/types/api.ts`
- Modify: `frontend/app/src/components/admin/ModelFormModal.vue`
- Modify: `frontend/app/src/components/admin/ModelTable.vue`

**Interfaces:**
- Consumes: `ModelAdmin.visibility` / `ModelCreateRequest.visibility` (backend Tasks 2/7).
- Produces: `ModelVisibility` type; a visibility select in the create/edit modal that sends `visibility`; a visibility badge column in the admin table.

- [ ] **Step 1: Extend the types**

In `frontend/app/src/types/api.ts`:

```typescript
export type ModelVisibility = 'public' | 'commercial' | 'private'
export type UserAccessTier = 'free' | 'commercial'

export interface ModelAdmin extends ModelPublic {
  actualName: string
  providerId: string
  visibility: ModelVisibility
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface ModelUpsertRequest {
  displayName?: string
  actualName?: string
  providerId?: string
  visibility?: ModelVisibility
  enabled?: boolean
}
```

- [ ] **Step 2: Add the visibility control to the model form**

In `frontend/app/src/components/admin/ModelFormModal.vue`:

```typescript
import type { ModelAdmin, ModelVisibility } from '@/types/api'
```

```typescript
const VISIBILITY_OPTIONS: Array<{ value: ModelVisibility; label: string; hint: string }> = [
  { value: 'public', label: 'عمومی', hint: 'در دسترس همه کاربران' },
  { value: 'commercial', label: 'تجاری', hint: 'فقط کاربران با سطح دسترسی تجاری' },
  { value: 'private', label: 'خصوصی', hint: 'فقط برای مدیران' },
]
```

```typescript
const form = reactive<{
  displayName: string
  actualName: string
  visibility: ModelVisibility
  enabled: boolean
}>({ displayName: '', actualName: '', visibility: 'public', enabled: true })
```

```typescript
    form.visibility = props.model?.visibility ?? 'public'
```

(`form.enabled = props.model?.enabled ?? true` stays as-is.)

Inside `onSubmit`, include `visibility: form.visibility` in **both** the `updateModel` and `createModel` payloads.

In the template, insert the control between the `actualName` input and the enabled checkbox:

```html
            <label class="flex flex-col gap-2 text-sm text-ink">
              <span class="text-xs font-medium text-ink-muted">سطح دسترسی</span>
              <select
                v-model="form.visibility"
                class="w-full appearance-none rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink transition-colors focus:border-primary"
              >
                <option v-for="opt in VISIBILITY_OPTIONS" :key="opt.value" :value="opt.value">
                  {{ opt.label }} — {{ opt.hint }}
                </option>
              </select>
            </label>
```

In the `catch` block, **replace** the existing `} else if (err.status === 409) {` branch (the duplicate-display-name mapping) with these two branches so the default-model guard is explained instead of being mislabeled as a duplicate name:

```typescript
      } else if (err.status === 409 && err.code === 'model_is_default') {
        submitError.value = { message: apiErrorMessage(err), code: err.code, requestId: err.requestId }
      } else if (err.status === 409) {
        fieldErrors.displayName = 'این نام نمایشی قبلاً استفاده شده است.'
      }
```

- [ ] **Step 3: Show the visibility in the admin table**

In `frontend/app/src/components/admin/ModelTable.vue`, add the import and a column after the provider name cell:

```typescript
import type { ModelAdmin, ModelVisibility } from '@/types/api'

const VISIBILITY_LABELS: Record<ModelVisibility, string> = {
  public: 'عمومی',
  commercial: 'تجاری',
  private: 'خصوصی',
}

const VISIBILITY_CLASSES: Record<ModelVisibility, string> = {
  public: 'bg-success/15 text-success',
  commercial: 'bg-primary/15 text-primary',
  private: 'bg-warning/15 text-warning',
}
```

```html
          <th class="px-4 py-2.5 text-start font-medium">سطح دسترسی</th>
```

```html
          <td class="px-4 py-3">
            <span
              class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs"
              :class="VISIBILITY_CLASSES[m.visibility]"
            >
              {{ VISIBILITY_LABELS[m.visibility] }}
            </span>
          </td>
```

- [ ] **Step 4: Type-check**

Run: `cd frontend/app && npx vue-tsc --noEmit`
Expected: zero errors.

- [ ] **Step 5: Suggested commit message**

```
Suggested commit message: feat(frontend): configure and display model visibility in the admin model catalog
```

---

## Task 13: Frontend — admin user access-tier page

**Files:**
- Modify: `frontend/app/src/api/admin.ts`
- Modify: `frontend/app/src/types/api.ts`
- Create: `frontend/app/src/views/admin/UsersView.vue`
- Modify: `frontend/app/src/router/index.ts`
- Modify: `frontend/app/src/layouts/AdminShell.vue`
- Test: `frontend/app/tests/api/admin.spec.ts`

**Interfaces:**
- Consumes: `GET /v1/admin/users`, `PATCH /v1/admin/users/{id}/access-tier` (Task 8).
- Produces: `AdminUser`, `AdminUserList` types; `listAdminUsers(query)`, `setUserAccessTier(id, tier)` API helpers; `/admin/users` route reachable from the admin nav.

- [ ] **Step 1: Write the failing API test**

Create `frontend/app/tests/api/admin.spec.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockRequest = vi.fn()

vi.mock('@/api/http', () => ({
  request: (...args: unknown[]) => mockRequest(...args),
  API_BASE: '',
  buildUrl: (path: string) => path,
  tokenStore: { load: () => null },
}))

import { listAdminUsers, setUserAccessTier } from '@/api/admin'

describe('admin user access API', () => {
  beforeEach(() => {
    mockRequest.mockClear()
    mockRequest.mockResolvedValue({ items: [], total: 0 })
  })

  it('lists users with the search term and pagination', async () => {
    await listAdminUsers({ query: 'ali', limit: 20, offset: 40 })
    expect(mockRequest).toHaveBeenCalledWith('/v1/admin/users', {
      query: { query: 'ali', limit: 20, offset: 40 },
    })
  })

  it('patches the access tier', async () => {
    await setUserAccessTier('u-1', 'commercial')
    expect(mockRequest).toHaveBeenCalledWith('/v1/admin/users/u-1/access-tier', {
      method: 'PATCH',
      body: { accessTier: 'commercial' },
    })
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd frontend/app && npx vitest run tests/api/admin.spec.ts`
Expected: FAIL — `listAdminUsers` is not exported.

- [ ] **Step 3: Add types and helpers**

In `frontend/app/src/types/api.ts`:

```typescript
export interface AdminUser {
  id: string
  email: string
  username: string | null
  role: Role
  accessTier: UserAccessTier
  createdAt: string
}

export interface AdminUserList {
  items: AdminUser[]
  total: number
}
```

In `frontend/app/src/api/admin.ts`:

```typescript
import type { AdminUser, AdminUserList, UserAccessTier } from '@/types/api'

export function listAdminUsers(
  query: { query?: string; limit?: number; offset?: number } = {},
): Promise<AdminUserList> {
  return request<AdminUserList>('/v1/admin/users', { query: { ...query } })
}

export function setUserAccessTier(id: string, accessTier: UserAccessTier): Promise<AdminUser> {
  return request<AdminUser>(`/v1/admin/users/${id}/access-tier`, {
    method: 'PATCH',
    body: { accessTier },
  })
}
```

- [ ] **Step 4: Build the page**

Create `frontend/app/src/views/admin/UsersView.vue`:

```html
<script setup lang="ts">
// تنظیم سطح دسترسی کاربران (فاز ۳): مدل‌های «تجاری» فقط برای کاربران با
// سطح دسترسی تجاری قابل استفاده‌اند. این صفحه فقط همین یک قابلیت را مدیریت
// می‌کند؛ مدیریت حساب کاربران خارج از دامنه است.
import { computed, ref } from 'vue'
import { PhMagnifyingGlass, PhUsers } from '@phosphor-icons/vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import ErrorBanner from '@/components/ui/ErrorBanner.vue'
import { ApiError } from '@/api/http'
import { apiErrorMessage } from '@/utils/errors'
import { listAdminUsers, setUserAccessTier } from '@/api/admin'
import type { AdminUser, UserAccessTier } from '@/types/api'

const items = ref<AdminUser[]>([])
const total = ref(0)
const search = ref('')
const loading = ref(false)
const initialLoading = ref(true)
const pageError = ref<ApiError | null>(null)
const actionError = ref<ApiError | null>(null)
const savingId = ref<string | null>(null)

const TIER_LABELS: Record<UserAccessTier, string> = {
  free: 'رایگان',
  commercial: 'تجاری',
}

async function load(): Promise<void> {
  loading.value = true
  pageError.value = null
  try {
    const res = await listAdminUsers({ query: search.value.trim() || undefined, limit: 50 })
    items.value = res.items
    total.value = res.total
  } catch (err) {
    pageError.value = err instanceof ApiError ? err : new ApiError(0, null, 'خطا در بارگذاری کاربران.')
  } finally {
    loading.value = false
    initialLoading.value = false
  }
}
void load()

async function onTierChange(user: AdminUser, value: string): Promise<void> {
  const next = value as UserAccessTier
  if (next === user.accessTier) return
  actionError.value = null
  savingId.value = user.id
  const previous = user.accessTier
  // Optimistic: keep the select responsive, roll back on failure.
  user.accessTier = next
  try {
    const updated = await setUserAccessTier(user.id, next)
    user.accessTier = updated.accessTier
  } catch (err) {
    user.accessTier = previous
    actionError.value = err instanceof ApiError ? err : new ApiError(0, null, 'خطا در ذخیره سطح دسترسی.')
  } finally {
    savingId.value = null
  }
}

const isEmpty = computed(() => !initialLoading.value && items.value.length === 0)
</script>

<template>
  <section>
    <header class="mb-4 flex items-center gap-3">
      <PhUsers class="size-5 text-primary" aria-hidden="true" />
      <h1 class="text-base font-semibold">سطح دسترسی کاربران</h1>
      <span class="text-xs text-ink-muted">{{ total }} کاربر</span>
    </header>

    <p class="mb-4 text-sm text-ink-muted">
      مدل‌های «تجاری» فقط برای کاربران با سطح دسترسی «تجاری» نمایش داده می‌شوند. مدل‌های «خصوصی»
      تنها برای مدیران قابل استفاده‌اند.
    </p>

    <form class="mb-4 flex items-end gap-2" @submit.prevent="load">
      <BaseInput v-model="search" label="جست‌وجو" hint="ایمیل یا نام کاربری" autocomplete="off" />
      <BaseButton type="submit" :loading="loading">
        <PhMagnifyingGlass class="size-4" aria-hidden="true" />
        <span>جست‌وجو</span>
      </BaseButton>
    </form>

    <ErrorBanner
      v-if="actionError"
      :message="apiErrorMessage(actionError)"
      :code="actionError.code"
      :request-id="actionError.requestId"
      :show-code="true"
      class="mb-3"
    />
    <ErrorBanner
      v-if="pageError"
      :message="apiErrorMessage(pageError)"
      :code="pageError.code"
      :request-id="pageError.requestId"
      :show-code="true"
      class="mb-3"
    />

    <div v-if="initialLoading" class="h-48 animate-pulse rounded-card bg-surface" />

    <EmptyState
      v-else-if="isEmpty && !pageError"
      title="کاربری پیدا نشد"
      description="عبارت جست‌وجو را تغییر دهید."
    />

    <div v-else class="overflow-x-auto rounded-card border border-line bg-surface">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-line bg-elevated/40 text-xs uppercase tracking-wide text-ink-muted">
            <th class="px-4 py-2.5 text-start font-medium">ایمیل</th>
            <th class="px-4 py-2.5 text-start font-medium">نام کاربری</th>
            <th class="px-4 py-2.5 text-start font-medium">نقش</th>
            <th class="px-4 py-2.5 text-start font-medium">سطح دسترسی</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="u in items"
            :key="u.id"
            class="border-b border-line last:border-b-0 transition-colors hover:bg-elevated/30"
          >
            <td class="px-4 py-3 font-mono text-xs text-ink" dir="ltr">{{ u.email }}</td>
            <td class="px-4 py-3 text-ink-muted">{{ u.username ?? '—' }}</td>
            <td class="px-4 py-3 text-ink-muted">{{ u.role === 'admin' ? 'مدیر' : 'کاربر' }}</td>
            <td class="px-4 py-3">
              <select
                :value="u.accessTier"
                :disabled="savingId === u.id"
                :aria-label="`سطح دسترسی ${u.email}`"
                class="cursor-pointer appearance-none rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-ink transition-colors focus:border-primary disabled:opacity-50"
                @change="onTierChange(u, ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="(label, value) in TIER_LABELS" :key="value" :value="value">
                  {{ label }}
                </option>
              </select>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
```

- [ ] **Step 5: Register the route and nav entry**

In `frontend/app/src/router/index.ts`, inside the `/admin` children after `admin-models`:

```typescript
      { path: 'users', name: 'admin-users', component: () => import('@/views/admin/UsersView.vue') },
```

In `frontend/app/src/layouts/AdminShell.vue`:

```typescript
import { PhGear, PhListBullets, PhPlugsConnected, PhSignOut, PhStar, PhMoon, PhSun, PhUsers } from '@phosphor-icons/vue'
```

```typescript
  { to: { name: 'admin-models' }, label: 'کاتالوگ مدل‌ها', icon: PhListBullets },
  { to: { name: 'admin-users' }, label: 'سطح دسترسی کاربران', icon: PhUsers },
  { to: { name: 'admin-default-model' }, label: 'مدل پیش‌فرض', icon: PhStar },
```

- [ ] **Step 6: Run the frontend checks**

Run: `cd frontend/app && npx vitest run && npx vue-tsc --noEmit`
Expected: all specs PASS, zero type errors.

- [ ] **Step 7: Suggested commit message**

```
Suggested commit message: feat(frontend): add admin page for per-user model access tiers
```

---

## Task 14: Final verification and regression sweep

**Files:** none (verification only).

- [x] **Step 1: Backend unit + contract suite (no database needed)**

Run: `cd backend && npx jest test/unit test/contract --no-coverage`
Expected: all PASS. Any failure here is a regression from this phase — fix before continuing.

Result: **26 suites / 209 tests PASS.** 34 of those tests (5 suites) are new in this phase: `model-access.service`, `model-access-columns`, `conversations-controller-model`, `users.admin.controller`, `access-control-contract`.

- [x] **Step 2: Backend integration sweep**

Recreate the shared test database, then run the phase-2/3 suites:

```bash
docker exec nova-ai-db psql -U postgres -c "DROP DATABASE IF EXISTS chatbot_test" -c "CREATE DATABASE chatbot_test"
cd backend && npx jest test/integration/access-control.e2e.spec.ts test/integration/chat.stream.e2e.spec.ts test/integration/conversations.e2e.spec.ts test/integration/conversations-model.e2e.spec.ts --no-coverage
```

Expected: `access-control` and `chat.stream` PASS. For `conversations.e2e.spec.ts` / `conversations-model.e2e.spec.ts`: these two still seed the legacy `CentralProvider` singleton and omit `Model.providerId`, which predates the multi-provider migration — if they fail on the FK/`provider_id` constraint, that is a pre-existing defect, not a regression. Record the exact failure in the task notes and (only if trivial) seed `providerId` in their `beforeAll`; do not rewrite those suites in this phase.

Result: **4 suites / 37 tests PASS, twice in a row** (proves re-runnability against a persistent database). Deviations from the literal commands above:

- The compose container `nova-ai-db` (port 5433) is down in this environment; the project's Postgres listens on **5435** as `novadb`. The suite database was therefore created with `CREATE DATABASE chatbot_test` against 5435 and the suites were run with `POSTGRES_PORT=5435 PORT=3000`.
- The two legacy suites were *fixed* rather than left red — the repair was mechanical and belongs to the phase-2 migration they predate: `CentralProvider` singleton seed → real `providers` row, `Model` seeds given `providerId` + `visibility` + real UUID ids, run-scoped emails/usernames/display names (required by the `users.username` and `uq_models_display_name` constraints and by the shared database), `?` placeholders → `$1`, and the stale `ProviderRuntimeService` mock in `chat.stream` gained the `stream` method the phase-2 runtime API expects.
- The seven remaining suites under `test/integration/` (`models.public`, `models.admin.crud`, `provider`, `app-config.default-model`, `app.boot`, `auth`, `admin.role-boundary`) are still SQLite-based and fail in `beforeAll` with `DataTypeNotSupportedError: Data type "timestamp" in "Provider.lastValidatedAt" is not supported by "sqlite" database.` That is a pre-existing phase-2 defect (verified identical on untouched suites), unrelated to access control; they are left for a follow-up.

- [x] **Step 3: Backend lint and type-check**

Run: `cd backend && npm run lint && npx tsc --noEmit`
Expected: zero errors.

Result: **ESLint clean (0 errors, 0 warnings) and `tsc --noEmit` clean.** Six pre-existing lint errors in already-dirty phase-2 files were fixed with type-level-only changes: the untyped `(err as any)?.response` envelope read in `chat.service.ts`, the `(a as any).supports?.()` adapter probe in `provider-runtime.service.ts` / `provider.service.ts`, the unused `Provider` import in `models.admin.controller.ts`, and a `Function` type in `model-access-columns.spec.ts`.

- [x] **Step 4: Frontend type-check and unit tests**

Run: `cd frontend/app && npx vue-tsc --noEmit && npm test`
Expected: zero type errors, all specs PASS.

Result: **`vue-tsc --noEmit` clean; Vitest 4 files / 24 tests PASS.** The two spec files added in this phase are `tests/utils/errors.spec.ts` and `tests/api/admin.spec.ts`.

- [ ] **Step 5: Manual smoke (acceptance criteria walkthrough)**

Start Postgres + backend + frontend, then:

1. Sign in as a `free` user. The picker lists only public models; commercial/private ids never appear in the DOM or in the `/v1/models` response.
2. In `psql`, flip that user to `commercial` (`UPDATE users SET access_tier='commercial' WHERE email='…'`) and reload: commercial models now appear without re-login (proves DB-sourced entitlement).
3. Select a public model, send a message, get a streamed answer (existing chat permission intact).
4. As the free user, `PATCH /v1/conversations/<id>/model` with a private model id via curl → `403 model_forbidden`.
5. As an admin, open `/admin/models`: set a model to `تجاری`; confirm the free user's catalog loses it on reload and the admin table shows the badge.
6. As an admin, open `/admin/users`: search the free user, set `تجاری`; confirm the picker gains commercial models on reload.
7. As an admin, try to set a commercial model as the system default → `422`; try to demote the current default to private → `409`.
8. While a generation is streaming, confirm the picker is still disabled (unchanged behavior).

Not executed by the agent: it needs a live backend + frontend + the running database, and step 2 of the walkthrough intentionally hand-edits a user row in `psql`. Operator step; the automated `access-control.e2e.spec.ts` covers the same behaviours (free/commercial visibility, live tier change without re-login, `403 model_forbidden`, default-model `422`/`409`).

- [x] **Step 6: Summarize**

Report: files touched, test counts before/after, any deviation from the plan, and the operator commit list (one `Suggested commit message:` per task).

---

## Self-Review

**Spec coverage**

| Phase brief requirement | Where |
|---|---|
| Define model visibility/access policy | Decision recap; Task 2 (vocabulary + storage); Task 3 (policy) |
| Associate models with required role / subscription / user group | Task 2 (`visibility`), Task 8 (`accessTier`); per-model/user-group grants consciously deferred and documented |
| Backend authorization guard/service | Task 3 (`ModelAccessService`), Tasks 5/6 (enforcement) |
| Filter model catalog by current user | Task 4 |
| Admin configuration for access restrictions | Tasks 7 (model visibility), 8 (user tiers), 9 (default guard) |
| Frontend handling of restricted models and authorization errors | Tasks 11, 12, 13 |
| Public models available to eligible authenticated users | Task 3 matrix + Task 10 (`AC: a free user sees only public enabled models`) |
| Restricted models accessible only to authorized users | Tasks 3/4/10 |
| Unauthorized model requests rejected server-side | Tasks 5/6/10 (+ 403 on admin surfaces in Task 10) |
| Admin can configure model access | Tasks 7/8/10 |
| Model selector never exposes inaccessible models | Task 4 (server filter) + Task 11 (picker re-resolution) |
| Existing chat permissions remain intact | Task 5 keeps `model_unavailable` semantics; Task 14 regression sweep + smoke step 3 |
| Out of scope: billing/quota/usage | Nothing in the plan adds these; the deferred section names them |

**Placeholder scan:** every code step contains complete code, exact paths and exact commands. No `TBD`, no "add error handling", no "similar to Task N".

**Type consistency check:** `ModelVisibility` / `UserAccessTier` / `MODEL_VISIBILITIES` / `USER_ACCESS_TIERS` / `TIER_RANK` / `VISIBILITY_RANK` (Task 2) are used with those exact names in Tasks 3, 7, 8, 12, 13. `AccessViewer` / `AccessTarget` / `loadViewer` / `canAccess` / `canAccessUser` / `filterAccessible` / `assertCanUseModel` (Task 3) are used with those exact names in Tasks 4, 5, 6, 9. `listAccessibleFor` (Task 4), `resolveActiveModel({ explicitModelId, userId })` (Task 5), `listForAdmin` / `setAccessTier` (Task 8), `listAdminUsers` / `setUserAccessTier` (Task 13) each appear only once as a definition and once per consumer. Error codes used consistently: `model_unavailable` (422), `model_forbidden` (403), `model_is_default` (409), `model_not_eligible_default` (422), `user_not_found` (404), `validation_failed` (400).

**Known pre-existing gaps deliberately not fixed here** (flag to the operator): the admin model form still cannot create a model because `providerId` is required by the contract but not sent by `ModelFormModal.vue`; `frontend/app/src/types/api.ts` previously omitted `ModelAdmin.providerId`; several sqlite-based integration suites cannot run with the current `Provider` entity. Each is a separate, small follow-up.

---

## Appendix A — Phase 3 brief (verbatim, to be saved as `backend/specs/003-model-access-control/spec.md`)

```markdown
# Phase 3 — Model access control

Goal: Control which users can access public, commercial, and private models.

## Scope

- Define model visibility/access policy.
- Associate models with the required role, subscription, or user group.
- Backend authorization guard/service.
- Filter model catalog by current user.
- Admin configuration for access restrictions.
- Frontend handling of restricted models and authorization errors.

## Acceptance criteria

- Public models are available to eligible authenticated users.
- Restricted models are accessible only to authorized users.
- Unauthorized model requests are rejected server-side.
- Admin can configure model access.
- The model selector never exposes inaccessible models.
- Existing chat permissions remain intact.

Out of scope: Billing/subscription purchase flows, quotas, usage tracking.

## Decisions taken during planning

- Visibility tiers: `public` (any authenticated user), `commercial` (users whose
  `accessTier` is `commercial`), `private` (admin role only). Stored on
  `models.visibility`, default `public`.
- Entitlement: `users.access_tier` ∈ `free | commercial`, default `free`,
  assigned by an admin. Read from the database per request (no JWT staleness).
- Per-model / per-group grant lists for `private` models are deferred; the
  policy service is the single extension point when they land.
- `enabled` remains orthogonal: a disabled model is unavailable to everyone
  (`model_unavailable`); an entitlement failure is `model_forbidden` (403).
- The system default model must always be public (enforced in `PUT /v1/admin/config`
  and when changing a model's visibility).
```
