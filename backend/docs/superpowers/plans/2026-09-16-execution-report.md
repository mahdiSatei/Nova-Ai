# Execution Report — Persistent Chat & Resumable Streaming

**Branch:** `persist-stream`
**Date:** 2026-09-16
**Tests:** 96/96 passing (26 unit + 70 integration)

---

## 1. What changed (in plain English)

### The problem before

When a user's internet disconnected during a chat response, the streaming stopped and the partial response was lost. When they reconnected, they got nothing — the generation was gone. There was also no way to cancel a slow generation or retry a failed one.

### What was built

**5 layers of change, stacked on top of each other:**

| Layer | What it does | Files changed |
|---|---|---|
| **Data** | Messages now carry a `status` field (`pending`, `streaming`, `completed`, `failed`, `cancelled`). Like a progress bar for each AI response. | Message entity, MessagePublicDto, conversations.types.ts, migration |
| **Service** | New methods on ConversationsService: find a streaming message, update its status, cancel a generation, retry by creating a fresh message. | conversations.service.ts |
| **Streaming** | ChatService was refactored so that when a client disconnects, the server *keeps generating* and saves partial content to the database. The client can reconnect and fetch the saved content. | chat.service.ts |
| **Endpoints** | Two new API routes: `POST /v1/chat/:id/cancel` and `POST /v1/chat/:id/retry`. Plus the existing stream endpoint now returns `409` if a generation is already running. | chat.controller.ts |
| **Contract** | OpenAPI spec updated with the new `status` field on messages and the two new endpoints. | openapi-3.1.yaml |

### The key trick

The server saves the AI's response **chunk by chunk** (every time a new word arrives). This happens inside the stream loop, *before* checking if the client is still listening. So even if the client disappears, the partial text is already in the database.

---

## 2. Strategies chosen and why

### Strategy 1: Observable with `isActive()` flag instead of RxJS Subject

**What was planned:** Use a `Subject` (a "hot stream" that can be re-subscribed to) so reconnecting clients could pick up where they left off.

**What was built:** A plain `Observable` with a `cancelled` boolean. When the client disconnects, `cancelled` flips to `true`. The stream loop checks `cancelled` before *sending* events to the client, but continues *saving* content regardless.

**Why:** Simpler. The client doesn't need to "re-subscribe" to a hot stream — it just calls `GET /v1/conversations/:id` to read the persisted message. Same result, less complexity.

### Strategy 2: Message.status column instead of a separate Generation table

**What was planned:** Could have created a new `generations` table to track active generations separately from messages.

**What was built:** Added a `status` column directly on the existing `messages` table. No new tables.

**Why:** The plan explicitly said "No Generation entity — use Message.status instead." Flat data, no joins, simpler queries.

### Strategy 3: Retry creates a new message (Option B)

**What was built:** When the user retries a failed response, the system creates a *brand new* assistant message with `status = 'streaming'`. The old failed message stays in the conversation history.

**Why:** The frontend gets both messages and can show the user "this one failed, this one is the retry." Cleaner UX, no data loss.

### Strategy 4: Content saved outside the disconnect guard

This is the most important architectural choice. The stream loop does:

```
for each chunk from the AI:
    fullResponse += chunk
    save fullResponse to database          ← always happens
    if client is still connected:
        send chunk to client               ← only if connected
```

This guarantees that disconnect = partial data saved, not partial data lost.

---

## 3. How to verify the changes work

### Run all tests

```bash
# Unit tests (26 tests)
npx jest test/unit/message-status.spec.ts test/unit/conversations-streaming-methods.spec.ts test/unit/chat.service.spec.ts --no-coverage

# Integration tests (70 tests)
npx jest test/integration --no-coverage

# Everything together
npm test
```

### Manual verification via API

**1. Check that messages have a status field:**
```bash
curl -H "Authorization: Bearer <token>" http://localhost:3000/v1/conversations/<id>
```
Look for `"status": "completed"` on assistant messages.

**2. Test the 409 conflict (active generation):**
```bash
# Start a generation, then immediately try another one on the same conversation
curl -X POST http://localhost:3000/v1/chat/stream \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"message": "hello", "conversationId": "<id>"}'
# Second call should return 409 with {"code": "generation_in_progress"}
```

**3. Test cancel:**
```bash
# Create a conversation with a streaming message in the DB, then:
curl -X POST http://localhost:3000/v1/chat/<conv-id>/cancel \
  -H "Authorization: Bearer <token>"
# Should return {"messageId": "...", "status": "cancelled"}
```

**4. Test retry:**
```bash
curl -X POST http://localhost:3000/v1/chat/<conv-id>/retry \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"failedMessageId": "<msg-id>"}'
# Should return {"messageId": "<new-id>", "status": "streaming"}
```

### Database verification

```bash
# Check the migration applied correctly
sqlite3 data/app.sqlite "PRAGMA table_info(messages);"
# Should show a 'status' column with default 'completed'

sqlite3 data/app.sqlite "SELECT status, COUNT(*) FROM messages GROUP BY status;"
# Should show status distribution
```

---

## 4. How to report issues or feedback

### If something breaks

1. **Check the logs first:** `logs/app.log` — look for `[ChatService]` errors. The streaming code logs provider errors and setup errors with structured JSON.

2. **Reproduce with a minimal test:** Add a test case to the appropriate spec file. The unit tests for streaming are in `test/unit/chat.service.spec.ts` and `test/unit/conversations-streaming-methods.spec.ts`.

3. **Check the status field:** If messages aren't being persisted correctly, query the DB directly:
   ```sql
   SELECT id, role, status, LENGTH(content) as content_len FROM messages WHERE conversation_id = '<id>' ORDER BY created_at;
   ```
   A streaming message should show `status = 'streaming'` with partial content length. After the stream finishes, it should flip to `completed`.

### What to include in a bug report

- The endpoint called and the request body
- The response status and body
- The relevant log lines from `logs/app.log`
- The message status in the database at the time of the issue
- Whether the client disconnected during the stream (if applicable)

---

## 5. What to expect and what NOT to expect

### What to expect

| Behavior | Why |
|---|---|
| Disconnecting mid-stream **does not lose the response** | Content is saved chunk-by-chunk to the DB |
| Reconnecting and fetching the conversation shows the **full or partial response** | The saved content is returned by GET /v1/conversations/:id |
| Calling the stream endpoint while one is already running returns **409** | The `findStreamingMessage` check blocks duplicates |
| Cancel works — the message becomes `cancelled` and the partial text is preserved | `cancelGeneration` flips the status; the background stream keeps saving |
| Retry creates a **new message** with the same conversation | `retryGeneration` inserts a fresh row; old message stays in history |
| Failed generations show `status = 'failed'` | The catch block in `runStream` updates the status |

### What NOT to expect

| Expectation | Reality |
|---|---|
| **Re-subscribing to the stream picks up where it left off** | No. The Observable is one-shot. Reconnect by fetching the conversation via GET. |
| **Cancel stops the AI immediately** | No. The server continues calling the provider API until it finishes (to persist the partial result). It just stops sending events to the disconnected client. |
| **Retry re-sends the old message content** | No. Retry creates a blank new message. The old failed message stays as-is for history. |
| **Two simultaneous generations on the same conversation** | Blocked at the service layer (409), but this is not a database constraint — there's a tiny race window. For MVP this is acceptable. |
| **Stream timeout on slow providers** | Not implemented yet. A stuck provider stream runs until it resolves or errors. |
| **Automatic retry on failure** | Not implemented. Users must manually call the retry endpoint. |

---

## 6. Architecture diagram (text)

```
Client                  Server (NestJS)              Provider (OpenAI-compatible)
  |                           |                              |
  |-- POST /v1/chat/stream -->|                              |
  |                           |-- create message (streaming) |
  |                           |-- call provider.stream() -->|
  |                           |                              |
  |                           |<-- chunk 1 -----------------|
  |                           |-- save partial content -----|
  |                           |-- send delta to client ---->|  (if connected)
  |                           |                              |
  |   [disconnect]            |                              |
  |   (client gone)           |<-- chunk 2 -----------------|
  |                           |-- save partial content -----|
  |                           |-- (no send, client gone)     |
  |                           |                              |
  |                           |<-- chunk 3 ... done ---------|
  |                           |-- save full content ---------|
  |                           |-- update status=completed   |
  |                           |                              |
  |-- GET /v1/conversations ->|                              |
  |<-- message (completed) ---|                              |
```

---

## 7. Rollback plan

If this needs to be reverted:

1. Revert the migration: the `down()` method in `1700000002000-add-message-status.ts` removes the `status` column (recreates the table without it on SQLite).
2. Remove `status` from `MessagePublicDto`, `Message` entity, and controller.
3. Remove the 5 new service methods and 2 new controller endpoints.
4. Revert `chat.service.ts` to the Observable-teardown pattern.

The migration's `down()` handles the database side. All code changes are in the working tree and can be reverted with git.

---

*Report generated from the execution of `docs/superpowers/plans/2026-09-16-persistent-chat-resumable-streaming.md`.*
