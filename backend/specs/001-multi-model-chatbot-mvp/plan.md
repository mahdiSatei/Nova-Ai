# Implementation Plan: Multi-Model Chatbot Platform (MVP)

**Branch**: `[001-multi-model-chatbot-mvp]` | **Date**: 2026-09-13 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-multi-model-chatbot-mvp/spec.md`
plus operator-supplied stack decisions: NestJS (mandatory), TypeORM (mandatory),
JWT for authentication, file-based structured logs, SQLite for the MVP with
PostgreSQL as the production target.

## Summary

Build the backend portion of the multi-model chatbot MVP. The backend is a
NestJS application exposing a REST + JSON + Server-Sent-Events streaming API
for end users and a separate admin API for managing the central provider,
models, and the default model. Data is persisted via TypeORM. For the MVP the
database is SQLite; PostgreSQL is wired in via the same TypeORM entities so a
later swap is configuration-only. JWT (signed access tokens + refresh tokens)
authenticates both user and admin sessions. Structured logs are written to
rotating files under `backend/logs/`. OpenAI-compatible `/chat/completions`
streaming is the only provider protocol in MVP.

This plan covers phases 0 (research) and 1 (design artifacts) only. Task
decomposition is the responsibility of `/speckit-tasks`; implementation is
the responsibility of `/speckit-implement`.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 20 LTS.

**Primary Dependencies**:
- Runtime: `@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express`,
  `@nestjs/config`, `@nestjs/jwt`, `@nestjs/passport`, `@nestjs/typeorm`,
  `@nestjs/event-emitter`
- ORM: `typeorm`, `sqlite3` (MVP), `pg` (production driver, installed but not
  wired in MVP)
- Auth: `passport`, `passport-jwt`, `bcrypt`
- Provider client: `openai` npm package (its SDK speaks OpenAI-compatible
  endpoints, so a custom base_url is sufficient)
- Validation: `class-validator`, `class-transformer`
- Logging: `nestjs-pino` + `pino-roll` for daily-rotating files
- Streaming: native NestJS SSE support (manual SSE handler via `@Sse()`
  decorator — no extra dependency)
- Dev: `typescript`, `ts-node`, `@types/node`, `@nestjs/cli`,
  `@nestjs/testing`, `jest`, `ts-jest`, `supertest`, `eslint`, `prettier`

**Storage**:
- MVP: SQLite via TypeORM, file at `backend/data/app.sqlite`
- Production target: PostgreSQL via TypeORM (same entities, different datasource)

**Testing**: Jest + Supertest. Unit tests for services; integration tests for
controllers via `@nestjs/testing`; contract tests for the OpenAI-compatible
provider using a recorded-fixture stub.

**Target Platform**: Linux server (Node.js 20 LTS runtime). Container-friendly
(no native modules beyond `sqlite3` and `bcrypt`, both have prebuilt binaries).

**Project Type**: web-service (REST API + SSE; no frontend in this repo).

**Performance Goals**:
- P95 token arrival latency: < 1 second (SC-002)
- Concurrent active streaming sessions: ≥ 100 without degradation (SC-003)
- P95 request latency for non-streaming endpoints: < 250 ms at the same load

**Constraints**:
- All source MUST live under `backend/` (constitution Principle I)
- All persistent configuration loaded from env or `.env` (constitution)
- Database access only via TypeORM repositories (no raw SQL in handlers)
- Logs MUST be structured (constitution)
- Errors exposed to clients MUST be sanitized (constitution)
- No git operations by agents (constitution Principle II) — append suggested
  commit messages only

**Scale/Scope**:
- MVP: single-process deployment, single SQLite file, 1 admin + small user base
- No horizontal scaling, no clustering, no queue workers in MVP

## Technical Choices (per Constitution Principle V)

Stack selection rationale, recorded here so subsequent amendments preserve
stack consistency:

- **NestJS** as the framework: opinionated structure (modules, controllers,
  providers, guards) gives clear seams for the constitution's required
  cross-cutting concerns (auth guards, validation pipes, structured logging
  interceptor, sanitized exception filter). Maps directly onto the spec's
  user/admin separation and the JWT guard requirement.
- **TypeORM** as the ORM (mandatory per operator): decorator-based entities
  match the entity model in spec §Key Entities, and TypeORM's `DataSource`
  abstraction lets the same entities target SQLite (MVP) and PostgreSQL
  (production) without entity changes.
- **JWT** over session cookies: stateless, no server-side session store, and
  the spec requires server-side invalidation only on logout / role change /
  default changes (token revocation list sized small enough to live in memory
  for MVP).
- **File-based structured logs**: `nestjs-pino` produces JSON lines, written
  via `pino-roll` to `backend/logs/app-YYYY-MM-DD.log` with size + age-based
  rotation. Satisfies the constitution's "logs MUST be structured" rule and
  the operator's "logs in log file" requirement.
- **OpenAI SDK as the provider client**: the `openai` npm package targets
  OpenAI-shaped endpoints and accepts a custom `baseURL`, so it works against
  any OpenAI-compatible host. No vendor-specific client libraries are
  introduced.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence / Mitigation |
|---|---|---|
| I. Monorepo Backend Isolation | **PASS** | All code, config, and docs live under `backend/`. |
| II. Agent Workflow Constraints | **PASS** | This plan is documentation only; no git ops performed. |
| III. API-First Design | **PASS** | REST + JSON is the default; OpenAPI emitted from NestJS via `@nestjs/swagger` and committed to `contracts/openapi.yaml`. Contracts versioned at `v1`. SSE used for streaming with the contract documented in the OpenAPI extensions. |
| IV. Test-Alongside Quality | **PASS** | Jest + Supertest wired in `package.json`. Each task in the future `tasks.md` that adds a behavior MUST include a test in the same change set. |
| V. Language & Stack Agnosticism | **PASS** | Stack selected here is recorded under "Technical Choices" with rationale, satisfying the principle's per-feature selection rule. No conflict — the constitution permits the operator to choose. |

### Cross-cutting rule checks (from constitution sections)

| Rule | Status | Evidence |
|---|---|---|
| Source under `backend/` | **PASS** | NestJS project rooted at `backend/`. |
| Config from env / `.env` | **PASS** | `@nestjs/config` with validation; `.env` listed in `backend/.gitignore`. |
| API contracts machine-readable, versioned | **PASS** | OpenAPI YAML under `backend/contracts/openapi.yaml`, prefixed `/v1`. |
| Data access via dedicated layer | **PASS** | TypeORM repositories; no query-builder usage in controllers. |
| Structured logs | **PASS** | `nestjs-pino` JSON output, written via `pino-roll`. |
| Sanitized client errors | **PASS** | Global `AllExceptionsFilter` translates internal errors to sanitized envelopes. |
| Auth declared in spec for every protected endpoint | **PASS** | Plan §Architecture documents each controller's auth requirement. |
| Secrets from env, never hard-coded | **PASS** | Provider API key encrypted at rest (AES-256-GCM with key from env). |
| Input validated at boundary | **PASS** | `class-validator` + `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`. |
| Dependency review for known vulns | **PASS (process)** | npm audit run in CI; no critical vulns permitted. |

No unjustified violations. Constitution Check passes both pre- and post-design.

## Project Structure

### Documentation (this feature)

```text
specs/001-multi-model-chatbot-mvp/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── openapi.yaml
├── checklists/          # /speckit-checklist outputs
└── tasks.md             # /speckit-tasks output (NOT generated here)
```

### Source Code (repository root)

The current working directory is already `backend/`. The NestJS project is
rooted here so that `backend/package.json` is the project manifest.

```text
backend/
├── src/
│   ├── main.ts                          # Bootstrap; OpenAPI generation hook
│   ├── app.module.ts                    # Root module
│   ├── config/
│   │   ├── configuration.ts             # Typed config schema
│   │   └── env.validation.ts            # class-validator on env
│   ├── common/
│   │   ├── filters/all-exceptions.filter.ts
│   │   ├── interceptors/logging.interceptor.ts
│   │   ├── pipes/                       # Custom pipes (e.g., parse-uuid)
│   │   ├── decorators/                  # @CurrentUser, @Roles, @Public
│   │   └── guards/
│   │       ├── jwt-auth.guard.ts
│   │       └── roles.guard.ts
│   ├── database/
│   │   ├── data-source.ts               # TypeORM DataSource (SQLite MVP)
│   │   └── migrations/                  # TypeORM migrations
│   └── modules/
│       ├── auth/
│       │   ├── auth.module.ts
│       │   ├── auth.controller.ts       # /v1/auth/...
│       │   ├── auth.service.ts
│       │   ├── strategies/jwt.strategy.ts
│       │   └── dto/
│       ├── users/
│       │   ├── users.module.ts
│       │   ├── users.service.ts
│       │   └── entities/user.entity.ts
│       ├── chat/
│       │   ├── chat.module.ts
│       │   ├── chat.controller.ts       # /v1/chat/stream (SSE)
│       │   ├── chat.service.ts          # Streams from provider
│       │   └── provider/
│       │       ├── openai-compatible.client.ts
│       │       └── provider.config.service.ts
│       ├── conversations/
│       │   ├── conversations.module.ts
│       │   ├── conversations.controller.ts
│       │   ├── conversations.service.ts
│       │   └── entities/
│       │       ├── conversation.entity.ts
│       │       └── message.entity.ts
│       ├── models/
│       │   ├── models.module.ts
│       │   ├── models.controller.ts     # Admin: /v1/admin/models
│       │   ├── models.service.ts
│       │   ├── models.public.controller.ts # Users: /v1/models
│       │   └── entities/model.entity.ts
│       ├── provider/
│       │   ├── provider.module.ts
│       │   ├── provider.controller.ts   # Admin: /v1/admin/provider
│       │   ├── provider.service.ts
│       │   └── entities/central-provider.entity.ts
│       ├── app-config/
│       │   ├── app-config.module.ts
│       │   ├── app-config.controller.ts # Admin: /v1/admin/config
│       │   ├── app-config.service.ts
│       │   └── entities/app-config.entity.ts
│       └── health/
│           ├── health.module.ts
│           └── health.controller.ts     # /healthz, /readyz
├── test/
│   ├── unit/
│   ├── integration/
│   └── fixtures/                        # Recorded OpenAI-shaped responses
├── contracts/
│   └── openapi.yaml                     # Generated / hand-augmented
├── logs/                                # Rotating daily logs (gitignored)
├── data/                                # SQLite file (gitignored)
├── .env.example                         # Committed
├── .gitignore                           # Excludes .env, logs/, data/
├── nest-cli.json
├── package.json
├── tsconfig.json
├── tsconfig.build.json
└── jest.config.ts
```

**Structure Decision**: Single NestJS project at the repository root. No
frontend in this repo (frontend will be a separate package in the monorepo,
out of scope for this backend MVP plan). All cross-cutting concerns
(filtering, logging, auth, validation) live under `src/common/`.

## Module Boundaries

| Module | Routes | Auth | Purpose |
|---|---|---|---|
| `auth` | `POST /v1/auth/register`, `POST /v1/auth/login`, `POST /v1/auth/refresh`, `POST /v1/auth/logout` | public (register/login/refresh); user or admin (logout) | Identity |
| `users` (internal) | none exposed | n/a | Domain service for the `User` entity; consumed by `auth` and `admin` |
| `models` (public) | `GET /v1/models` | user | List enabled models with display name only |
| `chat` | `POST /v1/chat/stream` | user | SSE streaming chat against the active model |
| `conversations` | `GET /v1/conversations`, `GET /v1/conversations/:id`, `DELETE /v1/conversations/:id` | user | History |
| `models` (admin) | `GET/POST /v1/admin/models`, `PATCH/DELETE /v1/admin/models/:id`, `POST /v1/admin/models/:id/enable`, `POST /v1/admin/models/:id/disable` | admin | Model CRUD + enable/disable |
| `provider` (admin) | `GET /v1/admin/provider`, `PUT /v1/admin/provider` | admin | Central provider configuration |
| `app-config` (admin) | `GET /v1/admin/config`, `PUT /v1/admin/config` | admin | Default model selection |
| `health` | `GET /healthz`, `GET /readyz` | public | Liveness + readiness (readiness probes DB) |

## Auth Flow (MVP)

1. `POST /v1/auth/register` → creates `User` with role `user`, password
   hashed with bcrypt (cost 12). Returns `{ user, accessToken, refreshToken }`.
2. `POST /v1/auth/login` → verifies password, returns tokens. Generic error
   on bad credentials (no email enumeration).
3. `POST /v1/auth/refresh` → exchanges a valid refresh token for a new
   access/refresh pair; the old refresh token is invalidated.
4. `POST /v1/auth/logout` → invalidates the caller's refresh token (writes
   the jti to the in-memory revocation list until expiry).
5. Tokens are signed HS256. Access token TTL: 15 minutes. Refresh token TTL:
   7 days. Secrets come from `JWT_SECRET` and `JWT_REFRESH_SECRET` env
   variables.
6. Admin login uses the same `/v1/auth/login` endpoint with a body field
   confirming admin role on the account; admin sessions carry `role: "admin"`
   in the JWT claims.

## Streaming Flow (SSE)

1. Client opens `POST /v1/chat/stream` with `Authorization: Bearer <jwt>` and
   a JSON body `{ conversationId?, modelId?, message }`.
2. Controller resolves active model: explicit `modelId` → user's sticky
   choice → admin's default model. Refuses to start if no model is
   resolvable and no default is configured (FR-019).
3. Service resolves central provider config. Refuses if not configured
   (FR-016).
4. Service opens a streaming request to the provider's
   `/chat/completions` endpoint with `stream: true`, including the prior
   turns as `messages` (FR-015).
5. The NestJS controller returns an `@Sse()` Observable that yields
   `data:` events as tokens arrive. Each event is `{ "delta": "<text>" }`.
6. On client disconnect, controller's Observable teardown closes the
   provider HTTP stream.
7. On provider error / malformed data, the controller emits a final event
   `{ "error": "<human-readable>" }` and closes (FR-013).

## Provider Client

`src/modules/chat/provider/openai-compatible.client.ts` wraps the `openai`
SDK with the base URL and API key sourced from `CentralProvider`. All calls
go through this single module so swapping providers (post-MVP) is a one-file
change.

## Logging

- `nestjs-pino` configured with `pino-roll` transport
- Outputs JSON lines to `backend/logs/app-YYYY-MM-DD.log` (daily rotation,
  14-day retention)
- Mirrors to stdout in development (no extra config flip needed)
- Each request gets a correlation ID (UUID v4) attached as `req.id` and
  included in every log entry; same ID is returned in the `x-request-id`
  response header

## Configuration

`src/config/configuration.ts` declares the typed config tree:

```ts
{
  port: number,
  jwt: { secret: string, refreshSecret: string, accessTtl: string, refreshTtl: string },
  db: { driver: 'sqlite' | 'postgres', sqliteFile?: string, postgresUrl?: string },
  log: { level: string, dir: string, retentionDays: number },
  provider: { encryptionKeyBase64: string }
}
```

Env vars (validated by `class-validator`):
- `PORT`
- `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`
- `DB_DRIVER` (default `sqlite` for MVP)
- `SQLITE_FILE` (default `backend/data/app.sqlite`)
- `POSTGRES_URL` (used only when `DB_DRIVER=postgres`)
- `LOG_LEVEL` (default `info`)
- `LOG_DIR` (default `backend/logs`)
- `PROVIDER_ENCRYPTION_KEY` (32 random bytes, base64-encoded, used for
  AES-256-GCM encryption of the central provider API key at rest)

## Migration Path to PostgreSQL

Because TypeORM entities are dialect-agnostic, the swap is:

1. `npm install pg`
2. Set `DB_DRIVER=postgres` and `POSTGRES_URL=...`
3. Run `npm run migration:run`

No entity changes are required. JSON columns used for OpenAI request shapes
become `jsonb` on Postgres; SQLite stores them as `text` but TypeORM
serializes/deserializes transparently.

## Out of Scope (MVP)

Reaffirmed from spec §Out of Scope:
- Multi-provider admin features (creating multiple providers)
- Admin management of regular user accounts
- Non-OpenAI-compatible provider protocols (Anthropic-native, etc.)
- Self-service admin provisioning
- Horizontal scaling, queue workers, clustering
- Cross-provider automatic failover
- Bulk export of conversations, retention policies
- Native mobile apps

## Generated Artifacts

| Path | Purpose |
|---|---|
| `specs/001-multi-model-chatbot-mvp/research.md` | Stack / pattern decisions |
| `specs/001-multi-model-chatbot-mvp/data-model.md` | Entities, fields, relationships |
| `specs/001-multi-model-chatbot-mvp/contracts/openapi.yaml` | Public + admin API contract |
| `specs/001-multi-model-chatbot-mvp/quickstart.md` | Runnable validation guide |

## Complexity Tracking

No Constitution violations to justify. The MVP stack selection is recorded
under "Technical Choices" as Principle V explicitly allows.
