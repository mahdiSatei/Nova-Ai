# Phase 5 — Quotas & User Usage Display

## Goal

Enforce consumption limits before expensive model requests begin.

## Scope

### Backend

- Quota policy by role/subscription.
- Token, request, and/or cost limits.
- Preflight quota validation.
- Atomic quota reservation or equivalent concurrency-safe enforcement.
- Quota finalization/refund behavior.
- Usage and remaining quota API.
- Admin quota configuration.

### Frontend

- Usage and remaining quota display in chat.
- Overall usage/balance section.
- Quota exceeded state.
- Clear error messages before sending.

## Acceptance Criteria

- Requests exceeding quota are rejected before provider invocation.
- Quota rules differ correctly by role/subscription.
- Concurrent requests cannot bypass limits.
- Remaining quota updates after usage is finalized.
- The user receives a clear explanation when blocked.
- Admin can inspect and configure quota policies.

## Out of Scope

- Provider fallback, web search, billing system.

## Quota Model Decision

**Start with token quota.** Token limit is the most immediate enforcement point — it's available before any provider call and aligns with typical LLM usage models. Cost limit is available as a secondary signal derived from the same usage records.

### Token Quota Policy

Each user has a token quota (monthly or rolling). The quota is consumed by successful requests and refunded on failure.

| Tier | Example Token Quota | Reset Period |
|---|---|---|
| free | 100,000 tokens/month | Rolling 30-day window |
| commercial | 1,000,000 tokens/month | Rolling 30-day window |
| admin | unlimited (no quota enforced) | — |

### Cost Limit (Secondary)

In phase 5, cost is displayed but not enforced. Cost enforcement is deferred to a later billing phase.

## Data Model

### quotas table

| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | Auto-generated |
| user_id | UUID (FK → users) | UNIQUE, CASCADE on delete |
| token_limit | BIGINT | Maximum tokens allowed in window |
| token_used | BIGINT | Tokens consumed (rolling 30-day) |
| last_reset_at | TIMESTAMPTZ | Last window reset |
| created_at | TIMESTAMPTZ | Auto-set |
| updated_at | TIMESTAMPTZ | Auto-set |

### Quota Reservation (in-memory / DB)

For atomic concurrency-safe enforcement, use a DB-level approach:

1. **Check**: `SELECT token_used FROM quotas WHERE user_id = ? FOR UPDATE`
2. **Reserve**: `UPDATE quotas SET token_used = token_used + ? WHERE user_id = ? AND token_used + ? <= token_limit RETURNING token_used`
3. If the UPDATE affects 0 rows, quota is exhausted.
4. **Finalize**: After the request completes, UPDATE token_used with the actual count (over-reservation is corrected).

The `FOR UPDATE` row lock ensures concurrent requests cannot bypass limits.

### Quota Rule Configuration

Admin-configurable quota rules per tier:

| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | |
| tier | TEXT | 'free', 'commercial' |
| token_limit | BIGINT | |
| label | TEXT | Human-readable name |
| created_at | TIMESTAMPTZ | |

## API Contract

### GET /v1/users/me/quota

Authenticated user endpoint.

**Response (200):**

```json
{
  "tokenLimit": 100000,
  "tokenUsed": 45000,
  "tokenRemaining": 55000,
  "costUsed": 0.45,
  "costLimit": null,
  "resetAt": "2026-10-18T12:00:00Z"
}
```

### PATCH /v1/admin/quota-rules

Admin-only endpoint to configure quota rules.

**Request:**

```json
{
  "tier": "free",
  "tokenLimit": 100000,
  "label": "Free tier — 100K tokens/month"
}
```

**Response (200):** The updated rule.

### GET /v1/admin/quota-rules

Admin-only endpoint to list quota rules.

**Response (200):**

```json
{
  "items": [
    {
      "id": "uuid",
      "tier": "free",
      "tokenLimit": 100000,
      "label": "Free tier — 100K tokens/month",
      "createdAt": "2026-09-18T12:00:00Z"
    },
    {
      "id": "uuid",
      "tier": "commercial",
      "tokenLimit": 1000000,
      "label": "Commercial tier — 1M tokens/month",
      "createdAt": "2026-09-18T12:00:00Z"
    }
  ]
}
```

## Usage Lifecycle with Quota

1. **Request starts**: ChatService creates pending usage record (existing behavior).
2. **Preflight quota check**: `QuotaService.checkAndReserve(userId, estimatedTokens)` — atomic DB check + reservation.
3. **If quota exceeded**: Return `402 quota_exceeded` error before provider invocation.
4. **Streaming**: Provider sends chunks.
5. **Stream completes**: Finalize usage with actual token counts (existing behavior). Call `QuotaService.finalize(usageRecordId, actualTokens)` to adjust the reservation (correct over-reservation).
6. **Stream fails**: Finalize usage as failed (existing behavior). Call `QuotaService.refund(reservationId)` to release the reserved tokens.

## Error Codes

| Code | HTTP | Message |
|---|---|---|
| quota_exceeded | 402 | "You have reached your token limit. {remaining} of {limit} tokens remain." |
| quota_not_configured | 422 | "Quota policy is not configured for your tier." |

## Frontend

- Chat view shows remaining token quota below the input.
- Quota exceeded state: disabled input, clear error message.
- Usage/balance section in user profile (GET /v1/users/me/quota display).
- Error messages translated (existing i18n pattern).

## File Structure

| File | Responsibility |
|---|---|
| `backend/specs/005-quotas-user-usage-display/spec.md` | Phase spec |
| `backend/src/modules/quotas/entities/quota.entity.ts` | Quota entity |
| `backend/src/modules/quotas/entities/quota-rule.entity.ts` | Quota rule entity |
| `backend/src/modules/quotas/quotas.service.ts` | Quota check/reserve/finalize logic |
| `backend/src/modules/quotas/quotas.module.ts` | Module wiring |
| `backend/src/modules/quotas/dto/quota-rule.dto.ts` | Quota rule DTOs |
| `backend/src/modules/quotas/quotas.admin.controller.ts` | Admin quota rules endpoints |
| `backend/src/modules/quotas/quotas.user.controller.ts` | User quota endpoint |
| `backend/src/modules/chat/chat.service.ts` | Preflight quota check + finalization |
| `backend/src/modules/users/users.service.ts` | User quota initialization |
| `backend/src/database/migrations/1700000008000-add-quotas-and-quota-rules.ts` | Migration |
| `backend/test/unit/quota.entity.spec.ts` | Entity tests |
| `backend/test/unit/quotas.service.spec.ts` | Service tests |
| `backend/test/unit/quotas.admin.controller.spec.ts` | Admin controller tests |
| `backend/test/unit/quotas.user.controller.spec.ts` | User controller tests |
| `backend/test/unit/chat.service-quota.spec.ts` | Chat service quota integration |
| `backend/test/contract/quota-contract.spec.ts` | Contract validation |
| `backend/test/integration/quota.e2e.spec.ts` | End-to-end acceptance tests |
| `frontend/app/src/types/api.ts` | Quota types |
| `frontend/app/src/api/chat.ts` | User quota API function |
| `frontend/app/src/views/ChatView.vue` | Quota display in chat |
| `frontend/app/src/views/profile/ProfileView.vue` (if exists) or new `UsageView.vue` | Usage/balance section |
| `frontend/app/src/composables/useQuota.ts` | Quota composable |
| `frontend/app/tests/api/chat.spec.ts` | Quota API tests |
| `frontend/app/tests/useQuota.spec.ts` | Quota composable tests |
