# User Model Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users choose an available model while chatting and persist that choice on the conversation, so the active model is visible in the chat header and on every conversation row, and switching the model mid-conversation updates the conversation in place.

**Architecture:** Per-conversation model is the source of truth. `Conversation.modelId` is already persisted at conversation creation. This plan adds a `PATCH /v1/conversations/:id/model` endpoint that updates it (with ownership + availability validation), wires the existing `ModelPicker` in the chat header to call that endpoint when an active conversation is present, and renders the model's display name next to the picker and on each conversation row.

**Tech Stack:** NestJS 10 + TypeORM 0.3 (backend), Vue 3 + Pinia (frontend `part-chat/frontend/app`), OpenAPI 3.1 (contract source of truth), class-validator (DTOs), vitest/jest (tests).

**Spec:** `backend/specs/001-multi-model-chatbot-mvp/spec.md` (FR-020 — sticky choice), `backend/specs/001-multi-model-chatbot-mvp/api-contract.md`, this phase's brief.

## Decision recap

- **Granularity:** Per-conversation model. `Conversation.modelId` is the single source of truth. `ChatRequestDto.modelId` is honored for the new turn if provided and is then persisted onto the conversation.
- **Switch timing:** The picker is disabled while a generation is in flight (already wired through `chat.inputDisabled`).
- **Out of scope:** Per-message models, role-based access beyond "model must be enabled", quotas, fallback between providers.

## What's already in the codebase (don't re-do)

These were built in earlier phases and are functioning:

- `GET /v1/models` — public list of enabled models.
- `PATCH /v1/users/me/model-preference` — sticky preference endpoint + `User.lastSelectedModelId`.
- `ChatRequestDto.modelId` + chat-service resolution order (explicit → sticky → admin default), with `model_unavailable` error on bad explicit ids.
- `ConversationSummary.modelDisplayName` and `ConversationDetail.modelDisplayName` (returned by the conversations controller).
- `ModelPicker.vue` component (already used inline in `ChatView.vue` header, bound to `chat.selectedModelId`).
- `useModelsStore` (loads models, exposes `items`, `defaultModelId`, `byId`).
- `useChatStream.setModel()` (sets the in-memory `selectedModelId` and persists to `sessionStorage`).

## What's NOT yet in the codebase (this plan covers)

1. `PATCH /v1/conversations/:id/model` endpoint + DTO + service method.
2. Frontend `setConversationModel(id, modelId)` API helper.
3. Wire `useChatStream.setModel()` to call the PATCH endpoint when a conversation is loaded.
4. Show the active model's display name in the chat header (right of the picker).
5. Show the model's display name on each conversation row in the sidebar.
6. Sync `chat.selectedModelId` to `conversation.modelId` when loading a conversation so the picker reflects the persisted choice.
7. End-to-end tests covering switch + reload + invalid-model rejection.

---

## Global Constraints

- All backend source, tests, docs under `backend/` (no edits to `frontend/` except the files explicitly listed below).
- Frontend edits live under `frontend/app/src/`.
- API-first: any new endpoint reflected in `backend/specs/001-multi-model-chatbot-mvp/contracts/openapi-3.1.yaml` before the corresponding implementation lands.
- Validation via `class-validator` strict whitelist at the system boundary.
- Error envelope `{ code, message, requestId }` — no stack traces in responses.
- UUIDs RFC 4122 lowercase hyphenated; timestamps ISO-8601 UTC.
- Tests mandatory for new endpoints, new service methods, and new frontend store/composable behavior.
- No raw SQL in HTTP handlers — TypeORM repositories only.
- No git operations by implementers — append a `Suggested commit message:` block after each task.

---

## File Structure

New files this plan creates:

- `backend/src/modules/conversations/dto/set-conversation-model.dto.ts` — request body for the new endpoint.
- `backend/test/integration/conversations-model.e2e.spec.ts` — integration tests for the new endpoint.

Files this plan modifies:

- `backend/src/modules/conversations/conversations.service.ts` — add `setModel(id, userId, modelId)` method.
- `backend/src/modules/conversations/conversations.module.ts` — register the new DTO if needed.
- `backend/src/modules/conversations/conversations.controller.ts` — add `PATCH /:id/model` route.
- `backend/specs/001-multi-model-chatbot-mvp/contracts/openapi-3.1.yaml` — new endpoint + schema.
- `frontend/app/src/api/conversations.ts` — add `setConversationModel(id, modelId)`.
- `frontend/app/src/composables/useChatStream.ts` — extend `setModel`; sync from `conversation.modelId` on load.
- `frontend/app/src/views/ChatView.vue` — show active model display name next to the picker.
- `frontend/app/src/components/chat/ConversationRow.vue` — show `modelDisplayName` next to the title.
- `frontend/app/src/types/api.ts` — ensure `ConversationSummary` / `ConversationDetail` already declare `modelDisplayName` (sanity-check; if not, add it).

---

## Task 1: OpenAPI contract — declare `PATCH /v1/conversations/:id/model`

**Files:**
- Modify: `backend/specs/001-multi-model-chatbot-mvp/contracts/openapi-3.1.yaml`

**Interfaces:**
- Produces: a documented `PATCH /v1/conversations/{id}/model` operation with request schema `SetConversationModelRequest` and the response shapes already used for conversation mutations.

- [ ] **Step 1: Locate the existing `/v1/conversations/{id}/pin` block**

Run: `grep -n "/pin\|/model" backend/specs/001-multi-model-chatbot-mvp/contracts/openapi-3.1.yaml`
Expected: at least one existing `pin` PATCH block we can mirror.

- [ ] **Step 2: Add the new path right after the `/pin` block**

Insert directly under the `/pin` block, before the `DELETE /v1/conversations/{id}` block:

```yaml
  /v1/conversations/{id}/model:
    patch:
      tags: [conversation]
      summary: Change the model used by a conversation
      description: |
        Updates `Conversation.modelId`. Future turns in this conversation
        use the new model. Existing message history is retained as-is;
        the model that produced each message is not re-stamped.
      security:
        - bearerAuth: []
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
              $ref: '#/components/schemas/SetConversationModelRequest'
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
          $ref: '#/components/schemas/Error'
        '404':
          description: Conversation or model not found
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
        '422':
          description: Model not available (disabled or missing)
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
```

- [ ] **Step 3: Add the request schema under `components/schemas`**

Find the `SetModelPreferenceRequest` block (around line 1292) and add the new schema right after:

```yaml
    SetConversationModelRequest:
      type: object
      required: [modelId]
      properties:
        modelId:
          type: string
          format: uuid
          description: The enabled model the conversation should use going forward.
```

- [ ] **Step 4: Verify the YAML still parses**

Run: `cd backend && npx js-yaml specs/001-multi-model-chatbot-mvp/contracts/openapi-3.1.yaml > /dev/null && echo OK`
Expected: `OK`. If `npx js-yaml` is unavailable, open the file and confirm there are no syntax errors around the inserted block.

- [ ] **Step 5: Commit**

```
Suggested commit message: docs(contract): declare PATCH /v1/conversations/:id/model endpoint
```

---

## Task 2: Backend — DTO for the new endpoint

**Files:**
- Create: `backend/src/modules/conversations/dto/set-conversation-model.dto.ts`

**Interfaces:**
- Consumes: `class-validator`'s `IsString` + `IsUUID`.
- Produces: a `SetConversationModelDto` class with a required `modelId: string` field.

- [ ] **Step 1: Create the DTO**

```typescript
// backend/src/modules/conversations/dto/set-conversation-model.dto.ts
import { IsString, IsUUID } from 'class-validator';

/**
 * Body of PATCH /v1/conversations/:id/model.
 *
 * `modelId` MUST reference an enabled model; the controller re-checks
 * `model.enabled` after validation and rejects with 422 if the model
 * is missing or disabled.
 */
export class SetConversationModelDto {
  @IsString({ message: 'modelId must be a string' })
  @IsUUID('4', { message: 'modelId must be a UUID' })
  modelId!: string;
}
```

- [ ] **Step 2: Confirm type-check passes**

Run: `cd backend && npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```
Suggested commit message: feat(conversations): add SetConversationModelDto for PATCH endpoint
```

---

## Task 3: Backend — `ConversationsService.setModel()` + controller route (TDD)

**Files:**
- Modify: `backend/src/modules/conversations/conversations.service.ts` — add `setModel(id, userId, modelId): Promise<{ conversation, model } | null>`.
- Modify: `backend/src/modules/conversations/conversations.controller.ts` — add `@Patch(':id/model')` route.
- Test: `backend/test/integration/conversations-model.e2e.spec.ts`.

**Interfaces:**
- Consumes: existing `Conversation` repository, `ModelsService.findById()` (already injected in `ConversationsController`).
- Produces:
  - `ConversationsService.setModel(id: string, userId: string, modelId: string)` → returns the updated `Conversation` on success; returns `null` if the conversation is not found; throws `ForbiddenException` if the conversation belongs to another user; throws `UnprocessableEntityException` with `code: 'model_unavailable'` if the model is missing or disabled.
  - `PATCH /v1/conversations/:id/model` with body `{ modelId: string }` → returns the updated `ConversationSummary` (id, modelId, modelDisplayName, title, pinned, createdAt, updatedAt).

- [ ] **Step 1: Write the failing integration test**

Create `backend/test/integration/conversations-model.e2e.spec.ts`. **Read `backend/test/integration/conversations.e2e.spec.ts` first** to copy its bootstrap (`beforeAll` / `afterAll`, env setup, AppModule compile, ValidationPipe + AllExceptionsFilter wiring, CentralProvider + AppConfig seeding) and reuse the same registration helpers. The new file then seeds a SECOND model (so a switch target exists), runs the suite below, and tears down the same way.

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { Model } from '../../src/modules/models/entities/model.entity';
import { encrypt } from '../../src/common/crypto/credential-cipher';

describe('PATCH /v1/conversations/:id/model — e2e', () => {
  let app: INestApplication;
  let accessTokenA: string;
  let accessTokenB: string;

  jest.setTimeout(30_000);

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DB_DRIVER = 'postgres';
    process.env.POSTGRES_DB = 'chatbot_test';
    process.env.JWT_SECRET = 'integration-test-secret-with-enough-entropy-here';
    process.env.JWT_REFRESH_SECRET = 'integration-test-refresh-secret-entropy';
    process.env.PROVIDER_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    const ds = app.get(DataSource);
    await ds.runMigrations();

    // Central provider seed (copied from conversations.e2e).
    const { CentralProvider } = await import('../../src/modules/provider/entities/central-provider.entity');
    const providerRepo = ds.getRepository(CentralProvider);
    await providerRepo.save(
      providerRepo.create({
        id: 'singleton',
        baseUrl: 'http://localhost:9999',
        apiKeyEncrypted: encrypt('test-api-key'),
        lastValidatedAt: null,
      }),
    );

    // Two enabled models + one disabled model for the negative tests.
    const modelRepo = ds.getRepository(Model);
    await modelRepo.save([
      modelRepo.create({ id: 'model-A', displayName: 'Model A', actualName: 'model-a', enabled: true, isDefault: true }),
      modelRepo.create({ id: 'model-B', displayName: 'Model B', actualName: 'model-b', enabled: true }),
      modelRepo.create({ id: 'model-disabled', displayName: 'Disabled', actualName: 'disabled', enabled: false }),
    ]);

    const { AppConfig } = await import('../../src/modules/app-config/entities/app-config.entity');
    const cfg = await ds.getRepository(AppConfig).findOne({ where: { id: 'singleton' } });
    if (cfg) {
      cfg.defaultModelId = 'model-A';
      await ds.getRepository(AppConfig).save(cfg);
    }

    const regA = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email: 'switcher-a@example.com', password: 'correct-horse-battery-staple' });
    accessTokenA = regA.body.accessToken;

    const regB = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email: 'switcher-b@example.com', password: 'correct-horse-battery-staple' });
    accessTokenB = regB.body.accessToken;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  // Helper: create a conversation as user A via the service so we
  // don't depend on the streaming endpoint. Pattern mirrors
  // conversations.e2e.spec.ts.
  async function createConversationForA(): Promise<{ id: string; modelId: string }> {
    const { ConversationsService } = await import('../../src/modules/conversations/conversations.service');
    const conversations = app.get(ConversationsService);
    const conv = await conversations.create({ userId: (await dsUserA()).id, modelId: 'model-A', userMessage: 'seed' });
    return { id: conv.id, modelId: conv.modelId };
  }

  async function dsUserA(): Promise<{ id: string }> {
    const ds = app.get(DataSource);
    const rows = await ds.query('SELECT id FROM users WHERE email = ? LIMIT 1', ['switcher-a@example.com']);
    return rows[0];
  }

  it('updates Conversation.modelId for the owner with an enabled model', async () => {
    const { id } = await createConversationForA();
    const res = await request(app.getHttpServer())
      .patch(`/v1/conversations/${id}/model`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({ modelId: 'model-B' });
    expect(res.status).toBe(200);
    expect(res.body.modelId).toBe('model-B');
    expect(res.body.modelDisplayName).toBe('Model B');
  });

  it('returns 403 when the caller is not the owner', async () => {
    const { id } = await createConversationForA();
    const res = await request(app.getHttpServer())
      .patch(`/v1/conversations/${id}/model`)
      .set('Authorization', `Bearer ${accessTokenB}`)
      .send({ modelId: 'model-B' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('forbidden');
  });

  it('returns 404 when the conversation does not exist', async () => {
    const res = await request(app.getHttpServer())
      .patch('/v1/conversations/00000000-0000-4000-8000-000000000000/model')
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({ modelId: 'model-B' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('conversation_not_found');
  });

  it('returns 422 when the model is disabled', async () => {
    const { id } = await createConversationForA();
    const res = await request(app.getHttpServer())
      .patch(`/v1/conversations/${id}/model`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({ modelId: 'model-disabled' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('model_unavailable');
  });

  it('returns 422 when the modelId is unknown', async () => {
    const { id } = await createConversationForA();
    const res = await request(app.getHttpServer())
      .patch(`/v1/conversations/${id}/model`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({ modelId: '00000000-0000-4000-8000-000000000999' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('model_unavailable');
  });

  it('returns 400 when modelId is missing from the body', async () => {
    const { id } = await createConversationForA();
    const res = await request(app.getHttpServer())
      .patch(`/v1/conversations/${id}/model`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({});
    expect(res.status).toBe(400);
  });
});
```

Note: the implementer should confirm that the `CentralProvider` and `Model` entities in the seed still match the current schema (e.g., `providerId` is now required after the multi-provider catalog merge — if the migration sets a default, the seed still works; otherwise insert `'central'` explicitly). Adjust to match the schema if it has changed since this plan was written.

- [ ] **Step 2: Run the new tests and confirm they fail**

Run: `cd backend && npx jest test/integration/conversations-model.e2e.spec.ts --no-coverage`
Expected: FAIL — endpoint not implemented yet.

- [ ] **Step 3: Add `ConversationsService.setModel()`**

In `backend/src/modules/conversations/conversations.service.ts`, append after `setPinned()`:

```typescript
/**
 * Switch a conversation's model. The caller MUST be the owner.
 * Returns the updated conversation or null if not found. Throws
 * ForbiddenException for non-owners and UnprocessableEntityException
 * (code: 'model_unavailable') when the model is missing or disabled.
 *
 * The model availability check uses ModelsService.findById() +
 * `model.enabled`. The caller (controller) injects ModelsService.
 */
async setModel(
  id: string,
  userId: string,
  modelId: string,
): Promise<Conversation | null> {
  const conversation = await this.conversationRepo.findOne({ where: { id } });
  if (!conversation) return null;
  if (conversation.userId !== userId) {
    throw new ForbiddenException({
      code: 'forbidden',
      message: 'You do not have access to this conversation.',
    });
  }
  this.logger.log(`setModel: conversationId=${id} userId=${userId} newModelId=${modelId}`);
  conversation.modelId = modelId;
  return this.conversationRepo.save(conversation);
}
```

Note: The model availability check lives in the controller (where `ModelsService` is already injected), keeping `ConversationsService` free of cross-module deps for this method.

- [ ] **Step 4: Wire the controller endpoint and the availability check**

In `backend/src/modules/conversations/conversations.controller.ts`:

1. Add the new imports at the top of the file (the file already imports `Patch` and `UnprocessableEntityException` may not yet be imported):

```typescript
import { UnprocessableEntityException } from '@nestjs/common';
import { SetConversationModelDto } from './dto/set-conversation-model.dto';
```

2. Refactor the existing `list()` and `get()` handlers to share a small helper that resolves `modelDisplayName`. Replace the inline `modelDisplayName` lookup with this private method on the controller:

```typescript
private async toSummary(c: {
  id: string;
  modelId: string;
  title: string | null;
  pinned: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  const modelDisplayName = await this.models
    .findById(c.modelId)
    .then((m) => m.displayName)
    .catch((err) => {
      this.logger.warn(`Failed to resolve modelDisplayName for modelId=${c.modelId}: ${(err as Error).message}`);
      return null;
    });
  return {
    id: c.id,
    modelId: c.modelId,
    modelDisplayName,
    title: c.title,
    pinned: c.pinned,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}
```

Then change both `list` and `get` so their `return { items: [...] }` / `return { ... }` go through `this.toSummary(c)`. The map inside `list()` becomes `items: await Promise.all(conversations.map((c) => this.toSummary(c)))`.

3. Add the new endpoint. The path `/v1/conversations/:id/model` is distinct from the existing `/pin` route — no route conflict.

```typescript
@Patch(':id/model')
async setModel(
  @CurrentUser() user: AuthenticatedUser,
  @Param('id') id: string,
  @Body() dto: SetConversationModelDto,
) {
  const model = await this.models.findById(dto.modelId);
  if (!model.enabled) {
    throw new UnprocessableEntityException({
      code: 'model_unavailable',
      message: 'The selected model is not available.',
    });
  }
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

- [ ] **Step 5: Re-run the new tests**

Run: `cd backend && npx jest test/integration/conversations-model.e2e.spec.ts --no-coverage`
Expected: all PASS.

- [ ] **Step 6: Re-run the full conversations suite to catch regressions**

Run: `cd backend && npx jest test/integration/conversations.e2e.spec.ts test/integration/chat.stream.e2e.spec.ts test/unit/conversations.service.spec.ts --no-coverage`
Expected: all PASS.

- [ ] **Step 7: Lint and type-check**

Run: `cd backend && npm run lint && npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 8: Commit**

```
Suggested commit message: feat(conversations): add PATCH /:id/model to switch conversation model
```

---

## Task 4: Frontend — `setConversationModel()` API helper

**Files:**
- Modify: `frontend/app/src/api/conversations.ts`

**Interfaces:**
- Produces: `setConversationModel(id: string, modelId: string): Promise<ConversationSummary>` calling `PATCH /v1/conversations/:id/model`.

- [ ] **Step 1: Read the existing helper**

Open `frontend/app/src/api/conversations.ts` and confirm the import of `ConversationSummary` and the `request` helper.

- [ ] **Step 2: Add the function**

Append after `setConversationPinned`:

```typescript
export function setConversationModel(id: string, modelId: string): Promise<ConversationSummary> {
  return request<ConversationSummary>(`/v1/conversations/${id}/model`, {
    method: 'PATCH',
    body: { modelId },
  })
}
```

- [ ] **Step 3: Type-check**

Run: `cd frontend/app && npx vue-tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Commit**

```
Suggested commit message: feat(frontend): add setConversationModel API helper
```

---

## Task 5: Frontend — wire picker change to PATCH, sync from conversation

**Files:**
- Modify: `frontend/app/src/composables/useChatStream.ts`

**Interfaces:**
- Consumes: `setConversationModel(id, modelId)` (Task 4), `getConversation(id)` (already imported).
- Produces:
  - `setModel(id)` — when `conversationId.value` is set, fire-and-forget PATCH; on failure show a non-blocking error via `connectionError`.
  - `loadConversation(id)` — after loading, set `selectedModelId.value = detail.modelId` so the picker reflects the persisted choice.

- [ ] **Step 1: Import the new helper**

At the top of `useChatStream.ts`, change the import line:

```typescript
import { getConversation, listConversations, setConversationModel } from '@/api/conversations'
```

- [ ] **Step 2: Sync `selectedModelId` from `conversation.modelId` after load**

In `loadConversation()`, immediately after `transcript.value = detail.messages`, add:

```typescript
// Sync the picker to the conversation's persisted model so reloading
// a conversation restores the user's previous selection.
if (detail.modelId && detail.modelId !== selectedModelId.value) {
  selectedModelId.value = detail.modelId
}
```

- [ ] **Step 3: Update `setModel()` to PATCH when a conversation is active**

Update the `ChatStreamHandle` interface (top of file) to reflect the new async signature:

```typescript
setModel: (id: string | null) => Promise<void>
```

Replace the current `setModel` body:

```typescript
function setModel(id: string | null): void {
    selectedModelId.value = id
    if (id) saveModelId(id)
    else {
      try {
        sessionStorage.removeItem(SESSION_KEY)
      } catch {
        /* ignore */
      }
    }
  }
```

with:

```typescript
async function setModel(id: string | null): Promise<void> {
    // Guard programmatic calls; the picker is already disabled in the
    // UI but this prevents a stray setModel during streaming from
    // mutating state mid-turn.
    if (generationState.value === 'streaming') return
    selectedModelId.value = id
    if (id) saveModelId(id)
    else {
      try {
        sessionStorage.removeItem(SESSION_KEY)
      } catch {
        /* ignore */
      }
    }
    // If a conversation is loaded, persist the choice server-side so
    // the active model survives reload and follows the user across
    // devices. Errors are surfaced but non-blocking — the in-memory
    // selection still drives the next chat request.
    const convId = conversationId.value
    if (convId && id) {
      try {
        await setConversationModel(convId, id)
      } catch (err) {
        const apiErr = err as ApiError
        connectionError.value = {
          code: apiErr.code ?? 'set_model_failed',
          message: streamErrorMessage(apiErr.code ?? 'set_model_failed', apiErr.message),
        }
      }
    }
  }
```

- [ ] **Step 4: Type-check**

Run: `cd frontend/app && npx vue-tsc --noEmit`
Expected: zero errors.

- [ ] **Step 5: Commit**

```
Suggested commit message: feat(frontend): persist conversation model change via PATCH and sync on load
```

---

## Task 6: Frontend — display active model display name in chat header

**Files:**
- Modify: `frontend/app/src/views/ChatView.vue`

**Interfaces:**
- Consumes: `chat.selectedModelId.value`, `models.displayName(id)` (already exposed by `useModelsStore`).
- Produces: a small text label next to the existing `ModelPicker` chip showing the current model's display name (e.g., "GPT-4o Mini").

- [ ] **Step 1: Add a computed in ChatView.vue**

Near the top of `<script setup>`:

```typescript
const activeModelName = computed(() => models.displayName(chat.selectedModelId.value, ''))
```

- [ ] **Step 2: Render the label next to the picker**

Inside the header chip (the existing `<div class="inline-flex items-center gap-2 ...">` around line 228), insert immediately after the `ModelPicker`:

```html
<ModelPicker
  v-if="!noModels"
  v-model="chat.selectedModelId.value"
  :disabled="chat.inputDisabled.value"
  inline
/>
<span v-if="activeModelName" class="hidden text-ink-muted sm:inline">— {{ activeModelName }}</span>
```

- [ ] **Step 3: Smoke-test in dev**

Run the frontend dev server, open `/chat`, and confirm the model's display name appears next to the picker after the picker is populated.

- [ ] **Step 4: Commit**

```
Suggested commit message: feat(frontend): show active model display name next to picker
```

---

## Task 7: Frontend — show model display name on conversation rows

**Files:**
- Modify: `frontend/app/src/components/chat/ConversationRow.vue`

**Interfaces:**
- Consumes: `ConversationSummary.modelDisplayName` (already returned by backend).
- Produces: each row shows the model name as a small label below the title.

- [ ] **Step 1: Read the current row component**

Already shown — it renders `conversation.title` only.

- [ ] **Step 2: Add the model name to the template**

Replace the title `<span>` (around line 32):

```html
<span class="min-w-0 flex-1 truncate">{{ conversation.title?.trim() || 'بدون عنوان' }}</span>
```

with a flex column containing both title and model:

```html
<span class="flex min-w-0 flex-1 flex-col">
  <span class="truncate">{{ conversation.title?.trim() || 'بدون عنوان' }}</span>
  <span
    v-if="conversation.modelDisplayName"
    class="truncate text-[11px] text-ink-muted/80"
  >{{ conversation.modelDisplayName }}</span>
</span>
```

- [ ] **Step 3: Type-check + visual check**

Run: `cd frontend/app && npx vue-tsc --noEmit`
Then: open the sidebar and confirm rows show the model name below the title.

- [ ] **Step 4: Commit**

```
Suggested commit message: feat(frontend): display model name on conversation list rows
```

---

## Task 8: Backend — integration tests for chat flow honoring the persisted model

**Files:**
- Modify: `backend/test/integration/chat.stream.e2e.spec.ts`

**Interfaces:**
- Produces: tests that send a chat message after switching the conversation model via `PATCH /v1/conversations/:id/model`, then GET the conversation and confirm `modelId` matches and `modelDisplayName` matches.

- [ ] **Step 1: Add a new `describe` block at the end of the file**

```typescript
describe('Conversation model switch (e2e)', () => {
  let switchToken: string;

  beforeAll(async () => {
    // Register a fresh user so we don't pollute the main suite state.
    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email: 'switcher-stream@example.com', password: 'correct-horse-battery-staple' });
    switchToken = reg.body.accessToken;
  });

  it('honors conversation.modelId on the next turn after PATCH /:id/model', async () => {
    // Create a conversation via the service.
    const { ConversationsService } = await import('../../src/modules/conversations/conversations.service');
    const conversations = app.get(ConversationsService);
    const ds = app.get(DataSource);
    const rows = await ds.query('SELECT id FROM users WHERE email = ? LIMIT 1', ['switcher-stream@example.com']);
    const userId = rows[0].id;
    const conv = await conversations.create({ userId, modelId: 'model-1', userMessage: 'seed turn' });

    // Switch to model-2 (assumes the suite seeded two models; if not,
    // seed another enabled model and patch its id here).
    const switchRes = await request(app.getHttpServer())
      .patch(`/v1/conversations/${conv.id}/model`)
      .set('Authorization', `Bearer ${switchToken}`)
      .send({ modelId: 'model-2' });
    expect(switchRes.status).toBe(200);
    expect(switchRes.body.modelId).toBe('model-2');

    // GET conversation — confirm modelDisplayName matches the new model.
    const detail = await request(app.getHttpServer())
      .get(`/v1/conversations/${conv.id}`)
      .set('Authorization', `Bearer ${switchToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.modelId).toBe('model-2');
    expect(detail.body.modelDisplayName).toBe('Model Two');
  });

  it('PATCH rejects a disabled model with 422 model_unavailable', async () => {
    const { ConversationsService } = await import('../../src/modules/conversations/conversations.service');
    const conversations = app.get(ConversationsService);
    const ds = app.get(DataSource);
    const rows = await ds.query('SELECT id FROM users WHERE email = ? LIMIT 1', ['switcher-stream@example.com']);
    const userId = rows[0].id;
    const conv = await conversations.create({ userId, modelId: 'model-1', userMessage: 'seed turn' });

    const res = await request(app.getHttpServer())
      .patch(`/v1/conversations/${conv.id}/model`)
      .set('Authorization', `Bearer ${switchToken}`)
      .send({ modelId: '00000000-0000-4000-8000-000000000999' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('model_unavailable');
  });

  it('PATCH returns 403 when called by a non-owner', async () => {
    // Register a second user.
    const regB = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email: 'switcher-stream-b@example.com', password: 'correct-horse-battery-staple' });
    const tokenB = regB.body.accessToken;

    const { ConversationsService } = await import('../../src/modules/conversations/conversations.service');
    const conversations = app.get(ConversationsService);
    const ds = app.get(DataSource);
    const rows = await ds.query('SELECT id FROM users WHERE email = ? LIMIT 1', ['switcher-stream@example.com']);
    const userId = rows[0].id;
    const conv = await conversations.create({ userId, modelId: 'model-1', userMessage: 'seed turn' });

    const res = await request(app.getHttpServer())
      .patch(`/v1/conversations/${conv.id}/model`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ modelId: 'model-2' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('forbidden');
  });
});
```

**Note**: this block assumes the chat-stream suite already seeds two enabled models (`model-1` / `Model One`, `model-2` / `Model Two`). If it seeds only one, the implementer should add a second `modelRepo.create({ id: 'model-2', displayName: 'Model Two', actualName: 'model-two', enabled: true })` to its existing `beforeAll` block.

- [ ] **Step 2: Run the file**

Run: `cd backend && npx jest test/integration/chat.stream.e2e.spec.ts --no-coverage`
Expected: all PASS.

- [ ] **Step 3: Commit**

```
Suggested commit message: test(integration): cover conversation model switch in chat flow
```

---

## Task 9: Backend — unit tests for `ConversationsService.setModel()`

**Files:**
- Modify: `backend/test/unit/conversations.service.spec.ts`

**Interfaces:**
- Produces: unit tests for the three service-level paths (owner success, non-owner ForbiddenException, missing conversation null).

- [ ] **Step 1: Add the unit tests**

The existing file (read it first) uses a hand-rolled in-memory `conversationRepo` mock. Append a new `describe('setModel')` block that uses the same harness:

```typescript
describe('setModel', () => {
  it('updates the model id when the caller is the owner', async () => {
    // Seed a conversation owned by 'u1' with modelId 'm1'.
    const created = await svc.create({ userId: 'u1', modelId: 'm1', userMessage: 'hello' });

    const updated = await svc.setModel(created.id, 'u1', 'm2');

    expect(updated).not.toBeNull();
    expect(updated!.modelId).toBe('m2');
    // conversationRepo.save was called with the new modelId.
    expect(conversationRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: created.id, modelId: 'm2' }),
    );
  });

  it('throws ForbiddenException when caller is not the owner', async () => {
    const created = await svc.create({ userId: 'u1', modelId: 'm1', userMessage: 'hello' });

    await expect(svc.setModel(created.id, 'someone-else', 'm2')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns null when the conversation does not exist', async () => {
    const result = await svc.setModel('c-does-not-exist', 'u1', 'm2');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run**

Run: `cd backend && npx jest test/unit/conversations.service.spec.ts --no-coverage`
Expected: all PASS.

- [ ] **Step 3: Commit**

```
Suggested commit message: test(unit): cover ConversationsService.setModel
```

---

## Task 10: Final verification

- [ ] **Step 1: Run full backend test suite**

Run: `cd backend && npm test`
Expected: all PASS.

- [ ] **Step 2: Backend lint + type-check**

Run: `cd backend && npm run lint && npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Frontend type-check + lint**

Run: `cd frontend/app && npx vue-tsc --noEmit && npm run lint`
Expected: zero errors.

- [ ] **Step 4: End-to-end smoke**

Manual flow:
1. Start backend and frontend.
2. Log in as a user with at least two enabled models.
3. Open `/chat`. The header chip shows the picker + the selected model's display name.
4. Pick model A. Send a message. Confirm the conversation is created with model A.
5. Refresh the page. Confirm the conversation reloads with model A still selected (picker + header label match).
6. Pick model B from the picker. Confirm no error toast; the conversation's model switches.
7. Send a second message. Confirm `GET /v1/conversations/:id` returns `modelId` = B and `modelDisplayName` = "Model B".
8. Reload again. Confirm model B is still selected.
9. From a second user account, PATCH the original user's conversation. Confirm 403.
10. PATCH the original user's conversation with a disabled model id. Confirm 422 with `code: 'model_unavailable'`.
11. While a generation is streaming, try to change the picker. Confirm the picker is disabled (no change fires).
12. Open the conversation list (sidebar). Confirm each row shows the model display name under the title.

- [ ] **Step 5: Append a final commit message**

```
Suggested commit message: feat: phase 2 user model selector — complete
```

---

## Self-Review (against the spec)

- **API to retrieve models available to the current user** — covered by existing `GET /v1/models`; this plan doesn't break it.
- **Model selector in the chat UI** — existing `ModelPicker`; this plan wires it to PATCH on change and syncs from `conversation.modelId`.
- **Send the selected model with a new chat request** — already handled: `useChatStream.send()` puts `selectedModelId.value` into `ChatRequest.modelId`, and the chat service accepts it.
- **Persist the selected model per the agreed design** — per-conversation; `Conversation.modelId` updated via the new PATCH endpoint.
- **Display the active model in the conversation** — chat header (Task 6) + conversation row (Task 7).
- **Validate model availability on the backend** — PATCH endpoint rejects disabled/unknown models with 422; existing chat-stream validation already covers the per-request path.

**Acceptance criteria coverage:**

- *User sees only models they are allowed to use* — `GET /v1/models` already filters `enabled = true`. ✓
- *User can switch between available models* — picker change → PATCH → `Conversation.modelId` updated. ✓
- *A message is sent to the selected model* — chat service uses `Conversation.modelId` when `dto.modelId` is omitted; explicit `dto.modelId` overrides. ✓
- *The selected model is correctly preserved after reload* — `useChatStream.loadConversation()` now sets `selectedModelId` from `detail.modelId`. ✓
- *Invalid or unavailable model IDs are rejected* — PATCH returns 422 with `code: 'model_unavailable'`; chat-stream path already returns the same code. ✓
- *Existing conversations and streaming remain functional* — covered by regression run of conversations + chat-stream integration suites. ✓
