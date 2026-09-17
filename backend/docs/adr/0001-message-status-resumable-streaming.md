# ADR-0001: Message Status Tracking and Resumable Streaming Architecture

- Status: Accepted
- Date: 2026-09-16

## Context

The chat backend needed message persistence across client disconnects and the ability to resume or retry failed/cancelled generations. The existing streaming implementation used Observable teardown, which destroyed the stream on client disconnect — any in-progress generation was lost and could not be recovered.

The plan proposed a Subject-based hot-stream pattern for resumable streaming. We needed to decide on the streaming architecture, message lifecycle model, and how to enforce single-generation-per-conversation without introducing a separate Generation entity.

## Decision

### 1. Observable + isActive() flag over Subject-based hot-stream

The streaming implementation uses `new Observable(...)` with an internal `cancelled` boolean and an `isActive()` closure. When the client disconnects, the teardown sets `cancelled = true`. The stream loop checks `isActive()` before forwarding events to the observer, but **continues consuming and persisting content regardless**.

This was chosen over the plan's proposed Subject-based pattern because:
- Achieves the same functional goal (progressive persistence survives disconnect)
- Simpler — no Subject lifecycle management, no replay buffer concerns
- The client that reconnects fetches the persisted message via `GET /v1/conversations/:id`, not via a resumed Subject subscription

### 2. Message.status column instead of a separate Generation entity

Message lifecycle states are tracked via a `status` column on the existing Message entity (`pending | streaming | completed | failed | cancelled`). No separate Generation table was introduced.

This keeps the data model flat, avoids join queries, and aligns with the plan's global constraint.

### 3. Progressive content persistence outside the isActive() guard

The stream loop accumulates `fullResponse += delta` and calls `updateMessageStatus(messageId, 'streaming', fullResponse)` on every chunk. The `isActive()` guard only wraps `observer.next()` — content is always persisted.

This is the key mechanism that enables resume: even if the client disconnects mid-stream, the partial response is saved and available when the client reconnects.

### 4. One active generation per conversation (service-layer enforcement)

Before starting a new generation, `findStreamingMessage(conversationId)` checks for an existing message with `status = 'streaming'`. If found, the API returns `409 Conflict` with code `generation_in_progress`. This is enforced in `ChatService.runStream`, not via a database constraint.

### 5. Retry creates a new assistant message (Option B)

When retrying a failed/cancelled generation, `retryGeneration` creates a fresh assistant message with `status = 'streaming'` and empty content. The old message (with `failed` or `cancelled` status) is retained in the conversation history. The frontend can choose which message to display.

### 6. Cancel marks the streaming message as cancelled

`cancelGeneration` validates ownership (requester must own the conversation), verifies the target message is currently streaming, then updates its status to `cancelled`. The background stream loop detects `isActive() === false` and stops forwarding events, but content accumulated so far is preserved.

## Consequences

### Positive

- **Client disconnect is safe**: partial responses are always persisted; no data loss on disconnect
- **Resumable without re-querying the provider**: client reconnects, fetches the persisted message via GET
- **Simple data model**: single Message entity with a status column; no Generation table
- **Straightforward testing**: service methods are pure enough to unit-test with mock repositories
- **Cross-DB compatible**: migration uses conditional SQL for SQLite and PostgreSQL

### Negative / Trade-offs

- **Subject replay not available**: if the client wants to receive already-streamed tokens on reconnect (rather than just the final persisted content), it must poll GET — no push-based resume
- **Background stream continues after disconnect**: the provider call runs to completion even when no client is listening, consuming API quota. This is intentional (ensures persistence) but costs provider tokens on orphaned streams
- **No streaming timeout**: a stuck provider stream runs indefinitely. Should add a timeout in a future iteration
- **Service-layer 409 is not a DB constraint**: two concurrent requests could theoretically both pass the check before either creates the streaming message. The window is small but not zero. Acceptable for MVP.

### Neutral

- Migration uses `IF NOT EXISTS` / conditional INSERT patterns for cross-DB compatibility
- Lint errors pre-exist in unrelated files (init migration, user entity) — not from this change set
- The `conversations.controller.ts` GET endpoint now includes `status` in the message map, which is a backward-compatible addition
