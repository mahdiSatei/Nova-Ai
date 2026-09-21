# Multi-Provider Management & Model Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow administrators to configure multiple providers and manage models bound to those providers, without putting provider-specific behavior in chat orchestration.

**Architecture:** Keep the NestJS modular monolith and existing Vue admin screens. Persist providers and required model foreign keys; inject a provider runtime backed by an explicitly registered adapter collection. Adapters translate upstream streams into text deltas and failures into safe domain errors; ChatService retains conversation persistence and SSE ownership.

**Tech Stack:** Node.js 20, NestJS 10, TypeScript, TypeORM 0.3, SQLite with PostgreSQL compatibility, existing OpenAI SDK, class-validator, RxJS, Vue 3, Jest, Vitest, Vue Test Utils and happy-dom.

**Spec:** The Phase 1 requirements supplied in this conversation are captured verbatim under “Phase 1 scope” below. `backend/specs/001-multi-model-chatbot-mvp/spec.md` supplies regression requirements, not authorization to retain its singleton-only restriction. Task 1 creates `backend/specs/002-multi-provider-model-catalog/spec.md` and the associated Spec Kit artifacts before implementation.

## Global Constraints

- Out of scope: User model selector, quotas, automatic fallback, web search, reasoning.
- Preserve the existing user model-selection surface; do not build or redesign a selector.
- Backend-agent source, tests, configuration and documentation remain under `backend/`; frontend work is a separate package-scoped handoff. The user explicitly authorized replacing this root plan on 2026-09-17; this does not waive package isolation for implementation.
- Agents do not run git mutations, create worktrees, commit, push, reset or stage files. The human operator owns commits. Each task supplies a suggested commit message instead.
- Follow `backend/.specify/memory/constitution.md` v1.0.0 and `backend/CLAUDE.md`. Complete specify → clarify → plan → tasks before implementation; this document does not silently waive Spec Kit stages.
- Use TypeORM repositories in domain logic. Schema/data SQL is permitted in migrations, not HTTP handlers or domain services.
- Strict `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`; sanitized JSON error envelope `{ code, message, requestId }` and existing SSE event shapes.
- Encrypt provider credentials with existing AES-256-GCM credential-cipher functions. Never return plaintext/ciphertext, log keys or upstream response bodies, or put real credentials into fixtures.
- No new runtime dependency is required. Use the existing testing stacks; review any tooling dependency addition before installation.
- No live provider requests in automated tests. Use fakes or a loopback HTTP server and synthetic credentials.
- All work currently present is unverified. Preserve unrelated edits, `backend/package-lock.json`, `.freebuff/project-id`, and the unrelated untracked `500)` file. Do not remove or “clean up” them.

---

## Phase 1 scope

Goal: Allow administrators to configure multiple providers and the models they offer.

### Backend

- Provider configuration management.
- Model catalog management.
- Provider adapter interface.
- Provider-specific implementation behind the adapter.
- Model activation/deactivation.
- Normalized provider errors.
- Unit/integration tests using fake providers.

### Frontend

- Admin provider management UI.
- Admin model management UI.
- Model creation/editing.
- Active/inactive state.
- Validation and error handling.

### Acceptance criteria

- Admin can create and manage providers and models.
- A model references a configured provider.
- The chat service invokes models through the adapter, not provider-specific logic.
- Adding another provider does not require rewriting the chat orchestration.
- Provider errors are normalized and do not crash the application.

Out of scope: User model selector, quotas, automatic fallback, web search, reasoning.

## Baseline and evidence limitations

This revision replaces the previous draft, not application code. No builds, tests, migrations, network probes or deployment were run during planning. The graph was ready with generation `2026-09-17T19:28:31Z`, but coverage reported changed file metadata; current direct source reads were therefore used. Frontend `useChatStream.ts` has recorded parse gaps at lines 40–56 and is not a planned implementation target. This is a bounded implementation assessment, not a complete application audit.

| Area | Observed state | Required action |
|---|---|---|
| Provider entity/CRUD | Present as uncommitted work | Correct injection, validation, credential handling, uniqueness, deletion policy and contract |
| Adapter | OpenAI-compatible class exists | Replace SDK-shaped public chunks; normalize startup and iteration failures |
| Provider module | Exports an unregistered error class; adapter array lacks an injection token | Register a token-backed adapter collection; export runtime service only where needed |
| Migration | Exists under `backend/src/database/migrations/` | Repair conditional backfill, explicit FK and non-null policy; test real migrations |
| Model entity | Nullable provider column and relation without explicit join column | Use one required `provider_id` column and explicit `JoinColumn` |
| Model service/DTO/admin controller | Legacy input/output, no provider assignment | Wire providerId through every layer |
| Chat | Still imports OpenAI and OpenAICompatibleClient | Replace provider boundary while retaining stream lifecycle |
| Provider unit test | In `backend/src/test/unit/`, unresolved mock variable and incomplete repository mocks | Repair/consolidate under existing `backend/test/unit/` conventions |
| Frontend | Singleton provider UI; model modal has no provider input | Update actual form components, not only views |
| Contract | Singular `/v1/admin/provider` remains documented | Coordinate breaking admin API release before implementation |

Material source anchors: `backend/src/modules/provider/provider.service.ts:46`, `backend/src/modules/provider/provider.module.ts:13`, `backend/src/modules/provider/adapters/provider-adapter.interface.ts:8`, `backend/src/database/migrations/1700000005000-add-provider-model-fk.ts:23`, `backend/src/modules/models/models.service.ts:145`, `backend/src/modules/chat/chat.service.ts:76`, `frontend/app/src/components/admin/ModelFormModal.vue:13`.

## Design decisions to approve with this plan

1. **First production adapter:** `openai-compatible`. Multiple provider records can use it with independent URLs and encrypted keys. Another native protocol requires a new adapter and registry/type registration, not a ChatService change. A second test-only adapter proves this boundary.
2. **Provider IDs:** immutable lowercase slugs, 1–80 characters, pattern `^[a-z0-9-]+$`. Preserve the draft's IDs; do not accidentally apply UUID validation to providerId. Model IDs retain their existing format.
3. **Every model has a provider:** required `providerId` on create, optional but never null on patch, non-null FK with `ON DELETE RESTRICT`. No “No provider” dropdown option.
4. **Activation:** a model may be saved disabled against an inactive provider. Creating/enabling a model against an inactive provider returns `422 provider_inactive`. Deactivating a provider preserves model rows and their configured `enabled` values but blocks new generations. Reactivation restores eligibility. Never reroute a failed generation to another provider.
5. **Default model behavior:** retain default assignment and model deletion/migration features. Disabling a default model clears both `Model.isDefault` and the AppConfig pointer transactionally. Provider deactivation retains the default pointer, but requests fail safely while that provider is unavailable; it does not silently choose a replacement. Existing selection order is not expanded into automatic provider fallback.
6. **Save versus validate:** persist structurally valid provider settings without network access. Explicit `POST /validate` checks the connection. Show “Saved; not yet validated,” never claim saving verifies credentials. This deliberately changes the singleton form's validate-before-save behavior.
7. **Connection validation:** bounded `GET /models` on the selected provider, no arbitrary paid chat probe. A 404/405 means `provider_validation_unsupported`, not invalid credentials. A successful check establishes endpoint accessibility, not that every catalog model is available.
8. **URL policy:** production uses HTTPS endpoints on an operator-managed hostname/port allowlist. Reject userinfo, query strings and fragments, normalize trailing slashes, and retain an optional API path such as `/v1`. HTTP is allowed only for explicitly enabled local development/test endpoints. Apply policy on save and runtime use, disable redirects, and pair it with production egress controls; hostname checks alone do not solve DNS rebinding. UI explains administrator/operator restrictions.
9. **Breaking release:** replacement of `/v1/admin/provider`, new required model create input, and save semantics are breaking. Increment OpenAPI `info.version` to the next major version and record migration instructions. Deploy backend and admin frontend together during a maintenance window; do not claim backward compatibility. The current route namespace remains `/v1` for this coordinated application release, as the constitution requires a contract-version increment but does not explicitly mandate URL-major equivalence. If external clients require independent upgrades, stop Task 1 and choose parallel `/v2` routes instead of removing their contract.
10. **Migration safety:** a populated legacy model catalog without a singleton provider cannot be assigned honestly. Fail before schema mutation with a remediation message; the operator configures the legacy provider using the old release, then retries. Never fabricate credentials, delete models or assign dangling `central` IDs.

## Contract baseline

Canonical API contract remains `backend/specs/001-multi-model-chatbot-mvp/contracts/openapi-3.1.yaml`. Task 1 updates it before controllers; feature 002 documents that canonical location rather than maintaining a second divergent copy. Retain the project's JSON error envelope rather than switching the entire client to ProblemDetail. Preserve the existing `{ items, total, page, pageSize }` model pagination convention; inspect the exact existing model-list schema before editing its references.

| Operation | Result | Specific failures beyond 400/401/403/500 |
|---|---|---|
| GET `/v1/admin/providers?page=1&pageSize=20` | 200 `{items,total,page,pageSize}`; name ascending | Invalid pagination → 400 |
| POST `/v1/admin/providers` | 201 ProviderPublic + Location | 409 duplicate ID/name; 422 unsupported type or endpoint policy |
| GET `/v1/admin/providers/{id}` | 200 ProviderPublic | 404 provider_not_found |
| PATCH `/v1/admin/providers/{id}` | 200 ProviderPublic | 404; 409 name conflict; 422 endpoint policy |
| DELETE `/v1/admin/providers/{id}` | 204, no body | 404; 409 provider_in_use |
| POST `/v1/admin/providers/{id}/validate` | 200 ProviderPublic with validation timestamp | 404; 422 rejected credentials/unsupported check/corrupt key; 502 upstream; 503 network/rate limit; 504 timeout |
| Existing admin model list/read | Add required providerId to admin shape | Preserve existing errors |
| Existing model POST | Require displayName, actualName, providerId; enabled defaults true | 422 missing/inactive provider; existing name conflict |
| Existing model PATCH | Optional providerId; reject null/empty; preserve omitted key | 422 missing/inactive provider; existing errors |
| Existing model DELETE/default operations | Preserve payloads, migration results and status codes | Preserve existing errors; validate destination eligibility |

Pagination limits: `page >= 1`, `1 <= pageSize <= 100`, default 20. Provider management may load further pages for the model form; never silently show just the first 20 providers. List all configured providers, including inactive entries, to explain existing assignments.

```ts
export type ProviderType = 'openai-compatible';
export interface ProviderPublic {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  hasApiKey: boolean;
  isActive: boolean;
  lastValidatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface ProviderCreateInput {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiKey: string;
  isActive?: boolean;
}
export interface ProviderUpdateInput {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  isActive?: boolean;
}
export interface CreateModelInput {
  displayName: string;
  actualName: string;
  providerId: string;
  enabled?: boolean;
}
export interface UpdateModelInput {
  displayName?: string;
  actualName?: string;
  providerId?: string;
  enabled?: boolean;
}
```

Provider type is immutable after creation; changing protocol means creating another provider and reassigning models. `hasApiKey` replaces key-suffix disclosure; edit fields start blank and omit apiKey when unchanged. Name lengths 1–80 after trim; baseUrl maximum 500; API key length 8–500, printable non-whitespace ASCII for the initial compatible adapter. Reject explicit null on optional PATCH fields using `ValidateIf((_, value) => value !== undefined)` followed by normal validators. Use `IsIn(['openai-compatible'])` and `IsBoolean`, not an undecorated boolean or array passed as an enum.

## File structure and ownership

Paths marked “new” are planned files, not claims that they exist. Existing untracked source is revised in place only after the operator approves implementation.

### Backend

- `backend/specs/002-multi-provider-model-catalog/{spec.md,plan.md,research.md,data-model.md,tasks.md,quickstart.md}` — new feature governance and execution records.
- `backend/specs/001-multi-model-chatbot-mvp/contracts/openapi-3.1.yaml` — canonical contract update; `api-contract.md` — human-readable change notes.
- `backend/src/database/migrations/1700000005000-add-provider-model-fk.ts` — safe migration if not previously applied; a new higher-timestamp corrective migration is required if applied anywhere.
- `backend/src/database/data-source.ts` — provider entity registration for both drivers.
- `backend/src/modules/provider/entities/provider.entity.ts` — encrypted provider storage and validation timestamp.
- `backend/src/modules/provider/dto/{create-provider.dto.ts,update-provider.dto.ts}` — strict admin inputs.
- `backend/src/modules/provider/provider.service.ts` — configuration CRUD/public projection; no chat orchestration.
- `backend/src/modules/provider/provider.controller.ts` — admin HTTP surface.
- `backend/src/modules/provider/provider.module.ts` — explicit DI registrations.
- `backend/src/modules/provider/adapters/provider-adapter.interface.ts` — neutral boundary; `openai-compatible.adapter.ts` — protocol translation.
- `backend/src/modules/provider/adapters/provider-adapter.registry.ts` — new registry and `PROVIDER_ADAPTERS` token.
- `backend/src/modules/provider/provider-runtime.service.ts` — new provider readiness, credential resolution, adapter dispatch and final failure normalization.
- `backend/src/modules/provider/provider-url-policy.ts` — new deterministic URL policy shared by validation/runtime.
- `backend/src/modules/provider/errors/normalized-provider.error.ts` — code-to-safe-message/status mapping, no upstream raw-message field.
- `backend/src/modules/models/{entities/model.entity.ts,models.service.ts,models.module.ts,models.admin.controller.ts,dto/model-upsert.dto.ts}` — required provider association and eligibility.
- `backend/src/modules/chat/{chat.service.ts,chat.module.ts}` — neutral runtime integration, unchanged SSE shapes.
- `backend/src/common/filters/all-exceptions.filter.ts` — safe normalized-error translation before generic error handling.
- `backend/test/unit/` — provider registry/runtime/service/adapter/URL policy/model tests.
- `backend/test/integration/{provider.e2e.spec.ts,models.admin.crud.e2e.spec.ts}` — adapt existing suites; new `provider-migration.e2e.spec.ts` and `chat.providers.e2e.spec.ts`.
- `backend/test/helpers/fake-provider.adapter.ts` — new reusable deterministic fake.

### Frontend handoff

- `frontend/app/src/types/api.ts` — shared request/response types.
- `frontend/app/src/api/admin.ts` — provider collection functions; updated model create signature.
- `frontend/app/src/components/admin/ProviderForm.vue` — create/edit form without forced credential replacement.
- `frontend/app/src/views/admin/ProviderView.vue` — paginated list and actions.
- `frontend/app/src/components/admin/ModelFormModal.vue` — actual model form/provider selector.
- `frontend/app/src/views/admin/ModelsView.vue` — provider labels/status and unchanged existing actions.
- `frontend/app/tests/api/admin.providers.spec.ts` — new wrapper tests.
- `frontend/app/tests/components/{ProviderForm.spec.ts,ProviderView.spec.ts,ModelFormModal.spec.ts}` — new UI regression tests.

No new router path, client model store or user model-selector component is needed. Retain existing UI styles/components; no redesign or new UI framework.

## Execution order

Tasks 1–7 are backend scoped. Tasks 8–9 are separately assigned frontend work after Task 1's contract is approved. Task 10 verifies the integrated release. Within each task use failing test → focused run → minimum implementation → focused pass. A failure already present still counts as red; do not claim a missing symbol failure if the actual failure is fixture bootstrap. Suggested commits are human actions, not agent commands.

### Task 1: Lock scope, API contract and compatibility policy

**Files:** Create feature-002 documents above; modify canonical OpenAPI and human-readable API contract. Test: new `backend/test/contract/provider-contract.spec.ts`.

**Interfaces:** Consumes Phase 1 scope and legacy API; produces the exact inputs/outputs and error codes in this plan, approved before BE/FE implementation.

- [ ] Copy Phase 1 scope into feature `spec.md`, document decisions 1–10, and explicitly supersede the MVP's single-provider restriction. In `tasks.md`, copy this task order without marking application tasks complete.
- [ ] Add a contract check using the YAML-reading pattern already used by the repository's contract tests. Assert provider paths, authenticated security, required providerId and absence of credential response fields. The central assertion body is:

```ts
expect(document.openapi).toBe('3.1.0');
expect(document.paths['/v1/admin/providers'].post.responses['201']).toBeDefined();
expect(document.components.schemas.ModelCreateRequest.required).toContain('providerId');
expect(document.components.schemas.ProviderPublic.properties.apiKey).toBeUndefined();
expect(document.components.schemas.ProviderPublic.properties.apiKeyEncrypted).toBeUndefined();
```

- [ ] Run from backend: `npm test -- --runInBand test/contract/provider-contract.spec.ts`. Resolve test-loader errors first, then observe missing-contract assertions.
- [ ] Define `ProviderPublic`, `ProviderCreateRequest`, `ProviderUpdateRequest`, `ProviderPage`, and separate model create/patch schemas; include property descriptions/examples, bearer security, all tabled statuses and response descriptions. Use OpenAPI 3.1 null unions, for example:

```yaml
lastValidatedAt:
  type: [string, 'null']
  format: date-time
  description: Time of the last successful explicit connection check.
  examples: [null]
providerId:
  type: string
  minLength: 1
  maxLength: 80
  pattern: '^[a-z0-9-]+$'
  description: ID of the configured provider that serves this model.
  examples: [primary]
```

- [ ] Record next-major `info.version`, removed singular routes, required model field and changed validation semantics. Confirm coordinated release assumption with the operator before proceeding. Document current SSE framing as the existing deliberate REST exception; no new transport.
- [ ] Run focused contract test and the existing export command only after checking whether `backend/scripts/export-openapi.ts` writes or validates the canonical file. Do not let a generated old Swagger document overwrite the new authoritative contract. If the exporter overwrites it, update exporter inputs in this same task and assert required paths survive export.

**Suggested commit message:** `docs(contract): define multi-provider Phase 1 scope and breaking admin API`

### Task 2: Migrate provider storage and required model references safely

**Files:** Provider/model entities, migration, data-source; new migration integration suite. Do not modify existing migration history without checking application status in a disposable database and asking the operator whether this migration has shipped.

**Interfaces:** Produces Provider rows with `lastValidatedAt`, unique IDs and normalized names; non-null `Model.providerId` with `RESTRICT` deletion. Existing `central_provider` remains intact for rollback history, not runtime use.

- [ ] Write migration tests using temporary SQLite and the actual migration classes. Cases: empty database; singleton with multiple models; model rows without singleton; existing conversations/history; FK enforcement; rollback. Use repository inserts for fixtures except migration-specific schema assertions. Core assertions:

```ts
expect((await db.getRepository(Model).find())[0].providerId).toBe('central');
const row = await db.getRepository(Provider).findOneByOrFail({ id: 'central' });
expect(row.apiKeyEncrypted).toBe(legacy.apiKeyEncrypted);
await expect(db.getRepository(Provider).delete('central')).rejects.toThrow();
expect(await db.getRepository(Conversation).count()).toBe(previousConversationCount);
```

The fixture owns `db`, `legacy`, and `previousConversationCount`; initialize it with the pre-Phase-1 migrations, populate legacy data, then execute only the migration under test. Use a separate empty fixture per case and close/unlink it in teardown.

- [ ] Run `npm test -- --runInBand test/integration/provider-migration.e2e.spec.ts`; record actual failure.
- [ ] Before creating tables, count models and inspect singleton presence using QueryRunner. If models exist without singleton, throw `Cannot migrate models without a configured legacy provider; configure it using the previous release and retry.` Do not mutate anything in this branch.
- [ ] Create the providers table through TypeORM `Table`, with text slug PK, name, type, base URL, encrypted key, activity, nullable validation timestamp and driver-appropriate timestamp columns. Match entity metadata to SQLite `datetime` versus PostgreSQL `timestamp`; derive the choice from the configured driver rather than using unsupported SQLite `timestamp` entity metadata.
- [ ] Copy the singleton only if it exists, including its existing validation timestamp; backfill only from that copied row. Add nullable provider_id temporarily, populate it, verify no nulls remain, then make it non-null. Use `TableColumn`, `TableForeignKey`, `TableIndex`, not type-erased object casts. Create a unique `LOWER(name)` database index for race-safe case-insensitive names.
- [ ] Map the entity explicitly:

```ts
@Column({ name: 'provider_id', type: 'text' })
providerId!: string;

@ManyToOne(() => Provider, { nullable: false, onDelete: 'RESTRICT' })
@JoinColumn({ name: 'provider_id', foreignKeyConstraintName: 'fk_models_provider' })
provider!: Provider;
```

- [ ] Rollback removes the named FK/index/column before providers. Refuse rollback if new/modified provider records would be lost; document backup restore as the production rollback method. Never imply migration down preserves a multi-provider configuration in the old singleton schema.
- [ ] Run the suite and backend build. Repeat against an explicitly supplied disposable PostgreSQL test database before claiming PostgreSQL support. If unavailable, mark that check blocked, not passed.

**Suggested commit message:** `feat(provider): add migration-safe provider storage and model foreign keys`

### Task 3: Define the neutral adapter registry and fake boundary

**Files:** adapter interface, new registry, normalized error, ProviderModule; new `backend/test/helpers/fake-provider.adapter.ts`, `backend/test/unit/provider-adapter.registry.spec.ts`.

**Interfaces:** Produces the following exact protocol-neutral types. The registry accepts strings so tests can register a second fake protocol without advertising it in the admin DTO.

```ts
export interface ProviderConnection { baseUrl: string; apiKey: string }
export interface ProviderChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}
export interface ProviderStreamInput {
  model: string;
  messages: ProviderChatMessage[];
  signal?: AbortSignal;
}
export interface ProviderDelta { delta: string }
export interface ProviderAdapter {
  readonly type: string;
  validate(connection: ProviderConnection, signal?: AbortSignal): Promise<void>;
  stream(connection: ProviderConnection, input: ProviderStreamInput): AsyncIterable<ProviderDelta>;
}
export const PROVIDER_ADAPTERS = Symbol('PROVIDER_ADAPTERS');
```

- [ ] Write a fake with independent calls and deferred failure:

```ts
export class FakeProviderAdapter implements ProviderAdapter {
  readonly calls: Array<{ connection: ProviderConnection; input: ProviderStreamInput }> = [];
  constructor(readonly type = 'fake', private readonly failure?: Error) {}
  async validate(): Promise<void> { if (this.failure) throw this.failure; }
  async *stream(connection: ProviderConnection, input: ProviderStreamInput) {
    this.calls.push({ connection, input });
    yield { delta: 'Hello' };
    if (this.failure) throw this.failure;
    yield { delta: ' world' };
  }
}
```

- [ ] Test registry resolution, unsupported type and duplicate registration:

```ts
const first = new FakeProviderAdapter('first');
const second = new FakeProviderAdapter('second');
const registry = new ProviderAdapterRegistry([first, second]);
expect(registry.resolve('second')).toBe(second);
expect(() => registry.resolve('missing')).toThrow(NormalizedProviderError);
expect(() => new ProviderAdapterRegistry([first, first])).toThrow();
```

- [ ] Run `npm test -- --runInBand test/unit/provider-adapter.registry.spec.ts`.
- [ ] Implement registry as an injectable map with `@Inject(PROVIDER_ADAPTERS)` on its array constructor argument. Reject duplicates at startup. Register the real array with `useFactory: (adapter: OpenAICompatibleAdapter) => [adapter]`, `inject: [OpenAICompatibleAdapter]`. Export the registry/runtime as required, not the error class.
- [ ] Define `NormalizedProviderError(code)` with safe fixed message/status mappings. Codes: `provider_not_found` 404; `provider_inactive`, `provider_type_unsupported`, `provider_credential_corrupt`, `credentials_rejected`, `provider_request_invalid`, `provider_validation_unsupported` 422; `provider_rate_limited`, `provider_unreachable` 503; `provider_timeout` 504; `provider_error` 502. Do not carry plaintext upstream errors in public fields.
- [ ] Run registry tests and a Nest TestingModule compilation test resolving ProviderModule using repository overrides. This catches DI/export faults that direct constructors miss.

**Suggested commit message:** `refactor(provider): introduce neutral adapter contract and injectable registry`

### Task 4: Implement bounded protocol translation and runtime dispatch

**Files:** compatible adapter, new runtime and URL-policy modules; new `backend/test/unit/{openai-compatible.adapter,provider-runtime.service,provider-url-policy}.spec.ts`.

**Interfaces:** Runtime constructor consumes provider Repository, registry and URL policy. Produces `assertReady(providerId: string): Promise<void>` and `stream(providerId: string, input: ProviderStreamInput): AsyncIterable<ProviderDelta>`. `assertReady` checks configuration only, never a network probe. Configuration is loaded again at generation start so new requests see updates.

- [ ] Write adapter tests mocking the existing SDK and fetch: normal chunks, empty content, initial rejection, iterator rejection after a delta, 401/403, 400/404, 429, 5xx, timeout, network reset and unsupported validation. Assert no raw body/key in errors. Example iterator-failure assertion:

```ts
async function* brokenUpstream() {
  yield { choices: [{ delta: { content: 'partial' } }] };
  throw Object.assign(new Error('unsafe upstream text'), { status: 429 });
}
const iterator = brokenUpstream();
const normalized = adapterStreamFromMock(iterator);
expect(await normalized.next()).toEqual({ value: { delta: 'partial' }, done: false });
await expect(normalized.next()).rejects.toMatchObject({ code: 'provider_rate_limited' });
```

Define `adapterStreamFromMock` in the test: configure `jest.mock('openai')`'s `chat.completions.create` to resolve the supplied iterable, instantiate `OpenAICompatibleAdapter`, and return `.stream({baseUrl:'https://provider.example/v1',apiKey:'fake-test-key'}, {model:'model-a',messages:[]})[Symbol.asyncIterator]()`. No request is sent.

- [ ] Run the three focused suites with `npm test -- --runInBand test/unit/openai-compatible.adapter.spec.ts test/unit/provider-runtime.service.spec.ts test/unit/provider-url-policy.spec.ts`.
- [ ] Implement adapter `async *stream`: construct SDK with `maxRetries: 0`, bounded request timeout, wrap both stream acquisition and `for await` inside one try/catch; yield only nonempty text deltas. Translate SDK statuses into the fixed code table. Close upstream iterator on termination and release timers. Use a configurable generation wall-clock deadline (default 120 seconds) in addition to request/connect timeout (default 15 seconds); normalize abort caused by deadline as timeout. No automatic retry/fallback.
- [ ] Implement validation with `AbortController`, 5-second timeout and `redirect: 'error'`; always clear the timer. Use `/models`, treat 404/405 as unsupported, and never send a fabricated chat model probe.
- [ ] Implement URL policy from design decision 8; tests reject non-HTTP schemes, embedded credentials, disallowed hosts/ports, query/fragment and unauthorized local HTTP. Document `PROVIDER_ALLOWED_HOSTS`, `PROVIDER_ALLOW_LOCAL_HTTP`, and timeout defaults in backend environment documentation without real secrets. Production startup fails clearly if required endpoint policy is missing.
- [ ] Implement runtime: find provider; check active; resolve adapter; check endpoint policy; decrypt inside the protected error boundary; dispatch. Catch unknown failures during both acquisition and iteration and replace with `provider_error`; known safe errors retain their codes. Never expose a raw credential from CRUD endpoints. No SDK import or protocol switch reaches ChatService.
- [ ] Prove routing with two providers and two fake adapter types: each receives its own URL/key and selected actualName; deactivate one and assert neither its stream nor the other adapter is invoked. Test corrupt ciphertext as `provider_credential_corrupt`.
- [ ] Run focused tests and build. Verify timeouts with fake timers or abortable fakes rather than waiting for real deadlines.

**Suggested commit message:** `feat(provider): dispatch streams with bounded adapters and safe failures`

### Task 5: Finish admin provider CRUD and normalized HTTP errors

**Files:** provider service/controller/DTO/module, exception filter; repair existing provider tests under `backend/test/unit/provider.service.spec.ts`; update `backend/test/integration/provider.e2e.spec.ts`.

**Interfaces:** Implements the contract table and public types. CRUD does not invoke a remote provider; explicit validation does. `ProviderService.list({page,pageSize})` returns ProviderPage; `read`, `create`, `update`, `validateProvider` return ProviderPublic; `delete(id)` returns void.

- [ ] Repair the current test fixture using `getRepositoryToken(Provider)` and actual registry token overrides. Supply `create`, `save`, `findOne`, `findAndCount`, `delete`, and query builder behavior used by the service. Remove undefined `mockAdapter` references. Consolidate the misplaced untracked test only after reading both destination and source; preserve unique test cases.
- [ ] Add failing tests: blank/whitespace name, null PATCH fields, string isActive, duplicate ID/name, unchanged key, replacement key, inactive provider, delete with models, corrupt key, safe output and separate validation. Core assertions:

```ts
const saved = await service.update('primary', { name: 'Renamed' });
expect(saved.hasApiKey).toBe(true);
expect(saved).not.toHaveProperty('apiKey');
expect(saved).not.toHaveProperty('apiKeyEncrypted');
expect(adapter.validate).not.toHaveBeenCalled();
await expect(service.delete('referenced')).rejects.toMatchObject({
  response: expect.objectContaining({ code: 'provider_in_use' }),
});
```

The fixture seeds both provider rows, configures a model reference for `referenced`, and spies on the registry-returned adapter, not an unrelated class mock.

- [ ] Run `npm test -- --runInBand test/unit/provider.service.spec.ts test/integration/provider.e2e.spec.ts`.
- [ ] Implement DTOs matching the baseline. Explicitly bind create/patch fields; do not allow ID/type mutation through patch. Trim names/URL, never silently trim an API key. CRUD response uses a projection, not entity serialization or decrypt-to-mask.
- [ ] Translate unique database violations into 409 for SQLite and PostgreSQL. Check references for friendly delete errors and retain FK protection for concurrent model creation. Translate the FK race into `provider_in_use`, not a 500.
- [ ] Clear `lastValidatedAt` on URL/key change; set it only after successful explicit validation. Use an optimistic conditional update keyed by previous `updatedAt` so an old in-flight check cannot mark newly changed credentials valid; return current projection if stale, with timestamp still unset.
- [ ] Add safe normalized-provider handling at the start of filter translation; do not use raw upstream strings in logs. Keep requestId behavior. SSE errors are handled in Task 7, not by attempting JSON writes after headers were sent.
- [ ] Update integration fixture to use temporary SQLite, strict app validation, real JWT/roles, seeded admin/user and the local fake endpoint. Assert 401 without token and 403 for user across provider routes; 201 plus Location, paginated 200, PATCH omission, 204 empty delete, conflicts and sanitized errors. No dependence on a developer's `.env` or app.sqlite.
- [ ] Run focused suites and contract tests. Assert a failed connection check leaves an application that still answers subsequent list requests.

**Suggested commit message:** `feat(provider): complete guarded provider management and safe validation`

### Task 6: Bind model CRUD and activation to configured providers

**Files:** model DTO/service/admin controller/entity/module; existing model integration suite; new `backend/test/unit/models.provider.spec.ts`. Check app-config default assignment code as a dependency before changing its invariants.

**Interfaces:** Uses CreateModelInput/UpdateModelInput above; admin shape includes providerId. Public model shape stays `{id,displayName,isDefault}`. `resolveActiveModel` retains existing selection precedence; runtime independently rejects unavailable providers.

- [ ] Write failing API tests for required providerId, valid slug, nonexistent provider, explicit null, inactive provider with enabled=true, disabled model against inactive provider, reassignment and readback. Example using the suite's existing app/admin token fixture:

```ts
await request(app.getHttpServer()).post('/v1/admin/models')
  .set('Authorization', `Bearer ${adminToken}`)
  .send({ displayName: 'Example', actualName: 'upstream-a', providerId: 'missing' })
  .expect(422);
const created = await request(app.getHttpServer()).post('/v1/admin/models')
  .set('Authorization', `Bearer ${adminToken}`)
  .send({ displayName: 'Example', actualName: 'upstream-a', providerId: 'primary' })
  .expect(201);
expect(created.body.providerId).toBe('primary');
```

Seed `primary` through the provider repository in beforeEach with encrypted synthetic credentials; isolate model names between tests.

- [ ] Run `npm test -- --runInBand test/unit/models.provider.spec.ts test/integration/models.admin.crud.e2e.spec.ts`.
- [ ] Separate create and patch validation semantics (new create DTO is acceptable); require providerId only on create and forbid null in both. Forward it through controller/service/public admin mapper. Do not apply UUID validation to a provider slug.
- [ ] Resolve the final provider and final enabled state before save. Reject missing providers; reject final enabled=true with inactive provider. Enforce this for create, reassignment and re-enabling, not only one route. Use FK/race exception handling for concurrent provider deletion.
- [ ] Preserve model uniqueness, timestamps, pagination and deletion migration. Clear both default representations in one transaction on disabling the default. Validate target models in existing default assignment and model-deletion migration paths; never choose a replacement provider automatically.
- [ ] Add regressions for current default/sticky selection order, provider deactivation blocking new generation without changing records, and no cross-provider retry on failure. Disabled model behavior remains the existing model resolver behavior; no new selection algorithm.
- [ ] Run the focused model suites and all existing app-config/default tests. Confirm providerId is admin-only metadata, with no credential fields on model relations serialized to clients.

**Suggested commit message:** `feat(models): require provider associations and enforce activation rules`

### Task 7: Integrate adapters without losing stream lifecycle behavior

**Files:** chat service/module; new `backend/test/integration/chat.providers.e2e.spec.ts`; update existing chat unit/integration fakes that formerly replaced OpenAICompatibleClient.

**Interfaces:** Chat consumes only `ProviderRuntimeService.assertReady`/`stream` and ProviderChatMessage/ProviderDelta. Externally preserve data delta `{data:{delta}}`, done `{event:'done',data:{}}`, error `{event:'error',data:{code,message}}`.

- [ ] Add a fake runtime stream test that creates one assistant message, emits two deltas, writes final completion once and emits done exactly once. Assert actualName/providerId dispatch and prior-turn ordering. Include a regression asserting the current user message appears exactly once; preserve conversation persistence semantics rather than freezing an accidental duplicate payload.
- [ ] Add failure cases: before stream, after partial text, unsupported adapter, disabled provider, corrupt key, no model, and persistence update rejection. A failed response retains partial text and failed status when the persistence layer is available; persistence failure produces a terminal safe error and cleans active state, never an unhandled rejection.
- [ ] Run `npm test -- --runInBand test/integration/chat.providers.e2e.spec.ts` plus existing chat suites.
- [ ] Replace OpenAICompatibleClient injection with ProviderRuntimeService and import ProviderModule. Remove SDK types, chunk `choices` parsing, and singleton readiness assumptions. Readiness check is local; invoke no validation probe per message. Consumption becomes:

```ts
const stream = this.providerRuntime.stream(model.providerId, {
  model: model.actualName,
  messages: providerMessages,
});
for await (const { delta } of stream) {
  fullResponse += delta;
  state.fullResponse += delta;
  for (const sub of state.subscribers) sub({ data: { delta } });
}
```

Keep the existing stream-state setup around this loop; change providerStream to `AsyncIterable<ProviderDelta>`. Do not replace the whole service with the snippet.

- [ ] Map NormalizedProviderError to one SSE error; unknown errors use fixed internal/provider messages. Guard terminal emission so outer catches cannot send a second terminal event. Always remove active state and complete observers, including when final persistence throws. Log safe codes plus correlation IDs, not raw SDK errors.
- [ ] Preserve generation continuing after browser unsubscribe and reconnection behavior; test subscriber disconnect does not abort the upstream call. Existing explicit cancellation must stop further deltas/final completed writes; check active generation identity during iteration and close the iterator on explicit cancellation, not on browser disconnect.
- [ ] Test second fake protocol registration using the same ChatService instance/class. Assert no SDK calls or conditional provider-type logic in ChatService. Remove old client wiring only after checking its callers and adapting all affected tests; keep unrelated code unchanged.
- [ ] Run focused and existing conversation streaming suites. Verify a failure followed by another successful request without restarting the app.

**Suggested commit message:** `refactor(chat): invoke configured models through provider runtime`

### Task 8: Add frontend provider API and management forms

**Owner:** frontend-scoped implementer; no backend edits.

**Files:** frontend API/types, ProviderForm and ProviderView; new API/component tests listed above.

**Interfaces:** `listProviders(query?: {page?:number;pageSize?:number}): Promise<ProviderPage>`, `getProvider(id:string)`, `createProvider(input:ProviderCreateInput)`, `updateProvider(id:string,input:ProviderUpdateInput)`, `deleteProvider(id:string):Promise<void>`, `validateProvider(id:string)`. Read/create/update/validate return ProviderPublic; ProviderPage is `{items:ProviderPublic[];total:number;page:number;pageSize:number}`.

- [ ] Write wrapper tests mocking `@/api/http` using the existing `tests/api/chat.spec.ts` pattern. Verify encoded IDs, methods, query values and omission of unchanged keys. Remove use of the old one-argument updateProvider wrapper; do not overload singleton and collection signatures.
- [ ] Write a form test using Vue Test Utils:

```ts
const wrapper = mount(ProviderForm, {
  props: { provider: {
    id: 'primary', name: 'Primary', type: 'openai-compatible',
    baseUrl: 'https://provider.example/v1', hasApiKey: true,
    isActive: true, lastValidatedAt: null,
    createdAt: '2026-09-17T00:00:00Z', updatedAt: '2026-09-17T00:00:00Z',
  } },
});
await wrapper.get('[name="name"]').setValue('Renamed');
await wrapper.get('form').trigger('submit');
await flushPromises();
expect(updateProvider).toHaveBeenCalledWith('primary', expect.not.objectContaining({ apiKey: expect.anything() }));
```

Use `vi.mock('@/api/admin')` to provide `updateProvider` resolving a ProviderPublic response. The named inputs are part of this task's form contract.

- [ ] Run from frontend/app: `npm test -- tests/api/admin.providers.spec.ts tests/components/ProviderForm.spec.ts tests/components/ProviderView.spec.ts`.
- [ ] Implement wrapper functions using the existing request helper and URL/query builder idiom. Add matching request/response types. Preserve unrelated auth, model and default-model wrappers.
- [ ] Keep ProviderForm focused: props `{provider: ProviderPublic|null}`; `saved` event after success; blank creation form includes ID/name/type/URL/key/active; edit locks ID/type and does not prefill key. Validate required fields and lengths locally; render safe server failures in an inline `role="alert"`, focus the first invalid input, clear key on success/close. Do not persist credentials in stores or localStorage.
- [ ] Implement ProviderView list with loading, empty, error/retry, pagination and selected create/edit form. Columns: name, protocol, endpoint, Active/Inactive text, last validated or Not validated. Add explicit Validate, edit, deactivate/reactivate, and delete actions. Require confirmation for delete, explain 409 references, prevent duplicate submissions while pending, and reload only after success.
- [ ] Show “Configuration saved. Validate the connection to check access.” A failed validate action must not imply saving failed. Disable row actions while that row is pending. Support keyboard navigation, labels, visible focus, responsive horizontal scrolling and non-color status indicators using existing design primitives.
- [ ] Test creation, unchanged/replaced key, errors, validation timestamps, deactivation, delete cancellation/conflict and repeated-click protection. Run focused tests and `npm run build`.

**Suggested commit message:** `feat(admin): manage provider configurations with explicit validation`

### Task 9: Add provider assignment to the actual model modal

**Owner:** frontend-scoped implementer.

**Files:** `ModelFormModal.vue`, `ModelsView.vue`, API/types; new `tests/components/ModelFormModal.spec.ts`.

**Interfaces:** ModelAdmin adds required `providerId: string`. Model create wrapper requires `Pick<ModelUpsertRequest,'displayName'|'actualName'|'providerId'>`; patch remains optional and never null. Existing modal props `{open,model}` and events `update:open`/`saved` remain compatible.

- [ ] Write failing modal test with mocked provider pages and createModel/updateModel wrappers:

```ts
await wrapper.get('[name="providerId"]').setValue('secondary');
await wrapper.get('[name="displayName"]').setValue('Example');
await wrapper.get('[name="actualName"]').setValue('upstream-model');
await wrapper.get('form').trigger('submit');
await flushPromises();
expect(createModel).toHaveBeenCalledWith(expect.objectContaining({
  providerId: 'secondary', actualName: 'upstream-model',
}));
```

Mount the modal with `{open:true,model:null}`; mock `listProviders` to return two named configured providers, and stub existing dialog primitives as the project's component tests require. Include a second page fixture to prevent first-page-only options.

- [ ] Run `npm test -- tests/components/ModelFormModal.spec.ts`.
- [ ] Fetch provider pages when opening the form until all are loaded, stopping on empty page/error and using a request generation counter to ignore stale responses after closing. Provide no blank-valid or null assignment. If no providers exist, disable submission and display a link to the existing provider admin route.
- [ ] Display inactive providers with explicit text and allow them only when enabled=false; preserve visibility of an edited model's existing inactive provider. Client validation complements server validation; a race returns the server's safe error without closing/resetting the form.
- [ ] Send providerId on create and the selected value on edit. On save, keep existing list refresh behavior. Add provider labels to ModelsView with ID fallback if a record cannot be loaded; do not expose secret metadata or silently change the user's selected provider after fetch errors.
- [ ] Test loading/error/empty states, disabled-provider rule, edit preselection, reassignment, close/reopen stale response, no invalid submit, and provider deactivation between open and save. Re-run existing toggle/default/delete migration UI cases; preserve both model-delete success shapes.
- [ ] Run focused tests, full frontend `npm test`, and `npm run build`. Do not invent an `npm run lint` command: frontend currently has no lint script.

**Suggested commit message:** `feat(admin): assign providers when creating and editing models`

### Task 10: Verify acceptance and document coordinated rollout

**Files:** feature-002 `quickstart.md`/`tasks.md`, canonical API contract, existing backend API notes. Change application files only to address a verified failure under the owning task.

**Interfaces:** Consumes all prior deliverables; produces reproducible acceptance evidence and operator rollout steps, not claims based only on source presence.

- [ ] Run from backend, separately recording each exit status:

```text
npm test -- --runInBand
npm run lint
npx tsc --noEmit
npm run build
npm run openapi:export
```

The existing `test:e2e` script references an absent config; use the main Jest configuration for `.e2e.spec.ts` files. Do not run lint's auto-fix mode across unrelated edits without reviewing its script first. If lint is auto-fixing, run its equivalent read-only command for initial verification.

- [ ] Run from frontend/app: `npm test`, then `npm run build`. Record baseline unrelated failures separately; don't mark completion while required gates remain failing.
- [ ] Run the application with a loopback fake provider using isolated test configuration. As admin, create two providers, create/edit/reassign models, deactivate/reactivate each, test validation failure, and test referenced-provider delete conflict. As user, verify existing chat works through each association without new selector UI.
- [ ] Simulate fake provider failures before output and after one delta; verify sanitized error, preserved partial failure state, no unhandled promise rejection, and a successful subsequent request. Verify browser disconnect still allows persistence; explicit cancel prevents later completion overwrite.
- [ ] Verify every acceptance criterion with the matrix below. Do not count registering two configurations of one protocol as proof of protocol independence; run the second fake adapter test.
- [ ] Document rollout: back up database and encryption key separately and securely; verify legacy provider exists for populated models; announce breaking admin client changes; stop new requests and drain current streams; deploy migrations/backend/frontend in one maintenance window; smoke test; resume traffic. Keep old singleton table for history. Rollback uses pre-release database backup and old application pair after stopping writes, not a lossy automatic down migration.
- [ ] Document external PostgreSQL migration run separately. If not executed, explicitly state “PostgreSQL migration verification pending”; do not label cross-database support verified.
- [ ] Update feature tasks only for actually passing deliverables. Offer the human suggested commits; do not stage or commit.

| Acceptance criterion | Required evidence |
|---|---|
| Admin manages providers/models | Real guarded integration tests + Vue form tests + operator smoke flow |
| Every model references configured provider | Required DTO, FK/RESTRICT migration tests, readback and deletion-race tests |
| Chat invokes adapters, not provider protocol | Fake runtime routing test; no SDK dependency in ChatService |
| Another provider does not require chat rewrite | Registry with second fake protocol and unchanged orchestration |
| Errors normalized/application survives | Startup/mid-stream failure tests, safe HTTP/SSE errors, next request succeeds |
| Active/inactive states work | CRUD/eligibility tests + admin form status/error tests |
| Existing behavior preserved | Default/deletion-migration and persistence/disconnect/cancel regression suites |

**Suggested commit message:** `test(provider): verify Phase 1 acceptance and coordinated rollout`

## Self-review of this revision

- Scope coverage: backend storage/CRUD Tasks 2/5; catalog/activation Task 6; interface/implementation/errors Tasks 3–5/7; fake unit/integration tests Tasks 2–7/10; provider UI Task 8; model UI Task 9; all acceptance checks Task 10.
- The draft's null provider option, UUID/slug mismatch, implicit adapter-array injection, OpenAI chunks in the shared interface, per-chat validation probe, wrong migration path and manual-only frontend verification have been replaced with explicit decisions and test steps.
- Type consistency: one ProviderAdapter contract, one registry token, one runtime signature, provider slug IDs everywhere, `enabled` for models and `isActive` for providers, `hasApiKey` on all new provider responses.
- Contract decisions are proposed and require operator review before execution, particularly the breaking coordinated release and migration precondition. This document is a plan, not an executed contract migration.
- Existing source is not marked complete simply because files exist. Tests/builds remain unrun for this planning-only change.

## Documentation references

- NestJS custom providers: https://docs.nestjs.com/fundamentals/custom-providers — consulted through Context7 for symbol tokens, useFactory/inject and module exports.
- Project constitution: `backend/.specify/memory/constitution.md`.
- Existing MVP regression spec: `backend/specs/001-multi-model-chatbot-mvp/spec.md`.
- Existing canonical API: `backend/specs/001-multi-model-chatbot-mvp/contracts/openapi-3.1.yaml`.

## Execution handoff

Plan only: no application changes, tests, migrations or commits have been performed. Review the design decisions and coordinated-release assumption before execution.

1. **Subagent-Driven (recommended):** fresh package-scoped agent per task, review between tasks, using `superpowers:subagent-driven-development`. Disable automatic git/worktree behavior to honor project governance.
2. **Inline Execution:** use `superpowers:executing-plans` with task checkpoints, preserving package boundaries and no-git rules.

Which approach should execute the approved plan?
