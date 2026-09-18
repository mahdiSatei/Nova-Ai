# Frontend Briefing: Backend Changes for Persistent Streaming

## What changed on the backend

### 1. Message status lifecycle

Every message now has a `status` field:

```
'pending' | 'streaming' | 'completed' | 'failed' | 'cancelled'
```

- **Default is `'completed'`** — old messages will read as completed.
- The assistant message for an active generation is created **before** the provider stream starts, with `status: 'streaming'`.
- On success → `status: 'completed'` (content is the full response).
- On provider error → `status: 'failed'` (content may be partial).
- On user cancel → `status: 'cancelled'` (content is whatever was accumulated).
- Content is updated **progressively** during streaming (each delta writes to DB).

### 2. Frontend type changes

**`MessagePublic`** now includes `status`:

```ts
interface MessagePublic {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  status: MessageStatus  // NEW — 'completed' | 'streaming' | 'failed' | 'cancelled'
}
```

**`MessageStatus`** type to add to your shared types:

```ts
export type MessageStatus = 'pending' | 'streaming' | 'completed' | 'failed' | 'cancelled'
```

### 3. API endpoint changes

#### New endpoints

| Method | Path | Body | Returns | Purpose |
|--------|------|------|---------|---------|
| `POST` | `/v1/chat/:conversationId/cancel` | — | `{ messageId: string; status: string }` | Cancel active streaming generation |
| `POST` | `/v1/chat/:conversationId/retry` | `{ failedMessageId: string }` | `{ messageId: string; status: string }` | Retry a failed/cancelled generation |

**Cancel**: Finds the streaming message internally. If none exists → `404` with `code: 'no_active_generation'`. Cancelling sets `status: 'cancelled'` on the existing assistant message (does **not** create a new message). The partial content remains visible.

**Retry**: Takes the `failedMessageId` of the previous failed/cancelled assistant message. Creates a **new** assistant message with `status: 'streaming'`. The old message stays in history. Returns the new `messageId`.

#### Changed response

`GET /v1/conversations/:id` — messages now include `status`:

```ts
messages: Array<{
  id: string
  role: string
  content: string
  createdAt: string
  status: string       // NEW
}>
```

#### SSE stream contract (unchanged shape, but note what's gone)

- `data: {"delta":"..."}` — token chunk
- `event: done` — completed
- `event: error` — provider or internal error
- **`event: started` no longer exists** — the backend does not emit it anymore. Remove any `onStarted` handler.

### 4. Concurrency guard

If you send a message while a generation is already active for that conversation, the backend returns a stream-level error:

```ts
{ code: 'generation_in_progress', message: 'A generation is already in progress...' }
```

This arrives as an `event: error` SSE frame (not an HTTP error). The frontend should surface this to the user instead of treating it as a generic failure.

### 5. Abort vs Cancel — important distinction

The old `abort()` in `useChatStream.ts` calls `controller.abort()`, which only kills the **fetch**. With the new backend, that means:

- The SSE connection is dropped.
- The backend **continues generating** (its `isActive()` becomes `false` → stops emitting SSE, but still finishes and persists with `status: 'completed'` or `'failed'`).
- The user's message is **not lost** — it gets persisted.
- But the UI never learns the final state unless you reload.

**To properly cancel**, you should call `POST /v1/chat/:conversationId/cancel`. This tells the backend to stop and set `status: 'cancelled'`.

---

## Frontend state model to implement

### Connection state (separate from generation state)

```
CONNECTED
DISCONNECTED
RECONNECTING
```

### Generation state

```
IDLE
STREAMING
COMPLETED
FAILED
CANCELLED
```

These two axes are independent. Example valid combos:

```
Connection: DISCONNECTED, Generation: STREAMING
Connection: RECONNECTING,  Generation: STREAMING
Connection: CONNECTED,     Generation: COMPLETED
```

### Active generation object to track

```ts
interface ActiveGeneration {
  generationId: string        // conversationId acts as generationId (one per convo)
  conversationId: string
  assistantMessageId: string  // the message with status='streaming'
  status: GenerationStatus
  content: string             // accumulated assistant text
}
```

**Do not use message text as generation identity.** The `conversationId` + `assistantMessageId` pair is the stable identifier.

---

## UI behavior matrix

| Connection | Generation | UI |
|---|---|---|
| CONNECTED | IDLE | Send enabled, input enabled |
| CONNECTED | STREAMING | Send disabled, show **Stop** button |
| DISCONNECTED | STREAMING | Show reconnect banner, preserve partial content, show **Reconnect** |
| RECONNECTING | STREAMING | Show "Reconnecting..." spinner, no duplicate sends |
| CONNECTED | COMPLETED | Normal state, full response visible |
| CONNECTED | FAILED | Show error, show **Retry** |
| CONNECTED | CANCELLED | Show partial response, enable input |
| (page reload) | STREAMING | Load conversation, detect streaming message, offer recovery |
| (page reload) | COMPLETED | Render final persisted message, no recovery needed |

---

## Key implementation points for the frontend

### A. On conversation load (`loadConversation`)

After loading messages, scan for a message with `status === 'streaming'`:

- If found → the generation is still active on the backend.
- Set generation state to `STREAMING`.
- Show the partial content.
- Show a **Reconnect** button.
- Track `assistantMessageId` for reconnect/cancel.

### B. On send (new message)

1. Disable send/input immediately.
2. Set generation state → `STREAMING`.
3. Create a local pending user message.
4. Call `POST /v1/chat/stream`.
5. Accumulate deltas into local buffer AND update the backend message content progressively.
6. On `event: done` → state → `COMPLETED`. Move messages to transcript.
7. On `event: error` → check error code:
   - `generation_in_progress` → show user-friendly message, reset state to `IDLE`.
   - `provider_error` → state → `FAILED`, show retry.
8. On `event: error` → the assistant message in the DB has `status: 'failed'`.

### C. Snapshot replacement on reconnect

When reconnecting, the backend has the authoritative content. **Replace** (do not append) the local assistant content with the backend snapshot. This prevents duplicate text.

### D. Cancel

```
POST /v1/chat/:conversationId/cancel
```

- On success → generation state → `CANCELLED`. Partial content stays visible.
- On 404 (`no_active_generation`) → the generation already finished. Reload conversation to get final state.

### E. Retry

```
POST /v1/chat/:conversationId/retry
Body: { failedMessageId: string }
```

- Backend creates a **new** streaming message.
- Frontend clears local assistant buffer, sets state → `STREAMING`, starts streaming.
- The old failed message stays in transcript history.

### F. `generation_in_progress` error

This arrives as an SSE `event: error` frame. It's not an HTTP rejection. The SSE stream starts, then immediately errors. Handle it by:

- Not adding any pending messages to transcript.
- Resetting to `IDLE`.
- Showing something like: "Another response is being generated. Wait or cancel it."

### G. Remove `onStarted` handler

The backend no longer emits `event: started`. Remove the `onStarted` callback and any code that relies on receiving a `conversationId` from the SSE stream. The conversation is already known from the request DTO.

---

## Files that need changes

| File | What to change |
|---|---|
| `src/types/api.ts` | Add `MessageStatus` type, add `status` to `MessagePublic` |
| `src/api/conversations.ts` | Add `cancelGeneration` and `retryGeneration` API functions |
| `src/composables/useChatStream.ts` | Major refactor: split phase into connection state + generation state; add `assistantMessageId` tracking; replace `onStarted`; add `cancel()` and `retry()` methods; implement snapshot replacement on reconnect; handle `generation_in_progress`; detect streaming message on load |
| `src/components/chat/MessageList.vue` | Accept `status` prop on rows, show recovery UI for streaming/failed/cancelled messages |
| `src/components/chat/MessageInput.vue` | Already has `disabled`/`busy` — wire to generation state |
| `src/components/chat/ChatMessage.vue` | Show status indicator for non-completed messages (streaming caret, failed icon, cancelled state, retry button) |
| `src/views/ConversationView.vue` | Add connection status banner, reconnect button, load-time recovery flow |
