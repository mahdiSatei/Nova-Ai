# Data Model: Multi-Model Chatbot MVP (Phase 1)

**Branch**: `[001-multi-model-chatbot-mvp]` | **Date**: 2026-09-13
**Source spec**: [spec.md](spec.md) § Key Entities

## Purpose

Define the persistent entities for the MVP, their fields, validation
constraints, relationships, and state transitions. The model targets SQLite
for the MVP via TypeORM; the same entity classes target PostgreSQL in
production without changes.

## Conventions

- All primary keys are UUIDv4 strings, generated server-side.
- Timestamps are stored as ISO-8601 strings (`datetime` column type) to
  stay portable between SQLite and Postgres.
- All "encrypted" fields store JSON-serialized `{ ciphertext, iv, authTag }`
  using AES-256-GCM; the encryption key lives in the runtime env.
- "FK" denotes a foreign-key relationship.

## Entities

### User

The principal identity for both end users and admins. The `role` field
distinguishes them; the rest of the schema is shared.

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | uuid (PK) | not null | server-generated |
| `email` | text | not null, unique (case-insensitive) | stored lowercased |
| `passwordHash` | text | not null | Argon2id; bcrypt fallback |
| `role` | enum(`user`, `admin`) | not null, default `user` | role determines route access |
| `createdAt` | datetime | not null | server-set |
| `lastLoginAt` | datetime | nullable | updated on each successful login |
| `refreshTokens` | RefreshToken[] (1:N) | cascade delete | child entity |

**Validation rules**:
- Email MUST be RFC-5322 shaped (single `@`, valid local + domain parts).
- Email MUST be unique across both roles.
- Password plaintext MUST NOT appear in any persisted field; only
  `passwordHash` is stored.
- Email enumeration MUST be impossible: `/auth/login` returns the same
  error shape for "user not found" and "bad password".

**State transitions**: none beyond creation and last-login updates.

### RefreshToken

Tracks issued refresh tokens so logout / rotation can revoke them.

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | uuid (PK) | not null | server-generated |
| `userId` | uuid (FK → User.id) | not null, indexed | |
| `jti` | text | not null, unique | JWT ID |
| `expiresAt` | datetime | not null, indexed | |
| `revokedAt` | datetime | nullable | set on logout / rotation |
| `createdAt` | datetime | not null | |

**Validation rules**:
- A user MAY have multiple active refresh tokens (e.g., from multiple
  devices). The MVP allows this; explicit cap TBD.
- `jti` MUST be unique across the table.

**State transitions**: `revokedAt` flips from null to a timestamp when
the token is revoked (logout, rotation, or future admin disable).

### CentralProvider

Singleton row (id = `singleton`) holding the central provider's
configuration. A second row MUST never be inserted; the service layer
refuses to create one.

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | text (PK) | not null, default `singleton` | enforced at app layer |
| `baseUrl` | text | not null | OpenAI-compatible base URL |
| `apiKeyEncrypted` | text | not null | AES-256-GCM ciphertext JSON |
| `lastValidatedAt` | datetime | nullable | set after each successful probe |
| `createdAt` | datetime | not null | |
| `updatedAt` | datetime | not null | server-updated on every save |

**Validation rules**:
- `baseUrl` MUST be a syntactically valid http(s) URL.
- `apiKeyEncrypted` MUST be non-empty after encryption.
- Saving without a successful credential probe MUST be rejected (FR-009).

### Model

Catalog entry for one model offered by the central provider.

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | uuid (PK) | not null | server-generated |
| `displayName` | text | not null, unique | human-facing name shown to users |
| `actualName` | text | not null | identifier sent to the provider |
| `enabled` | boolean | not null, default `true` | |
| `isDefault` | boolean | not null, default `false` | at most one row true (see AppConfig) |
| `createdAt` | datetime | not null | |
| `updatedAt` | datetime | not null | |

**Validation rules**:
- `displayName` MUST be 1–80 chars, unique across the table.
- `actualName` MUST be 1–200 chars, can repeat across rows (two rows can
  map to the same provider model id if, e.g., two display aliases are
  wanted — not required by the spec, but the constraint is permissive).
- At most one row MAY have `isDefault = true`. Enforced by a partial
  unique index `WHERE isDefault = true` (Postgres) and by app-layer guard
  on SQLite.
- Only enabled rows are eligible to be `isDefault = true`; setting an
  enabled model as default while another model is already default MUST
  atomically clear the previous default.

**State transitions**: enabled ⇄ disabled; isDefault set / cleared.

### AppConfig

Singleton row (id = `singleton`) holding system-wide configuration.
Currently holds the default model id; new fields may be added later.

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | text (PK) | not null, default `singleton` | enforced at app layer |
| `defaultModelId` | uuid (FK → Model.id) | nullable | null when no default |
| `updatedAt` | datetime | not null | |

**Validation rules**:
- If `defaultModelId` is set, the referenced `Model` row MUST exist and
  MUST be `enabled = true`. Saving a value that violates this MUST fail.
- Setting `defaultModelId = null` clears the default.

### Conversation

A chat session owned by one user, attached to one model at creation time.

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | uuid (PK) | not null | server-generated |
| `userId` | uuid (FK → User.id) | not null, indexed | owner |
| `modelId` | uuid (FK → Model.id) | not null, indexed | model chosen when the conversation started |
| `title` | text | nullable | first user message truncated to 80 chars on first save; user may rename later |
| `pinned` | boolean | not null, default false | pinned conversations sort before unpinned ones in the list |
| `createdAt` | datetime | not null, indexed | |
| `updatedAt` | datetime | not null, indexed | updated on every new message |

**Validation rules**:
- The user MAY have multiple active conversations in parallel.
- Deleting a conversation is a hard delete (cascade deletes its messages).
- Only the owner may pin/unpin or delete a conversation.

**State transitions**: none beyond create / read / delete.

### Message

A single turn in a conversation.

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | uuid (PK) | not null | server-generated |
| `conversationId` | uuid (FK → Conversation.id) | not null, indexed | |
| `role` | enum(`user`, `assistant`) | not null | |
| `content` | text | not null | the full message text |
| `createdAt` | datetime | not null, indexed | |

**Validation rules**:
- `content` length MUST be within server-enforced bounds (configurable;
  default 1 char min, 32 000 chars max) — empty / oversized messages
  rejected before persistence (FR-014).
- Messages are immutable once persisted.

## Relationships (ER summary)

```
User (1) ──< (N) RefreshToken
User (1) ──< (N) Conversation
Conversation (1) ──< (N) Message
Model (1) ──< (N) Conversation
Model (1) >── (0..1) AppConfig.defaultModelId
CentralProvider (singleton, 1 row)
AppConfig (singleton, 1 row)
```

The `CentralProvider` row is not referenced by any other table — every
chat request reads it fresh from the DB at request time. This keeps
admin changes to the provider config live without any cache invalidation.

## Cascading

- Deleting a `User` cascades to `RefreshToken` and `Conversation`.
- Deleting a `Conversation` cascades to `Message`.
- Deleting a `Model`:
  - MUST fail if `AppConfig.defaultModelId` references it; admin must
    unset the default first.
  - For conversations that already reference it, the conversations
    themselves are NOT deleted (the model id is just historical), but
    attempting to send a message to such a conversation MUST surface
    a "model no longer available" error (the user is prompted to start
    a new conversation).

## Encryption

The `CentralProvider.apiKeyEncrypted` field is encrypted at the service
layer (never in the DB driver). Reads decrypt on the fly into an
in-memory variable that is never logged or returned in API responses.

## Migration Strategy

- Initial migration creates all six tables and the partial unique index
  on `Model.isDefault = true` (or its SQLite equivalent).
- Subsequent migrations are generated by `typeorm migration:generate`
  and committed alongside the entity changes.

## Validation Cross-References

- Email uniqueness & password hashing: §FR-001
- Role-based access: §FR-007
- Central provider encryption: §FR-010
- Default model eligibility: §FR-018
- User sticky choice: §FR-020
- Default state transitions: §FR-019
