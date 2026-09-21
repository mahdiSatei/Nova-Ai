# Phase 4 — Usage & Cost Tracking

## Goal

Record model consumption (tokens) and estimated cost for every chat request, with an admin usage report.

## Scope

### Backend

- Usage record/entity and persistence.
- Track user, conversation, message, model, and provider.
- Record input/output/total tokens.
- Record estimated cost using model pricing configuration.
- Record request status and timestamps.
- Finalize usage after streaming completes or fails.
- Admin usage report API.

### Frontend

- Admin usage report.
- Basic usage and cost display.
- Loading, empty, and error states.

## Acceptance Criteria

- Successful requests create accurate usage records.
- Streaming responses record usage when the provider supplies it.
- Failed requests have a defined accounting behavior.
- Disconnected clients do not cause duplicate usage records.
- Admin can view usage by user, model, provider, and time range.
- Cost calculation is traceable to the configured pricing.

## Out of Scope

- Quota enforcement.
- Billing payments.
- Web search cost tracking.
- Advanced analytics.

## Data Model

### usage_records table

| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | Auto-generated |
| user_id | TEXT (FK → users) | CASCADE on delete |
| conversation_id | TEXT (FK → conversations) | CASCADE on delete |
| message_id | TEXT (FK → messages, nullable) | SET NULL on delete; UNIQUE index (partial: WHERE message_id IS NOT NULL) |
| model_id | TEXT (FK → models) | RESTRICT on delete |
| provider_id | TEXT (FK → providers) | RESTRICT on delete |
| prompt_tokens | INT | Default 0 |
| completion_tokens | INT | Default 0 |
| total_tokens | INT | Default 0 |
| estimated_cost | DECIMAL(12,8) | Default 0; calculated from model pricing |
| status | TEXT | 'pending' → 'completed' or 'failed' |
| created_at | TIMESTAMPTZ | Auto-set on insert |
| completed_at | TIMESTAMPTZ (nullable) | Set when streaming completes or fails |

### Indexes

- `idx_usage_user_created` on (user_id, created_at)
- `idx_usage_model_created` on (model_id, created_at)
- `idx_usage_provider_created` on (provider_id, created_at)
- `idx_usage_conversation` on (conversation_id)
- `idx_usage_message` UNIQUE on (message_id) WHERE message_id IS NOT NULL

### Model pricing columns

Added to existing `models` table:

| Column | Type | Notes |
|---|---|---|
| input_price_per_1k | DECIMAL(10,6) | Default 0; cost per 1,000 input tokens (USD) |
| output_price_per_1k | DECIMAL(10,6) | Default 0; cost per 1,000 output tokens (USD) |

## API Contract

### GET /v1/admin/usage

**Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| userId | string | — | Filter by user ID |
| modelId | string | — | Filter by model ID |
| providerId | string | — | Filter by provider ID |
| status | string | — | Filter by status (pending, completed, failed) |
| from | ISO 8601 datetime | — | Start of time range |
| to | ISO 8601 datetime | — | End of time range |
| limit | integer | 20 | Page size (1-100) |
| offset | integer | 0 | Pagination offset |

**Response (200):**

```json
{
  "items": [
    {
      "id": "uuid",
      "userId": "uuid",
      "conversationId": "uuid",
      "messageId": "uuid",
      "modelId": "uuid",
      "modelName": "GPT-4",
      "providerId": "uuid",
      "providerName": "OpenAI",
      "promptTokens": 150,
      "completionTokens": 50,
      "totalTokens": 200,
      "estimatedCost": 0.0045,
      "status": "completed",
      "createdAt": "2026-09-18T12:00:00Z",
      "completedAt": "2026-09-18T12:00:05Z"
    }
  ],
  "total": 150,
  "totals": {
    "totalTokens": 125000,
    "totalCost": 2.35,
    "requestCount": 150
  }
}
```

## Usage Lifecycle

1. **Request starts**: Chat service creates a `pending` usage record with userId, conversationId, modelId, providerId.
2. **Streaming**: Provider sends chunks. The final chunk may include `usage: { prompt_tokens, completion_tokens, total_tokens }`.
3. **Stream completes (success)**: Usage record is finalized with token counts from the provider, status set to `completed`, `estimatedCost` calculated.
4. **Stream fails**: Usage record is finalized with zero tokens, status set to `failed`, `estimatedCost` = 0.
5. **Client disconnects**: The stream continues to completion (the provider still processes tokens). Usage is recorded normally. The `unique` index on `messageId` prevents duplicate records.

## Cost Calculation

```
estimatedCost = (promptTokens / 1000) * inputPricePer1k + (completionTokens / 1000) * outputPricePer1k
```

Rounded to 8 decimal places. When pricing columns are 0 (default), cost is 0.

## Provider Adapter Changes

The `ProviderStreamChunk` interface gains an optional `usage` field:

```typescript
export interface ProviderStreamChunk {
  choices?: Array<{ delta?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}
```

The OpenAI-compatible adapter passes `stream_options: { include_usage: true }` to request usage data in the final chunk.

## Disconnected Client Behavior

The existing architecture already handles this correctly:

- The `runStream` method continues executing even after the Observable unsubscribes (client disconnects).
- The `isActive()` check only gates SSE emissions, not the actual provider consumption.
- The streaming loop runs to completion, and usage is recorded in the `finally` block.
- The `unique` index on `messageId` prevents duplicate usage records if the same message is somehow processed twice.
