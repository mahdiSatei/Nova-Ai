# Manifest — `2026-09-14-persist-streaming-on-disconnect`

> Implementation report for the plan
> [`2026-09-14-persist-streaming-on-disconnect.md`](../plans/2026-09-14-persist-streaming-on-disconnect.md).
> This file is the **post-execution** companion to the plan; it records
> what actually shipped, what deviated from the plan, and the operator
> handoff commands (commit + test).

**Plan date:** 2026-09-14
**Executed:** 2026-09-15
**Executor branch:** `persist-stream` (worktree base: `develop`)
**Executor:** Claude (via `superpowers:executing-plans`)

---

## Plain English — what the fix does and how the test proves it

### The bug we were fixing

Imagine you ask the chatbot a question. The chatbot starts typing its answer back to you, word by word, over a live connection (like a chat window that updates in real time).

**Before the fix:** if you closed the browser tab, lost your network, or refreshed the page while the chatbot was *still typing*, the server would kill the response mid-sentence and save nothing. You'd come back to the conversation history and find your question but **no answer at all** — as if you had never asked.

**After the fix:** even if you slam the tab shut mid-response, the server keeps generating the full answer in the background and saves it. When you come back and open the conversation, you see the complete answer sitting there, just like if you had stayed.

### How the fix works (in plain words)

Think of the server as having **two separate jobs** that used to be glued together:

1. **Talking to the browser** — pushing each new word out as it's generated.
2. **Saving the full answer** — once it's all done, writing it to the database.

Before, both jobs lived in one task. When the browser went away, the whole task got cancelled — so job #2 never finished, and the answer was lost.

The fix **splits them apart**:

- A new background task (`runStream`) is in charge of job #2 (the saving). It runs **independently** of the browser connection. Once it starts, nothing the browser does can stop it. When the streaming is done (whether the AI finished naturally, errored out, or the browser disconnected), the background task saves whatever it has.
- The old connection object (`observer`) is now just a **postman**: every time the background task produces a new word, the postman tries to deliver it to the browser — but only **if the browser is still listening**. If the browser already left, the postman just throws that word in the trash and moves on.

A single boolean flag — `clientConnected` — is the bouncer at the door. When the browser disconnects, RxJS flips it to `false`. From that point, no more words get sent to the now-empty socket. But the background task keeps chugging along and writes the whole answer to the database.

This is also good for safety: if the AI provider itself crashes halfway through (after the user has already left), whatever part *was* generated still gets saved — so the user sees something on return, not nothing.

### How the e2e test proves it works

The test acts like a real user who disconnects mid-chat. Step by step:

1. **Boot a real NestJS server** with a fake AI provider baked in. The fake provider yields three words — "Hello", " ", "world" — 30 milliseconds apart.
2. **Open a chat connection** from a raw HTTP client (we can't use the usual test helper because it buffers everything until the end — useless for testing mid-stream behavior).
3. **Wait for the first word "Hello"** to actually arrive on the wire. This is our signal that the server is mid-response and the user could plausibly close the tab.
4. **Slam the connection shut** — same as if the user clicked the X on their browser tab.
5. **Wait a moment** (300 ms) for the server to finish its background work — consuming the remaining " " and "world" chunks and saving the answer.
6. **Reload the conversation history** via a normal HTTP GET request. The conversation list comes back, ordered with the newest first.
7. **Open the newest conversation** and look at its messages.
8. **Assert:** there's exactly one assistant message, and its content is `"Hello world"` — the *full* answer, not just `"Hello"` (which is all the user actually saw before disconnecting).

If the fix weren't in place, step 8 would fail: either there'd be no assistant message at all (the bug we were fixing), or its content would be truncated to just `"Hello"` (because the old code would have aborted everything on disconnect).

---

## What was done

### Task 1 — Decouple consume-and-persist from Observable lifecycle in `ChatService` ✅

**Status:** already committed before this manifest.

- Commit: `5e95357 feat(chat): persist full assistant response even when client disconnects`
- `src/modules/chat/chat.service.ts` — full refactor in place. `streamChat` returns an Observable with a `clientConnected` flag; the private `runStream(userId, dto, observer, isClientConnected)` owns the detached consume-and-persist task; every `observer.next` is guarded; the consume-phase `finally` persists the full response via `conversations.appendMessage(conversationId, fullResponse)`.
- `test/unit/chat.service.spec.ts` — three "client disconnect mid-stream" cases present:
  - persists the FULL assistant response even when the client unsubscribes mid-stream
  - emits no SSE events to the observer after the client has unsubscribed
  - persists the partial response if the provider errors mid-stream after the client disconnected

### Task 2 — Integration test: full response persisted across client disconnect ✅

**Status:** done in this execution session. **Not yet committed.**

- File touched: `test/integration/chat.stream.e2e.spec.ts`
- New test added: `persists the FULL assistant response when the client disconnects mid-stream`
- Three adjustments from the literal plan, all forced by the runtime:
  1. **Raw `http.request` instead of supertest.** supertest buffers SSE responses and only releases them when the stream ends, so a mid-stream `req.abort()` would arrive *after* the full response was already buffered. Verified: raw http delivers the first chunk at ~15 ms vs. ~145 ms end-to-end under supertest.
  2. **Seeded `AppConfig.defaultModelId = 'model-1'`.** `ModelsService.resolveActiveModel` reads `app_config.default_model_id`, not `Model.isDefault`. Without seeding, the new test would resolve to `no_model_available` and persist nothing. The same trick is used by `conversations.e2e.spec.ts` (lines 89–95).
  3. **Bumped chunk delay 0 → 30 ms** so the test has a window to abort between chunks; the existing buffered-mode tests still pass since supertest waits for response end.
- Also bound the Nest server to a real port (`await app.listen(0)`) so the raw http client can connect. Other tests in the file still use `app.getHttpServer()` through supertest, which works either way.
- Removed the obsolete `test/integration/debug-sse.mjs` (leftover diagnostic from a previous round; not picked up by jest's `.ts` glob anyway).

### Task 3 — Document the disconnect-resilience behavior ✅

**Status:** already committed before this manifest.

- Commit: `c5331fa docs(chat): document disconnect-resilience semantics`
- `specs/001-multi-model-chatbot-mvp/spec.md` (lines 126–132) — US3 scenario 3 tightened.
- `specs/001-multi-model-chatbot-mvp/api-contract.md` (lines 239–255) — "Disconnect resilience" section added to §3.8.
- `specs/001-multi-model-chatbot-mvp/contracts/openapi.yaml` (lines 246–263) — `/v1/chat/stream` description updated.

### Task 4 — Final verification ✅

**Status:** done in this execution session. **Not yet committed.**

- `npx tsc --noEmit` — exit 0, no errors.
- `npx eslint test/integration/chat.stream.e2e.spec.ts` — exit 0, no errors.
- `npx jest --runInBand` — **21 suites, 143 tests passed, 0 failed**.
- `npm run build` — exit 0, `dist/` populated.

---

## Diff scope (uncommitted changes)

```
backend/test/integration/chat.stream.e2e.spec.ts | +110 -1
backend/test/integration/debug-sse.mjs           | deleted
```

---

## Operator handoff — approve + commit + verify

The executor (an agent) cannot run git operations per `CLAUDE.md` §"Agents do not touch git". The human operator runs the commands below from `backend/`.

### 1. Review the diff

```bash
cd "M:/projects/codeless college/Final Project/part-chat-persist-stream-develop/backend"
git diff HEAD
git status
```

### 2. Approve and commit

Suggested commit message (also printed at the end of the executor's report):

```
test(chat): e2e coverage for full-response persistence across disconnect

- Add new e2e case: read the SSE stream until the first delta, abort
  the HTTP connection, then assert GET /v1/conversations/:id shows the
  FULL assistant message ("Hello world"), not the truncated text
  captured at disconnect time
- Drive the stream via raw http.request against a bound server, because
  supertest buffers SSE responses end-to-end and cannot deliver chunks
  in real-time (verified: first chunk arrives at ~15 ms via raw http
  vs. 145 ms total under supertest)
- Bump the OpenAICompatibleClient override chunk delay 0 -> 30 ms so
  the test has a window to abort between chunks; the buffered-mode
  tests above still pass since supertest waits for response end
- Seed AppConfig.defaultModelId = 'model-1' in beforeAll: ModelsService
  resolves the admin default from app_config, not from Model.isDefault,
  so without this the new test would have hit no_model_available and
  persisted nothing
- Bind the Nest server to a real port via app.listen(0) so the raw
  http client can connect (other tests in this file still use
  app.getHttpServer() through supertest, which works either way)
- Confirms the detached consume-and-persist task from commit 5e95357
  flows all the way through NestJS HTTP -> ChatService ->
  ConversationsService -> SQLite even when the client aborts mid-stream
- Remove the leftover debug-sse.mjs diagnostic file
```

```bash
git add backend/test/integration/chat.stream.e2e.spec.ts backend/test/integration/debug-sse.mjs
git commit -m "test(chat): e2e coverage for full-response persistence across disconnect"
```

### 3. Run the test suite yourself

The executor already ran everything green, but the operator can re-run to confirm on their machine:

```bash
cd "M:/projects/codeless college/Final Project/part-chat-persist-stream-develop/backend"

# Unit + integration (Jest). Uses --runInBand so SQLite files don't collide.
npm test -- --runInBand

# Just the new test
npx jest test/integration/chat.stream.e2e.spec.ts -t "persists the FULL assistant response when the client disconnects mid-stream"

# Just the related unit tests (Task 1's three disconnect cases)
npx jest test/unit/chat.service.spec.ts -t "client disconnect"

# Type check + lint + build
npx tsc --noEmit
npm run lint
npm run build
```

**Expected results:**
- `npm test -- --runInBand` → 21 suites, 143 tests passed.
- The new e2e → passes in ~400 ms.
- The 3 unit "client disconnect" cases → all pass.
- `tsc`, `eslint`, `nest build` → all exit 0.

### 4. (Optional) Manual smoke test against a running server

If you want to see the behavior end-to-end outside the test runner:

```bash
npm run start:dev
# In another terminal, register a user, get a JWT, then open a chat
# stream and close the browser tab mid-stream. The full assistant
# response should still appear in GET /v1/conversations/:id.
```

---

## Cross-references

- Plan: [`../plans/2026-09-14-persist-streaming-on-disconnect.md`](../plans/2026-09-14-persist-streaming-on-disconnect.md)
- Spec section: `specs/001-multi-model-chatbot-mvp/spec.md` US3 scenario 3, FR-005, FR-013
- API contract: `specs/001-multi-model-chatbot-mvp/api-contract.md` §3.8 "Disconnect resilience"
- OpenAPI: `specs/001-multi-model-chatbot-mvp/contracts/openapi.yaml` `/v1/chat/stream` description
- Implementation: `src/modules/chat/chat.service.ts` `runStream` (private method)
- Unit tests: `test/unit/chat.service.spec.ts` "client disconnect mid-stream" describe
- Integration test: `test/integration/chat.stream.e2e.spec.ts` "persists the FULL assistant response when the client disconnects mid-stream"
