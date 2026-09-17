# Research: Multi-Model Chatbot MVP (Phase 0)

**Branch**: `[001-multi-model-chatbot-mvp]` | **Date**: 2026-09-13
**Source spec**: [spec.md](spec.md)

## Purpose

Consolidate the technical decisions and rationale behind the MVP implementation
plan. Every decision below resolves an unknown from the spec's
"Technical Choices" section or from operator input. Each decision records
what was chosen, why, and what alternatives were considered.

---

## Decision: NestJS as the backend framework

**Decision**: Use NestJS 10.x (TypeScript, Node.js 20 LTS).

**Rationale**:
- NestJS's module/controller/provider/guard structure maps directly onto
  the spec's user/admin separation (two route trees under `/v1/...` and
  `/v1/admin/...`) and onto the JWT guard requirement (one global
  `JwtAuthGuard` plus a `RolesGuard`).
- Cross-cutting concerns required by the constitution (sanitized exception
  filter, structured logging interceptor, validation pipe, request
  correlation ID) are first-class in NestJS and don't need bolt-on
  frameworks.
- `@nestjs/swagger` generates an OpenAPI document from controller
  decorators, satisfying the constitution's "API contracts MUST be
  machine-readable" rule with no extra build step.
- The operator explicitly mandated NestJS.

**Alternatives considered**:
- Express + hand-rolled middleware: rejected — would require manually
  reproducing every cross-cutting concern the constitution mandates.
- Fastify: rejected — no operator mandate, and NestJS works on top of
  Fastify anyway for users who want it later (no lock-in here).
- Hono: rejected — operator mandate is NestJS.

---

## Decision: TypeORM as the ORM (SQLite for MVP, PostgreSQL later)

**Decision**: TypeORM 0.3.x. SQLite file at `backend/data/app.sqlite` for the
MVP; PostgreSQL driver installed but not wired in until MVP exits.

**Rationale**:
- Operator mandate: TypeORM is mandatory.
- TypeORM's `DataSource` abstraction accepts the same entity classes for
  SQLite and PostgreSQL, so the production swap is a configuration change,
  not an entity rewrite. This matches the operator's "SQLite for MVP,
  Postgres for production" guidance.
- Decorator-based entities (`@Entity`, `@Column`, `@Relation`) map cleanly
  to the spec's Key Entities (User, Conversation, Message, CentralProvider,
  Model, AppConfig).
- Repository pattern fits the constitution's "Database access MUST go
  through a dedicated data-access layer" rule without any extra
  abstraction.

**Alternatives considered**:
- Prisma: rejected — operator mandate.
- MikroORM: rejected — operator mandate.
- Raw `sqlite3` / `pg` driver: rejected — would violate the constitution's
  dedicated data-access layer rule.

**SQLite-specific notes**:
- Use `synchronize: false` from MVP day one. Migrations are managed via
  TypeORM migrations even on SQLite so the migration history is portable
  to Postgres unchanged.
- Date columns are stored as ISO-8601 strings. TypeORM's `datetime` column
  type works on both drivers.
- `jsonb` from Postgres is emulated by TypeORM's `simple-json` column on
  SQLite; switching to Postgres later bumps that column to `jsonb` via a
  migration.

---

## Decision: JWT-based authentication

**Decision**: HS256-signed access + refresh tokens via `@nestjs/jwt` and
`passport-jwt`. Access TTL 15 minutes; refresh TTL 7 days. Refresh tokens
are tracked in the DB so they can be revoked on logout.

**Rationale**:
- Operator mandate: JWT tokens for authentication.
- Stateless access tokens + DB-tracked refresh tokens give us the
  "stateless by default, revocable when needed" balance the spec requires
  (revoke on logout, on default-model changes affecting the user, on
  admin disable of the user account — for MVP only logout revocation is
  required, the rest are out-of-scope admin features but the data model
  is in place to support them later).
- HS256 is sufficient for the MVP because verification only happens inside
  this single backend service. RS256 would be required if a separate
  verification service existed; not the case here.

**Alternatives considered**:
- Sessions + cookies: rejected — operator mandate is JWT.
- RS256 with key rotation: deferred to post-MVP; would be added when a
  second service needs to verify tokens.
- Opaque tokens + introspection: rejected — operator mandate is JWT
  (implies self-contained tokens).

---

## Decision: Server-Sent Events for chat streaming

**Decision**: Use NestJS's native `@Sse()` decorator with a RxJS
`Observable<MessageEvent>` for the chat stream. Transport is text/event-stream
(SSE).

**Rationale**:
- SSE is the simplest way to push text tokens over HTTP from a Node.js
  server to a browser. It auto-reconnects, works with HTTP/1.1, and is
  well-supported in modern browsers.
- NestJS's `@Sse()` decorator handles the lifecycle cleanly: the Observable
  is subscribed when the client connects and unsubscribed when the client
  disconnects, which gives us the clean termination the spec requires
  (FR-013) for free.
- WebSocket would be overkill: there's no need for client→server
  messages on the same connection; the client posts the message via
  a separate HTTP request and the server returns the SSE stream.

**Alternatives considered**:
- WebSocket: rejected — bidirectional channel is unnecessary; SSE matches
  the spec's "stream the model's response back" semantics.
- HTTP chunked transfer (no SSE framing): rejected — chunked works but
  doesn't auto-reconnect, has no event IDs, and is harder to test.

---

## Decision: `openai` SDK as the provider client

**Decision**: Use the `openai` npm package with a custom `baseURL` and
`apiKey`. The SDK speaks OpenAI's Chat Completions API and accepts an
arbitrary base URL, so it works against any OpenAI-compatible host.

**Rationale**:
- The spec mandates OpenAI-compatible providers (spec §Assumptions).
- The `openai` SDK is the de-facto Node.js client for that protocol and
  handles streaming, retries, and error parsing internally.
- Avoids hand-rolling HTTP fetch + NDJSON parsing + reconnect logic.

**Alternatives considered**:
- Hand-rolled `fetch` + stream parsing: rejected — unnecessary code given
  the SDK already exists.
- Vendor-specific SDKs (Anthropic, Google, etc.): rejected — out of scope
  per spec.

---

## Decision: `nestjs-pino` + `pino-roll` for file-based structured logging

**Decision**: `nestjs-pino` for the NestJS logger integration; `pino-roll`
transport to write JSON lines to daily-rotating files under
`backend/logs/app-YYYY-MM-DD.log`, with 14-day retention and stdout mirror
in development.

**Rationale**:
- Operator mandate: logs must be written to a log file.
- `pino` is the fastest structured logger for Node.js; its JSON output
  satisfies the constitution's "logs MUST be structured" rule.
- `nestjs-pino` exposes the standard NestJS logger interface so the rest
  of the app code doesn't need to know about pino.
- `pino-roll` is a maintained transport for daily / size-based rotation.
- Request correlation IDs are auto-attached by `nestjs-pino`'s HTTP
  middleware and can be propagated by client code via `x-request-id`.

**Alternatives considered**:
- Winston: rejected — pino is faster and the JSON output is more
  consistent across transports.
- Bunyan: rejected — same reasoning; pino has better NestJS integration.
- Plain `console.log` redirected to a file: rejected — fails the
  constitution's structured-logs rule.

---

## Decision: AES-256-GCM for API credential at rest

**Decision**: The central provider's API key is encrypted at rest using
AES-256-GCM with a random 32-byte key loaded from the
`PROVIDER_ENCRYPTION_KEY` env variable (base64-encoded). Each saved
credential is stored as `{ ciphertext, iv, authTag }` in a single column.

**Rationale**:
- Spec FR-010 requires encrypted-at-rest credentials.
- AES-256-GCM is authenticated encryption — a tampered ciphertext fails
  decryption, which we map to a "central provider not configured"
  error rather than a crash.
- The encryption key never touches the database; it lives only in the
  runtime env. This matches the constitution's "Secrets MUST be loaded
  from the runtime environment, never hard-coded" rule.

**Alternatives considered**:
- Plaintext column with filesystem-level encryption: rejected — couples
  the threat model to the filesystem.
- Hashing (one-way): rejected — credentials must be retrievable to call
  the provider; we cannot hash them.

---

## Decision: Swagger-generated OpenAPI committed to the repo

**Decision**: `@nestjs/swagger` is configured to emit an OpenAPI document
at bootstrap. The document is written to
`backend/specs/001-multi-model-chatbot-mvp/contracts/openapi-3.1.yaml` (a post-build step in `package.json`'s
`build` script). The committed YAML is the contract of record.

**Rationale**:
- Constitution Principle III requires machine-readable, versioned API
  contracts.
- `@nestjs/swagger` generates the YAML from the same decorators the
  controllers use, so the contract cannot drift from the code as long
  as the build step is run.
- Versioning at `/v1` (URL prefix) gives a clear migration path for
  future breaking changes.

**Alternatives considered**:
- Hand-written OpenAPI: rejected — drifts from code; the constitution's
  "API contracts MUST be machine-readable" rule is harder to enforce.
- GraphQL: rejected — spec default is REST, OpenAI protocol is REST-shaped.

---

## Decision: Argon2id preferred over bcrypt for password hashing

**Decision**: Use `argon2` (Argon2id) for password hashing with the
default library parameters; fall back to bcrypt (cost 12) only if the
`argon2` native build fails on the target platform.

**Rationale**:
- Spec FR-001 says "modern, salted password-hashing algorithm". Argon2id
  is the modern winner of the Password Hashing Competition and is the
  OWASP-recommended default as of 2025.
- Native build: `argon2` ships prebuilt binaries for Linux + macOS on
  common Node versions; Windows requires build tools but works.

**Alternatives considered**:
- bcrypt: acceptable fallback; documented as the secondary choice so the
  CI doesn't fail on platforms without C++ build tools.
- scrypt: rejected — Node's `crypto.scrypt` is built-in but tuning the
  cost parameters requires care; Argon2id is safer by default.

---

## Decision: Validation via `class-validator` with strict whitelist

**Decision**: Global `ValidationPipe` enabled in `main.ts` with
`{ whitelist: true, forbidNonWhitelisted: true, transform: true }`.

**Rationale**:
- Whitelist strips unknown fields so callers can't sneak extra columns
  into DTOs.
- `forbidNonWhitelisted` returns a 400 instead of silently dropping
  unknown fields, which makes API misuse loud rather than silent.
- `transform: true` lets DTO classes express types (e.g., `number`,
  `boolean`) instead of stringly-typed inputs.

**Alternatives considered**:
- Zod: works with NestJS via a custom pipe; rejected — class-validator
  is the default in the NestJS ecosystem and integrates with
  `@nestjs/swagger` for OpenAPI generation.

---

## Decision: In-memory token revocation list (MVP)

**Decision**: Logout writes the refresh token's `jti` to an in-memory
`Set<string>` with the token's expiry timestamp; the JWT strategy consults
this set on every request.

**Rationale**:
- For MVP single-process deployment, in-memory state is sufficient.
- The set auto-trims expired entries on each request.
- Horizontal scaling is out of scope; if it ever enters scope, this
  decision flips to a Redis-backed revocation list and the change is
  confined to the JWT strategy file.

**Alternatives considered**:
- Redis: rejected — adds infrastructure out of MVP scope.
- Database table: possible but unnecessary at MVP scale.

---

## Decision: Migrations on MVP day one

**Decision**: TypeORM migrations are committed from the start, even for
SQLite. `synchronize: false` in both environments.

**Rationale**:
- The constitution's "API contracts MUST be machine-readable and
  versioned" rule applies by analogy to schema — schema changes should
  be auditable, not silently synchronized at startup.
- Migrations written against SQLite run unchanged against Postgres later.

**Alternatives considered**:
- `synchronize: true` for MVP: rejected — risks silent schema drift and
  makes the Postgres migration story harder.

---

## Open Items Deferred to `/speckit-tasks`

These are intentionally left for the tasks phase to decide (not blocking
the plan):

- Exact OpenAPI tag groupings for admin vs user endpoints.
- Naming of internal helper services (e.g., the conversation-turn assembler).
- Whether to introduce a worker process for outbound provider calls (MVP:
  synchronous in the request handler; not a concern at MVP scale).
