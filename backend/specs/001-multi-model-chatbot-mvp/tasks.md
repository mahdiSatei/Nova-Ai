# Tasks: Multi-Model Chatbot (MVP)

**Input**: Design documents from `/specs/001-multi-model-chatbot-mvp/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/openapi-3.1.yaml, quickstart.md
**Tests**: Test-Alongside (per constitution Principle IV) — tests are bundled into each user story task, not separate tasks.

## Format

- `[P]` = parallelizable (different files, no dependencies on incomplete tasks)
- `[USn]` = belongs to user story `n`
- File paths are absolute within `backend/` (the working directory)

---

## Phase 1: Setup

**Purpose**: Project initialization.

- [x] T001 Initialize the NestJS project at `backend/` per `plan.md` Source Code layout: create `package.json` with all dependencies listed under plan.md §Primary Dependencies; create `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`, `jest.config.ts`, `.eslintrc.cjs`, `.prettierrc`, `.gitignore` (excludes `.env`, `logs/`, `data/`), `.env.example`; create the empty directory tree `src/{common/{filters,interceptors,pipes,decorators,guards},config,database/migrations,modules/{auth,users,chat,conversations,models,provider,app-config,health}}`; run `npm install` to verify the manifest resolves cleanly. Verification: `npx nest --version` and `npm ls --depth=0` exit zero.

---

## Phase 2: Foundational

**Purpose**: Blocking prerequisites shared by every user story. **No story work begins until this phase is complete.**

- [x] T002 Implement the full foundational layer: (a) `src/config/{configuration.ts,env.validation.ts}` — typed config tree with env validation via `class-validator` for `PORT`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL=15m`, `JWT_REFRESH_TTL=7d`, `DB_DRIVER=sqlite`, `SQLITE_FILE=./data/app.sqlite`, `LOG_LEVEL=info`, `LOG_DIR=./logs`, `PROVIDER_ENCRYPTION_KEY`; (b) `src/database/data-source.ts` TypeORM DataSource using `synchronize: false` and entities registered via `autoLoadEntities`; (c) all six TypeORM entities in `src/modules/<domain>/entities/` matching `data-model.md` fields and constraints exactly: `User`, `RefreshToken`, `CentralProvider` (singleton id `singleton`), `Model`, `AppConfig` (singleton id `singleton`), `Conversation`, `Message`; (d) initial migration at `src/database/migrations/1700000000000-init.ts` that creates all six tables plus the partial unique index `WHERE is_default = true` on `models`; (e) `src/common/filters/all-exceptions.filter.ts` that translates internal errors to sanitized `{ code, message, requestId }` envelopes (no stack traces leaked); (f) `src/common/interceptors/logging.interceptor.ts` using `nestjs-pino` with `pino-roll` writing JSON to `backend/logs/app-YYYY-MM-DD.log` (14-day retention, stdout mirror in development) and attaching a UUID `req.id` echoed in `x-request-id`; (g) `src/common/guards/{jwt-auth.guard.ts,roles.guard.ts}` plus `src/common/decorators/{current-user.decorator.ts,roles.decorator.ts,public.decorator.ts}`; (h) `src/modules/auth/strategies/jwt.strategy.ts` with HS256 verification against `JWT_SECRET` and an in-memory `Map<jti, expiresAt>` revocation list populated by logout; (i) `src/main.ts` boot wiring `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`, the global filter, the logger middleware, `helmet`, and `enableShutdownHooks`; (j) Swagger at `/api/docs` configured to emit the OpenAPI doc; (k) package.json scripts: `start`, `start:dev`, `build`, `test`, `test:e2e`, `migration:run`, `migration:revert`, `migration:generate`, `openapi:export` (which writes `backend/specs/001-multi-model-chatbot-mvp/contracts/openapi-3.1.yaml` matching the committed file in this repo). Tests bundled in: unit tests for the filter, the JWT strategy (including revocation lookup), the validation pipe, and an integration test that boots the app against an in-memory SQLite and asserts `/healthz` returns 200 and `/readyz` returns 200 after migrations run. Verification: `npm run build` succeeds, `npm test` passes, `npm run migration:run` against an empty `data/` produces all six tables, `npm run openapi:export` produces a YAML matching `contracts/openapi-3.1.yaml` structurally (route count + status codes).

---

## Phase 3: User Story 1 — Account Registration and Login (P1) 🎯 MVP slice A

**Goal**: A new visitor can register, log in, log out, and the server rejects unauthenticated requests on protected routes.

**Independent Test**: `curl` script in quickstart.md §2 + §5: register a user, log in, capture the access token, hit `/v1/models` with and without the token, observe 200 vs 401; log out, observe 401 on subsequent calls.

- [x] T003 [US1] Implement the `auth` and `users` modules end-to-end per `data-model.md` (User, RefreshToken) and `contracts/openapi-3.1.yaml` `/v1/auth/*`: `src/modules/users/users.service.ts` exposes `create({email,password})` (lowercases email, hashes with Argon2id falling back to bcrypt cost 12, rejects duplicates with 409), `findByEmail`, `findById`; `src/modules/auth/auth.controller.ts` exposes `POST /v1/auth/register` (201, returns `AuthResponse`), `POST /v1/auth/login` (200 on success, 401 with generic message on bad credentials or unknown email — no enumeration), `POST /v1/auth/refresh` (rotates refresh tokens, revokes the old jti), `POST /v1/auth/logout` (204, writes the caller's jti to the revocation list until `expiresAt`); `src/modules/auth/auth.service.ts` implements token issuance (access TTL `JWT_ACCESS_TTL`, refresh TTL `JWT_REFRESH_TTL`) and rotation; DTOs in `src/modules/auth/dto/` use `class-validator` with email format check and `password` `minLength:8, maxLength:128`. Apply `JwtAuthGuard` globally with `@Public()` opt-out on register/login/refresh and `/v1/admin/auth/login`; `@Roles('admin')` enforced by `RolesGuard` on admin routes (US5 will set up the admin routes). Tests bundled in: unit tests for `UsersService.create` (duplicate rejection, password hashing), `AuthService.login` (no email enumeration, generic 401), `AuthService.refresh` (old jti revoked, new pair issued); integration test using `@nestjs/testing` + `supertest` that registers a user, logs in, refreshes, and logs out end-to-end. Verification: `npm test` passes the new suites; manual `curl` walk-through in quickstart.md §2 + §5 succeeds.

---

## Phase 4: User Story 2 — Browse and Select a Model (P1)

**Goal**: An authenticated user can see enabled models with display names and pick one; default model is preselected when the user has not chosen.

**Independent Test**: With admin-side config from US6/US7/US8 in place, a fresh authenticated user hits `GET /v1/models` and sees only enabled models with display names and `isDefault` flags; no actual names leak.

- [x] T004 [US2] Implement the public model-list endpoint and active-model resolution: `src/modules/models/entities/model.entity.ts` (already in T002's migration; this task only wires the read path), `src/modules/models/models.public.controller.ts` exposes `GET /v1/models` returning `{ items: ModelPublic[] }` where each item is `{ id, displayName, isDefault }` — `actualName` MUST NOT appear in the response (enforced by a typed DTO with `class-transformer` `@Exclude`); `src/modules/models/models.service.ts` exposes `listEnabled()` (only `enabled=true`), `findById(id)`, and `resolveActiveModel({ explicitModelId, userId })` implementing the resolution order: explicit `modelId` → caller's sticky choice (read from a per-user `AppConfig` extension or, for MVP, a column on `User.lastSelectedModelId` — add the column via a follow-up migration here) → `AppConfig.defaultModelId` → null (caller surfaces 422). Tests bundled in: unit tests for `ModelsService.listEnabled` (excludes disabled), `ModelsService.resolveActiveModel` (all four branches including the "no default designated" empty-state branch); integration test that seeds two models (one disabled), hits `GET /v1/models` as a user, asserts only the enabled model appears with no `actualName` field; second integration test verifies a fresh user with no explicit selection and a designated default sees the default preselected via `resolveActiveModel`. Verification: `npm test` passes; `curl -s .../v1/models -H "Authorization: Bearer $ACCESS"` returns only enabled models and no `actualName` fields.

---

## Phase 5: User Story 3 — Streaming Chat (P1)

**Goal**: An authenticated user can send a message and receive an SSE-streamed response from the selected/default model, with prior conversation turns included as context.

**Independent Test**: Configure provider + at least one model + default (admin tasks), log in as a user, `curl -N -X POST /v1/chat/stream` with `{"message":"hello"}`, observe `data: {"delta":"..."}` events followed by `event: done`; close the browser mid-stream and observe server logs marking the stream as terminated.

- [x] T005 [US3] Implement the chat module end-to-end: `src/modules/chat/provider/openai-compatible.client.ts` wraps the `openai` SDK with `baseURL` and `apiKey` read fresh from `CentralProvider` on every request (no caching); `src/modules/chat/chat.controller.ts` exposes `POST /v1/chat/stream` returning `@Sse()` with `text/event-stream` and an RxJS `Observable<MessageEvent>` that yields `{ data: { delta } }` events as tokens arrive, terminates with `event: done` on success, `event: error` with a sanitized `{ code, message }` payload on provider error / malformed response / 4xx; on client disconnect the Observable teardown closes the upstream HTTP request; `src/modules/chat/chat.service.ts` resolves the active model via `ModelsService.resolveActiveModel`, refuses with `409` if central provider is unconfigured (FR-016), refuses with `422 { code: "no_model_available" }` if no model is resolvable (FR-019), validates the message body (1..32000 chars per FR-014) via `class-validator`, persists the user message and (on stream complete) the assistant response via `ConversationsService` (deferred to US4 — for this task, create the service interface and a stub that records into memory; US4 swaps it for the persistent implementation), assembles prior turns as `messages` for the provider call per FR-015. Add the `User.lastSelectedModelId` column via a follow-up migration generated by `typeorm migration:generate`. Tests bundled in: unit tests for `ChatService` (no-model 422, unconfigured-provider 409, message length validation, prior-turn assembly); integration test that records a stub OpenAI-shaped NDJSON stream and asserts the SSE output is byte-correct (`data: {"delta":"hello"}\n\n` style), the final `event: done` is emitted, and that an aborted client triggers provider-stream teardown; contract test asserting `actualName` is what gets sent to the provider as the `model` field. Verification: `npm test` passes; `quickstart.md` §9 step produces an SSE stream.

---

## Phase 6: User Story 4 — Conversation History (P2)

**Goal**: A user can list, open, and delete their conversations; messages persist across sessions.

**Independent Test**: Send two messages in separate conversations, log out, log back in, hit `GET /v1/conversations` and see both ordered by most recent `updatedAt`; open one and see the full transcript; delete the other and confirm it disappears.

- [x] T006 [US4] Implement the conversations module: `src/modules/conversations/{conversations.controller.ts, conversations.service.ts}` expose `GET /v1/conversations?limit=&offset=` (ordered by `updatedAt desc`), `GET /v1/conversations/:id` (returns full `ConversationDetail` with messages in `createdAt` order; 403 if owner mismatch; 404 if missing), `DELETE /v1/conversations/:id` (204; cascade deletes messages; 403/404 same rules); the `title` field defaults to the first user message truncated to 80 chars; update `ChatService` (from T005) to call `ConversationsService.create` on first message and `ConversationsService.appendMessage` on each persisted message — replace the in-memory stub from T005 with these persistent calls. Tests bundled in: unit tests for `ConversationsService` (list ordering, owner-scoped access, cascade delete); integration test creating two conversations via the chat endpoint, listing them, opening one, deleting the other, asserting list reflects the change. Verification: `npm test` passes; `quickstart.md` §10 step succeeds.

---

## Phase 7: User Story 5 — Admin Role Separation (P1)

**Goal**: Admin login issues a JWT with `role: admin`; admin routes reject regular-user tokens with 403 and unauthenticated requests with 401.

**Independent Test**: With an admin user seeded by `scripts/seed-admin.ts`, hit `/v1/admin/models` with a regular user's JWT → 403; without a JWT → 401; with an admin JWT → 200.

- [x] T007 [US5] Wire the admin role boundary: extend `auth.service.ts` (from T003) so login issues a JWT whose `role` claim matches the user's role; `RolesGuard` reads the `@Roles('admin')` metadata and returns 403 when the JWT role doesn't match (distinct from 401, which JwtAuthGuard returns when no/invalid token); seed script at `scripts/seed-admin.ts` (referenced in `quickstart.md` §4) hashes a password with Argon2id and inserts a `User` row with `role: 'admin'`. Placeholder admin route file `src/modules/models/models.admin.controller.ts` (no endpoints yet — just the `@Controller('v1/admin/models')` skeleton with `@UseGuards(JwtAuthGuard, RolesGuard)` and `@Roles('admin')`) so this task is independently testable without US6/US7/US8; full admin CRUD endpoints are filled in by US7/US8. Tests bundled in: unit test for `RolesGuard` (403 vs 401 distinction); integration test that seeds admin + user, logs in as each, hits the placeholder admin route, asserts 200/403/401 for the three auth states. Verification: `npm test` passes; manual `curl` walk-through in quickstart.md §4 succeeds.

---

## Phase 8: User Story 6 — Admin Configures the Central Provider (P1)

**Goal**: Admin can view and update the central provider (base URL + API key); credential is masked on read and validated against the provider on save.

**Independent Test**: PUT a valid provider config, then GET it — credential is masked (`apiKeyMasked: "***xxxx"`); PUT an invalid credential — request is rejected with 422 and the prior config remains.

- [x] T008 [US6] Implement the provider module: `src/modules/provider/{provider.module.ts, provider.controller.ts, provider.service.ts}` and `src/modules/provider/entities/central-provider.entity.ts` (entity already in T002's migration; this task wires the service). Controller exposes `GET /v1/admin/provider` (returns `CentralProviderPublic` with `apiKeyMasked` showing the last 4 chars prefixed `***`, never the full key) and `PUT /v1/admin/provider` (validates `baseUrl` is a valid http(s) URL and `apiKey` is non-empty, then probes the provider with a minimal `POST /chat/completions` non-streaming call before saving; on probe failure returns 422 and leaves the prior config untouched); encryption via AES-256-GCM in a `src/common/crypto/credential-cipher.ts` helper using `PROVIDER_ENCRYPTION_KEY` from config (random 12-byte IV per save, auth tag stored alongside ciphertext); update `lastValidatedAt` on successful probe. Tests bundled in: unit tests for `CredentialCipher` (round-trip, tampered ciphertext fails decryption), `ProviderService.update` (probe failure leaves prior config, validation failure returns 422); integration test that uses a stub HTTP server returning 200 on probe and asserts save succeeds, then with a stub returning 401 asserts save is rejected with 422 and prior config unchanged; second integration test asserts `GET` never returns the cleartext key. Verification: `npm test` passes; `quickstart.md` §5 walk-through succeeds.

---

## Phase 9: User Story 7 — Admin Manages Models (P1)

**Goal**: Admin can CRUD models with display name + actual name, enable/disable them, delete them; display names are unique and only enabled models appear to users (already wired in US2).

**Independent Test**: Add two models with distinct display/actual names, disable one, verify it disappears from `GET /v1/models`; delete the other, verify it disappears from admin list too; confirm `actualName` never appears in any user-facing response.

- [x] T009 [US7] Implement the admin model CRUD: `src/modules/models/{models.admin.controller.ts, models.service.ts}` (entity and public controller from T002/T004) expose `GET /v1/admin/models` (all models, including disabled), `POST /v1/admin/models` (creates with `displayName` 1-80 chars unique, `actualName` 1-200 chars, `enabled` defaults `true`), `PATCH /v1/admin/models/:id` (updates any of `displayName`/`actualName`/`enabled`), `DELETE /v1/admin/models/:id` (refuses with 409 if `AppConfig.defaultModelId` references this model or any non-deleted conversation references it; admin must unset the default or the conversations first); service enforces the "only enabled model can be `isDefault`" invariant at the service layer (the DB-level partial unique index is the final guard). Tests bundled in: unit tests for `ModelsService` (displayName uniqueness, `isDefault` invariant when toggling `enabled`, delete-when-default-referenced refusal); integration test creating two models, disabling one, deleting the other, verifying admin GET and user GET reflect the changes; second integration test asserting `actualName` never appears in user responses across all admin endpoints. Verification: `npm test` passes; `quickstart.md` §6 walk-through succeeds.

---

## Phase 10: User Story 8 — Admin Sets the Default Model (P1)

**Goal**: Admin can designate exactly one enabled model as the system default; setting replaces prior; disabling the default clears it; user-side picker reflects `isDefault` marker.

**Independent Test**: With two enabled models, PUT `defaultModelId` to model A → users see A as `isDefault: true`; PUT to model B → users see B as default; disable model B → `GET /v1/admin/config` shows `defaultModelId: null` and users see no default; attempt to set a disabled model as default → 422.

- [x] T010 [US8] Implement the AppConfig admin endpoint: `src/modules/app-config/{app-config.controller.ts, app-config.service.ts}` (entity from T002) expose `GET /v1/admin/config` and `PUT /v1/admin/config { defaultModelId: uuid|null }`. On PUT: if `defaultModelId` is non-null, the referenced model MUST exist and be `enabled = true` — otherwise 422 with `{ code: "model_not_eligible_default", message: "Only enabled models can be the default." }`; if `defaultModelId` references the current default, no-op; if it references a different enabled model, atomically clear the prior default's `is_default` flag and set the new one inside a TypeORM transaction; passing `null` clears the default. Wire the `Model.isDefault` flag in this service (the public GET in T004 reads it). Tests bundled in: unit tests for `AppConfigService` (replace default, clear default, reject disabled, atomic toggle); integration test that sets, replaces, clears, and rejects as described in the Independent Test above; verify `GET /v1/models` reflects `isDefault` flag at each step. Verification: `npm test` passes; `quickstart.md` §7 walk-through succeeds.

---

## Phase 11: Polish & Cross-Cutting Concerns

- [x] T011 Final polish pass: (a) regenerate `backend/specs/001-multi-model-chatbot-mvp/contracts/openapi-3.1.yaml` via `npm run openapi:export` and verify it matches the committed file structurally (same routes, same status codes, same schemas); (b) add a `seed-admin` npm script that calls `scripts/seed-admin.ts` with env vars; (c) verify `quickstart.md` end-to-end (steps 1 → 10) against a fresh database; (d) add `npm run lint` and verify the codebase is lint-clean; (e) confirm the constitution Cross-cutting rule checks from `plan.md` are all met (sanitized errors, structured logs, env-loaded secrets, whitelist validation, header `x-request-id` propagation, masked credentials in API responses, `apiKeyEncrypted` never appears in logs); (f) add a brief `backend/README.md` summarizing how to run, test, and migrate. Verification: `npm run lint` clean; `npm test` all green; `npm run openapi:export` produces the committed contract; manual quickstart walk-through succeeds against a freshly initialized database.
- [x] T012 [US6-fix] Fix `ProviderService.probe()` to validate credentials via `GET {baseUrl}/models` instead of POSTing with a fake `model: 'probe'` body. The fake model produced `HTTP 400` ("model not found") from real providers before auth was checked, which the probe then mis-classified as `credentials_rejected`. New behavior: `GET /models` is the primary auth check; if the provider does not expose `/models` (404/405), fall back to a chat-completions probe and discriminate the response — 401/403 → `credentials_rejected`, other 4xx → new `provider_request_invalid`, 5xx/network → `provider_unreachable`. Files: `src/modules/provider/provider.service.ts` (probe rewrite), `test/unit/provider.service.spec.ts` (new probe matrix), `test/integration/provider.e2e.spec.ts` (stub handles `GET /models`; new cases for 401/500/400-fallback/503-fallback), `specs/.../contracts/openapi-3.1.yaml` (PUT `/v1/admin/provider` 422 expanded with three examples; new `ProviderProbeFailed` shared response in 3.1). Verification: `npx tsc --noEmit` clean; `npx jest test/unit/provider.service.spec.ts` and `npx jest test/integration/provider.e2e.spec.ts` all green; manual `PUT /v1/admin/provider` with a real OpenAI key + valid base URL now returns 200 instead of 422 `credentials_rejected`; with a deliberately wrong key, response is still 422 but message contains the real upstream HTTP 401 and `code` is `credentials_rejected`.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (T001)** → no dependencies, can start immediately
- **Foundational (T002)** → depends on T001; **blocks all user stories**
- **User Stories (T003–T010)** → depend on T002
  - T003 (US1) is the foundation for everything user-side
  - T004 (US2), T005 (US3), T006 (US4) extend the user-side surface and build on T003's auth
  - T007 (US5) is the role-separation gate for T008–T010
  - T008 (US6) + T009 (US7) + T010 (US8) feed the active-model resolution in T004/T005
- **Polish (T011)** → depends on T003..T010

### Recommended execution order

T001 → T002 → T003 → T007 → T008 → T009 → T010 → T004 → T005 → T006 → T011

US2/US3/US4 can run in parallel with US7/US8 as long as the public DTOs in T002 are stable.

### Parallel opportunities

- T003 + T007 are independent and can run in parallel (auth module and role-guard scaffold are disjoint files)
- T008 + T009 + T010 are sequential among themselves (US10 atomic-toggle touches US7's model rows and US6's provider config)
- T004 + T005 + T006 can be split across developers after the user-side auth (T003) is done

## MVP Scope (smallest shippable slice)

Complete T001 + T002 + T003 + T007 + T008 + T009 + T010 + T004 + T005 + T006 → working end-to-end MVP with all 8 user stories deliverable, no polish. T011 is the release gate.
