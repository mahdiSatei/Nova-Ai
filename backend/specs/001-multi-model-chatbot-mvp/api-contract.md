# API Contract: Multi-Model Chatbot (MVP)

**Version**: 1.0.0 (MVP)
**Source artifacts**: `spec.md`, `plan.md`, `data-model.md`, `openapi-3.1.yaml`, `research.md`
**Status**: Active contract of record. The machine-readable companion is [`openapi-3.1.yaml`](openapi-3.1.yaml); this document is the human-readable contract that frontend, backend, and tests MUST agree on.

This document is intentionally one file. It is the single place to read when asking "what does the API actually do?" — endpoints, shapes, naming, error format, versioning, date format, and the agreed-upon names of things.

---

## 1. Domain Glossary (Ubiquitous Language)

These terms are normative. The OpenAPI schema, the database tables, the
TypeScript identifiers, and the React components MUST all use these exact
names. If something here and the OpenAPI disagree, the OpenAPI wins
implementation-wise, but this document wins vocabulary-wise — open an issue.

### Actors

| Term | Definition |
|---|---|
| **User** | A registered account that can chat. Always has `role: "user"`. |
| **Admin** | A registered account with `role: "admin"` that can configure the central provider and the model catalog. Same underlying entity as a User; the role is the only difference. |
| **Anonymous** | An unauthenticated client. Can register, log in, and hit health endpoints. Nothing else. |

### Entities

| Term | Definition | Lifecycle states |
|---|---|---|
| **User** | An account. Identified by `id` (UUIDv4) and `email`. Holds a hashed password and a role. | `created` → `active` (after first login) — no other states in MVP. |
| **RefreshToken** | A JWT ID (`jti`) issued at login. Tracked server-side so logout can revoke it. | `active` → `revoked` (logout, rotation, future admin disable). Auto-expires after 7 days. |
| **CentralProvider** | The single, system-wide OpenAI-compatible AI service used by the MVP. Exactly one row; a second row is forbidden at the application layer. | `unconfigured` (no row) → `configured` → `reconfigured` (admin updates). |
| **Model** | A catalog entry describing one model offered by the central provider. Each model has a human-facing **display name** and a provider-side **actual name**. | `enabled` ⇄ `disabled`. `isDefault` flag is a separate axis (see Default Model). |
| **AppConfig** | The singleton row holding system-wide configuration (right now: only the default-model id). | `present` with `defaultModelId: uuid \| null`. |
| **Conversation** | A chat session owned by one User, attached to one Model at creation. Holds an ordered list of Messages. | `empty` (just created) → `has-messages` → `deleted` (hard delete, cascades messages). |
| **Message** | A single turn in a conversation. Immutable once persisted. | One of `role: "user"` or `role: "assistant"`. No other states. |

### Concepts

| Term | Definition |
|---|---|
| **Display name** | The human-facing name of a Model, shown to end users. Max 80 chars; unique across the table. |
| **Actual name** | The provider-side model identifier (e.g., `gpt-4o-mini`) sent verbatim to the provider. Max 200 chars; not unique (two display aliases may map to the same actual name). NEVER exposed to end users. |
| **Default model** | The single Model designated by the admin as the system-wide fallback. At most one row may carry `isDefault: true` at any moment. When set, it is what fresh users with no explicit selection chat against. |
| **Active model** | The Model that a given chat request will be sent to. Resolution order: explicit `modelId` in the request → caller's last explicit selection (FR-020) → admin's default model → none (request fails with 422). |
| **Central provider** | The single external AI service used by the MVP. Speaks the OpenAI Chat Completions protocol at `/chat/completions`. Configured by the admin. |
| **OpenAI-compatible** | A central provider whose `/chat/completions` endpoint accepts a JSON request shaped `{ messages: [...], model: string, stream: boolean }` and returns either a streaming NDJSON / SSE response (when `stream: true`) or a JSON completion object. **Not** Anthropic-native, Google-native, Bedrock-native, etc. |
| **SSE** | Server-Sent Events. The transport used by `POST /v1/chat/stream`. Each event is a `data: <json>\n\n` line; the final event is `event: done` or `event: error`. |
| **JWT access token** | Short-lived (15 min) bearer token used to authorize API calls. HS256 signed. |
| **JWT refresh token** | Longer-lived (7 days) bearer token used only at `/v1/auth/refresh` to obtain a new access + refresh pair. Tracked in the `refresh_tokens` table so it can be revoked. |
| **Active session** | (MVP usage) The state of "holds a valid, non-revoked access token". There is no server-side session object. |
| **Correlation ID** | A UUID v4 attached to every incoming request by the logging middleware, returned to the client in the `x-request-id` response header, and included in every log line for that request. |
| **Masked credential** | The display form of the central provider's API key on `GET /v1/admin/provider`: the last 4 characters of the cleartext key prefixed with `***`. E.g., `***abcd`. Never the full key. |
| **Conversation transcript** | The ordered list of Messages belonging to a Conversation. Returned by `GET /v1/conversations/:id`. |

### What is NOT in MVP vocabulary

The following terms appear in adjacent contexts but are **out of MVP scope**.
Calling them by these names in code or comments is a smell.

- *Tenant, organization, workspace* — no multi-tenancy in MVP.
- *Team, member, invite* — no team management.
- *Token quota, billing, subscription* — no metering.
- *Webhook* — no outbound callbacks.
- *Worker, queue, job* — no background job system.
- *Document, file, attachment, upload* — no file handling.
- *Embedding, vector, RAG* — no retrieval.
- *Tool, function-calling* — no tool/agent features.

---

## 2. Resource Model (the "nouns")

This is the data model, not the endpoints. See `data-model.md` for the
authoritative field definitions; this section is a one-glance summary.

### Entities

```
User
  id              UUIDv4 (PK)
  email           text, unique (case-insensitive)
  passwordHash    text
  role            enum('user', 'admin')
  createdAt       datetime
  lastLoginAt     datetime?
  lastSelectedModelId   UUIDv4?    (added by US2 to support sticky choice)

RefreshToken
  id              UUIDv4 (PK)
  userId          UUIDv4 (FK → User.id)
  jti             text, unique
  expiresAt       datetime
  revokedAt       datetime?
  createdAt       datetime

CentralProvider      (singleton, id = "singleton")
  id              text, default 'singleton'
  baseUrl         text
  apiKeyEncrypted text    (AES-256-GCM ciphertext JSON)
  lastValidatedAt datetime?
  createdAt       datetime
  updatedAt       datetime

Model
  id              UUIDv4 (PK)
  displayName     text, unique
  actualName      text
  enabled         boolean
  isDefault       boolean
  createdAt       datetime
  updatedAt       datetime

AppConfig             (singleton, id = "singleton")
  id              text, default 'singleton'
  defaultModelId  UUIDv4? (FK → Model.id)
  updatedAt       datetime

Conversation
  id              UUIDv4 (PK)
  userId          UUIDv4 (FK → User.id, indexed)
  modelId         UUIDv4 (FK → Model.id, indexed)
  title           text?
  createdAt       datetime (indexed)
  updatedAt       datetime (indexed)

Message
  id              UUIDv4 (PK)
  conversationId  UUIDv4 (FK → Conversation.id, indexed)
  role            enum('user', 'assistant')
  content         text
  createdAt       datetime (indexed)
```

### Relationships (ER summary)

```
User (1) ──< (N) RefreshToken
User (1) ──< (N) Conversation
Conversation (1) ──< (N) Message
Model (1) ──< (N) Conversation
Model (1) >── (0..1) AppConfig.defaultModelId
CentralProvider (singleton, 1 row, no FK)
AppConfig (singleton, 1 row)
```

### Cascades

- `User` delete → cascades `RefreshToken`, `Conversation` (and its `Message`).
- `Conversation` delete → cascades `Message`.
- `Model` delete → refused with 409 while referenced anywhere (`AppConfig.defaultModelId`, `Conversation.modelId`, or `User.lastSelectedModelId`). Passing `?migrateTo=<replacementId>` first re-points every reference to the replacement model inside one transaction, verifies zero remaining references, and only then deletes (200 with migration counts). References are migrated, never destroyed.

---

## 3. Endpoint List (the "verbs")

Every endpoint below is in `openapi-3.1.yaml`. This table is the
human-readable contract — wire the frontend to this, not to the YAML.

Conventions:

- **Auth**: `user` = valid user JWT; `admin` = valid admin JWT (`role: "admin"`); `public` = no JWT or optional JWT.
- **Content-Type**: every request body is `application/json; charset=utf-8`.
- **Errors**: every endpoint returns the shared error envelope (see §4).

### 3.1 Public — Auth (`/v1/auth/*`)

| Method | Path | Purpose | Auth | Request body | 2xx response | Error responses | Idempotent | Pagination |
|---|---|---|---|---|---|---|---|---|
| POST | `/v1/auth/register` | Create a new user account. | public | `RegisterRequest` | `201` + `AuthResponse` | `400` (invalid body), `409` (email in use) | No (email conflict → 409) | n/a |
| POST | `/v1/auth/login` | Authenticate, receive token pair. | public | `LoginRequest` | `200` + `AuthResponse` | `401` (generic — no email enumeration) | No (each call issues a new refresh token) | n/a |
| POST | `/v1/auth/refresh` | Rotate tokens. Old refresh revoked. | public | `{ refreshToken }` | `200` + `AuthResponse` | `401` (invalid/expired/revoked) | No (each call creates new state) | n/a |
| POST | `/v1/auth/logout` | Revoke the caller's refresh token (writes jti to revocation list). | user | none | `204` | `401` (no/invalid token) | Yes | n/a |

### 3.2 Public — User (`/v1`)

| Method | Path | Purpose | Auth | Request body | 2xx response | Error responses | Idempotent | Pagination |
|---|---|---|---|---|---|---|---|---|
| GET | `/v1/models` | List enabled models (display names + `isDefault`). | user | n/a | `200` `{ items: ModelPublic[] }` | `401` | Yes | n/a |
| POST | `/v1/chat/stream` | Send a message; stream the assistant's reply as SSE. | user | `ChatRequest` | `200` `text/event-stream` | `401`, `409` (provider unconfigured), `422` (`no_model_available`), `502` (provider error) | No | n/a |
| GET | `/v1/conversations` | List the caller's conversations (pinned first, then most recent `updatedAt` first). | user | n/a | `200` `{ items: ConversationSummary[] }` | `401` | Yes | `limit` (1..100, default 20), `offset` (≥0, default 0) |
| GET | `/v1/conversations/:id` | Get one conversation with its full transcript. | user | n/a | `200` `ConversationDetail` | `401`, `403` (not owner), `404` | Yes | n/a |
| PATCH | `/v1/conversations/:id/pin` | Pin or unpin a conversation (idempotent full-state replace). | user | `{ pinned: boolean }` | `200` `{ id, pinned }` | `400`, `401`, `403` (not owner), `404` | Yes | n/a |
| DELETE | `/v1/conversations/:id` | Hard delete a conversation (cascades messages). | user | n/a | `204` | `401`, `403`, `404` | Yes | n/a |

### 3.3 Admin — Auth (`/v1/admin`)

| Method | Path | Purpose | Auth | Request body | 2xx response | Error responses | Idempotent | Pagination |
|---|---|---|---|---|---|---|---|---|
| POST | `/v1/admin/auth/login` | Admin login (same contract as user login; JWT carries `role: "admin"`). | public | `LoginRequest` | `200` + `AuthResponse` | `401` (bad creds OR non-admin account) | No | n/a |

### 3.4 Admin — Provider (`/v1/admin`)

| Method | Path | Purpose | Auth | Request body | 2xx response | Error responses | Idempotent | Pagination |
|---|---|---|---|---|---|---|---|---|
| GET | `/v1/admin/provider` | Get central provider config (credential masked). | admin | n/a | `200` `CentralProviderPublic` | `401`, `403`, `404` (unconfigured) | Yes | n/a |
| PUT | `/v1/admin/provider` | Update central provider config. Validates credentials against the provider before persisting. | admin | `CentralProviderUpdateRequest` | `200` `CentralProviderPublic` | `400`, `401`, `403`, `422` (probe failure) | Yes (same input → same state) | n/a |

### 3.5 Admin — Models (`/v1/admin`)

| Method | Path | Purpose | Auth | Request body | 2xx response | Error responses | Idempotent | Pagination |
|---|---|---|---|---|---|---|---|---|
| GET | `/v1/admin/models` | List all models, including disabled. | admin | n/a | `200` `{ items: ModelAdmin[] }` | `401`, `403` | Yes | n/a |
| POST | `/v1/admin/models` | Create a model. | admin | `ModelUpsertRequest` | `201` `ModelAdmin` | `400`, `401`, `403`, `409` (displayName in use) | No (409 on displayName clash) | n/a |
| PATCH | `/v1/admin/models/:id` | Update `displayName`, `actualName`, and/or `enabled`. | admin | `ModelUpsertRequest` (partial) | `200` `ModelAdmin` | `400`, `401`, `403`, `404` | Yes | n/a |
| DELETE | `/v1/admin/models/:id` | Delete a model. Optional `?migrateTo=<replacementId>` switches every reference (conversations, sticky picks, app default) to the replacement first, verifies none remain, then deletes. | admin | n/a | `204` (plain), `200` `{ deleted, migrated: { conversations, users, defaultSwitched } }` (with `migrateTo`) | `401`, `403`, `404`, `409` (`model_in_use` — counts in message; `replacement_not_available` for same-target), `422` (`replacement_not_available` — missing/disabled target) | Yes | n/a |

### 3.6 Admin — Config (`/v1/admin`)

| Method | Path | Purpose | Auth | Request body | 2xx response | Error responses | Idempotent | Pagination |
|---|---|---|---|---|---|---|---|---|
| GET | `/v1/admin/config` | Get the default model id. | admin | n/a | `200` `AppConfigPublic` | `401`, `403` | Yes | n/a |
| PUT | `/v1/admin/config` | Set or clear the default model. | admin | `AppConfigUpdateRequest` | `200` `AppConfigPublic` | `400`, `401`, `403`, `422` (referenced model disabled/missing) | Yes (PUT to same id is a no-op) | n/a |

### 3.7 Health (`/`)

| Method | Path | Purpose | Auth | Request body | 2xx response | Error responses | Idempotent | Pagination |
|---|---|---|---|---|---|---|---|---|
| GET | `/healthz` | Liveness probe. | public | n/a | `200` "ok" (text) | n/a | Yes | n/a |
| GET | `/readyz` | Readiness probe (DB connectivity). | public | n/a | `200` "ok" / `503` | n/a | Yes | n/a |

### 3.8 SSE event shapes (chat stream)

`POST /v1/chat/stream` returns `text/event-stream`. Each event is one of:

```
data: {"delta":"<text chunk>"}\n\n
```

```
event: done
data: {}\n\n
```

```
event: error
data: {"code":"<error_code>","message":"<human-readable>"}\n\n
```

**Disconnect resilience.** If the client disconnects mid-stream (browser
closed, network dropped, navigation away, page refresh), the server does
**not** cancel the upstream provider call. It continues consuming the
provider stream to completion, accumulates the full assistant response,
and persists it as a normal `role: "assistant"` message on the
conversation. The user can read the persisted message via
`GET /v1/conversations/:id` after generation completes. No further SSE
events are written to the disconnected client (its socket is gone), but
the server-side work runs to the end. The provider-side cost of a
disconnected stream is therefore the same as for a fully-connected one
— the cost of the full response is paid either way; disconnect just
removes the user from seeing it live.

If the provider itself errors mid-stream after the client has already
disconnected, whatever partial text was observed before the error is
still persisted. The user sees the partial assistant message on
return, not nothing.

---

## 4. Shared Schemas

### 4.1 Error envelope

Every non-2xx response from every endpoint MUST use this shape. No
exceptions, no ad-hoc error formats. Stack traces and internal details
MUST NOT appear here.

```json
{
  "code": "snake_case_string",
  "message": "Human-readable, sentence-case, no trailing period.",
  "details": { /* optional, shape varies by code */ },
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `code` | string | yes | Stable, machine-readable, snake_case. Same code across endpoints for the same failure class. |
| `message` | string | yes | Human-readable. Safe to show to end users. |
| `details` | object | no | Per-endpoint structured info (e.g., per-field validation errors). |
| `requestId` | UUIDv4 | yes | Echoes the `x-request-id` request header for support. |

Stable error codes used in MVP:

| Code | HTTP | Where | Meaning |
|---|---|---|---|
| `invalid_credentials` | 401 | login | Bad email or password (no enumeration). |
| `invalid_token` | 401 | any authenticated route | Token missing, malformed, expired, or revoked. |
| `forbidden` | 403 | any role-checked route | Authenticated but wrong role or owner mismatch. |
| `not_found` | 404 | any | Resource doesn't exist OR caller can't see it. |
| `email_taken` | 409 | register | Email already registered. |
| `display_name_taken` | 409 | create model | `displayName` already used by another model. |
| `model_in_use` | 409 | delete model | Model is still referenced (app default, conversations, and/or user sticky picks); the message reports the counts. Delete with `migrateTo` to re-point first. |
| `replacement_not_available` | 409 (same-target) / 422 (missing or disabled target) | delete model with `migrateTo` | The replacement model must exist, be enabled, and differ from the deleted model. |
| `validation_failed` | 400 | any DTO-bound route | Body or query failed validation. `details` lists field errors. |
| `provider_not_configured` | 409 | chat stream | Admin has not saved central provider config. |
| `no_model_available` | 422 | chat stream | No explicit `modelId`, no sticky choice, no admin default. |
| `provider_unreachable` | 502 | chat stream | Central provider rejected the call or returned malformed data. |
| `internal_error` | 500 | any | Unexpected server error. The message is intentionally generic. |

### 4.2 Pagination envelope

Used on list endpoints (currently `GET /v1/conversations` and the two admin
list endpoints). Offset/limit pagination for MVP; cursor-based is a
post-MVP concern.

```json
{
  "items": [ /* T[] */ ],
  "total": 42
}
```

`total` is optional for MVP. If it's expensive to compute, omit it on that
endpoint and document the omission. `limit` and `offset` query parameters
are documented per-endpoint in §3.

### 4.3 Timestamp format

**All timestamps are ISO 8601 in UTC, with the `Z` suffix and no fractional
seconds.** Example: `2026-09-13T16:42:11Z`.

Rules:

- Storage: ISO 8601 UTC strings (TypeORM `datetime` columns on both SQLite and PostgreSQL).
- Wire format: ISO 8601 UTC strings, always with `Z`, always second-precision.
- Never include a timezone offset like `+02:00`; always normalize to UTC.
- Never include milliseconds; round to the nearest second.

### 4.4 UUID format

All IDs that are UUIDs are RFC 4122 UUIDv4 strings, lowercase, hyphenated
(8-4-4-4-12). Example: `550e8400-e29b-41d4-a716-446655440000`. The two
singletons use the literal string `singleton` as their id instead of a
UUID, so callers can hard-code that path for tests if they want.

### 4.5 JWT shape

Two tokens, both signed HS256.

**Access token** (sent as `Authorization: Bearer <jwt>` on every request):

```json
{
  "sub": "<userId>",
  "email": "alice@example.com",
  "role": "user" | "admin",
  "iat": 1700000000,
  "exp": 1700000900,
  "jti": "<uuid>"
}
```

TTL: 15 minutes.

**Refresh token** (sent to `POST /v1/auth/refresh` only):

```json
{
  "sub": "<userId>",
  "type": "refresh",
  "iat": 1700000000,
  "exp": 1700604800,
  "jti": "<uuid>"
}
```

TTL: 7 days. The `jti` is recorded in the `refresh_tokens` table; logout
sets `revokedAt`.

### 4.6 Masked credential

On `GET /v1/admin/provider`, the credential field is `apiKeyMasked` of
type string. Format: the literal three characters `***` followed by the
last 4 characters of the cleartext key. If the key has fewer than 4
characters, return `***` only. The cleartext `apiKey` field is NEVER
returned in any response, ever.

```json
{
  "baseUrl": "https://api.example.com/v1",
  "apiKeyMasked": "***wxyz",
  "isConfigured": true,
  "lastValidatedAt": "2026-09-13T16:42:11Z"
}
```

### 4.7 Enum casing

All enum values are **lowercase strings** (`user`, `admin`, `enabled`,
`assistant`). Never TitleCase, never SCREAMING_SNAKE.

| Enum | Allowed values |
|---|---|
| `User.role` | `user`, `admin` |
| `Message.role` | `user`, `assistant` |
| `Model.enabled` | boolean |
| `Model.isDefault` | boolean |
| `AppConfig.defaultModelId` | UUID or null |

---

## 5. Non-Functional Contract

### 5.1 Versioning

- API version is in the URL prefix: **`/v1`**. Breaking changes increment to `/v2`.
- Adding an optional field to a response is NOT a breaking change.
- Removing a field, renaming a field, changing a type, or changing the
  semantics of an existing field IS breaking.
- The OpenAPI document's `info.version` MUST be bumped on any breaking change.
- The OpenAPI file path itself (`/v1/...` server routes) is independent
  of the OpenAPI document version — keep them in sync.

### 5.2 Content negotiation

- All non-streaming endpoints accept and return `application/json; charset=utf-8`.
- The single streaming endpoint (`POST /v1/chat/stream`) accepts `application/json`
  and returns `text/event-stream`.
- No endpoint accepts form-encoded bodies.
- No endpoint accepts or returns XML.

### 5.3 Date and time

See §4.3. All timestamps: ISO 8601 UTC, second-precision, `Z` suffix.

### 5.4 JSON conventions

- **Field naming**: `camelCase` for request and response bodies. snake_case is reserved for the `code` field of the error envelope and for URL path segments (which are `kebab-case` in path, but `camelCase` for query params).
- **Empty vs null vs omitted**:
  - `null` is a valid value and means "explicitly no value". Frontend MUST send `null` (not omit) to clear optional fields like `defaultModelId`.
  - Omitted fields mean "use default" on PUT / PATCH requests.
  - Empty strings are NOT the same as null. Empty `string` is invalid for any field with `minLength: 1`.
- **Booleans**: lowercase JSON `true` / `false`, never `1` / `0`, never `"yes"` / `"no"`.
- **Numbers**: JSON numbers, not strings. The OpenAPI schema enforces this.

### 5.5 Authentication header

All authenticated requests MUST include:

```
Authorization: Bearer <jwt>
```

The token is the **access** token, not the refresh token. Refresh tokens
MUST NOT be sent as `Authorization` headers — they go in the request body
of `/v1/auth/refresh` only.

### 5.6 Correlation header

The server attaches a correlation UUID to every request:

```
x-request-id: 550e8400-e29b-41d4-a716-446655440000
```

The response includes this header on every endpoint. Clients MAY supply an
`x-request-id` request header; if present and parseable as a UUID, the
server reuses it. Otherwise the server generates one.

### 5.7 Rate limits

**Not enforced in MVP.** The OpenAPI does not advertise rate-limit
response codes. If a future version adds limits, it will use the standard
`429 Too Many Requests` with `Retry-After` and a `RateLimit-*` header set.

### 5.8 Caching

- All `/v1/auth/*` endpoints: `Cache-Control: no-store`.
- All `/v1/admin/*` endpoints: `Cache-Control: no-store`.
- `GET /v1/models`: `Cache-Control: no-store` (the result depends on
  admin config that may change at any time).
- `GET /v1/conversations`, `GET /v1/conversations/:id`:
  `Cache-Control: no-store`.
- `GET /healthz`, `GET /readyz`: `Cache-Control: no-store`.

In short: nothing is cached by intermediaries in MVP. Add `ETag` /
`Cache-Control: max-age` only after MVP when the cost of recomputation
becomes relevant.

### 5.9 CORS

- MVP backend is server-rendered or paired with a frontend on a known
  origin. CORS is restricted via `Origin` allowlist (configuration-driven,
  defaulting to a single configured frontend origin).
- Preflight (`OPTIONS`) is answered for allowed origins and methods
  `GET, POST, PATCH, DELETE, OPTIONS` plus headers `Authorization,
  Content-Type, X-Request-ID`.

### 5.10 Base URLs

| Environment | Base URL |
|---|---|
| Local development | `http://localhost:3000` |
| Staging | `https://api.staging.example.com` (configured at deploy time) |
| Production | `https://api.example.com` (configured at deploy time) |

All paths in this document are relative to the base URL.

### 5.11 Server identity

The `Server` header MUST NOT be set (or MUST be set to a generic value
like `nginx`/`cloudflare`) so as not to leak the application framework.

---

## 6. Cross-references

- Authoritative machine-readable contract: [`openapi-3.1.yaml`](openapi-3.1.yaml)
- Field-level data model: [`data-model.md`](data-model.md)
- Stack and architecture decisions: [`plan.md`](plan.md), [`research.md`](research.md)
- User-facing behavior: [`spec.md`](spec.md)
- Runnable validation: [`quickstart.md`](quickstart.md)

When this document and the OpenAPI disagree, the OpenAPI is the implementation source of truth. When this document and the spec disagree about *intent*, the spec wins. When this document disagrees with itself, open an issue.
