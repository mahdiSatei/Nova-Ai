# Persist Streaming Response on Client Disconnect — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the SSE client disconnects mid-stream (network drop, tab close, refresh), keep generating the assistant response server-side and persist the **full** response to the conversation history so the user can read it on return. Do **not** cancel the upstream provider call when the client goes away.

**Architecture:** Detach the consume-and-persist task from the SSE socket's lifecycle. `ChatService.streamChat` returns an Observable whose only role is to forward delta events to the (possibly disconnected) client. A private async `runStream` method runs in the background, consumes the provider stream to completion, and persists the accumulated assistant text via `ConversationsService.appendMessage` in its `finally` block. A `clientConnected` boolean guards `observer.next(...)` calls so we don't write to a closed socket — but the consume loop and the persistence call always run to the end.

**Tech Stack:** NestJS 10, RxJS 7 (`@Sse()` Observable + teardown via `unsubscribe`), `openai` SDK v4 (no `AbortSignal` needed), TypeORM 0.3 (existing `Message` entity), Jest + Supertest.

**Spec:** `specs/001-multi-model-chatbot-mvp/spec.md` US3 scenario 3, FR-005, FR-013; `specs/001-multi-model-chatbot-mvp/api-contract.md` §3.8 SSE event shapes.

## Global Constraints

These apply to every task. Copied from `CLAUDE.md` and `specs/001-multi-model-chatbot-mvp/plan.md` §Technical Choices — non-negotiable.

- All source, tests, config, and docs produced by backend agents MUST live under `backend/`. No edits outside `backend/`.
- **Agents do not touch git.** No `git add`, `git commit`, `git push`, `git checkout`, `git reset`, branch creation, tagging, or remote interaction. Every change that warrants a commit MUST be paired with a `Suggested commit message:` block in the agent's reply. The human operator commits.
- Test-alongside quality: tests MUST be authored in the same change set as the implementation they cover and MUST pass before the change is mergeable. Tests are MANDATORY for business logic in domain services and for public API endpoints.
- API-first design: REST + JSON + OpenAPI 3.0.3 (committed at `backend/specs/001-multi-model-chatbot-mvp/contracts/openapi.yaml`). SSE is the existing transport for `POST /v1/chat/stream`; this plan does not introduce a new endpoint.
- Input validation: `class-validator` at the system boundary (already wired in `src/main.ts:33-40`). No new validation in this plan.
- Error envelopes: sanitized via the global `AllExceptionsFilter` (`src/common/filters/all-exceptions.filter.ts`). No stack traces leaked to API responses.
- Logging: structured JSON via `nestjs-pino`. New log lines MUST be key/value form, no PII, no `content` payloads.
- TypeORM is mandatory; no raw SQL in HTTP handlers or domain logic.
- Stack consistency: NestJS 10, TypeORM 0.3, `openai` SDK v4, RxJS 7 — already locked. Do not introduce new third-party deps for this plan.
- Naming: TypeScript identifiers and JSON fields are `camelCase`; error-code strings in `event: error` payloads are `snake_case` per `api-contract.md` §4.1.
- Existing `ChatService` contract with callers (controller, `ConversationsService`) MUST stay source-compatible: `streamChat(userId, dto): Observable<ChatStreamEvent>` keeps its signature. Internal-only refactor.
- The SSE wire format (`{data: {delta}}`, `{event: 'done', data: {}}`, `{event: 'error', data: {code, message}}`) is unchanged. No new public API endpoint is introduced.
- No `AbortController` / `AbortSignal` is introduced. The upstream provider call is never cancelled by client state in this plan.

---

## File Structure

This plan touches existing files only; no new modules, controllers, DTOs, entities, or migrations are introduced.

| File | Role in this plan |
|---|---|
| `src/modules/chat/chat.service.ts` | Refactors `streamChat` and `consumeStream` so the consume-and-persist task runs detached from the Observable's lifecycle. Adds a `clientConnected` flag so writes to a closed SSE socket are skipped while persistence continues. |
| `test/unit/chat.service.spec.ts` | Adds unit tests for disconnect-during-stream persistence (full response persisted) and for the regression of the happy path (all deltas still received when connected). |
| `test/integration/chat.stream.e2e.spec.ts` | Adds an integration test that simulates a client disconnect mid-stream and asserts the **full** assistant message lands in `messages` via `GET /v1/conversations/:id`. |
| `specs/001-multi-model-chatbot-mvp/spec.md` | Tightens US3 acceptance scenario 3 to make the new persistence-on-disconnect behavior normative. |
| `specs/001-multi-model-chatbot-mvp/api-contract.md` | Adds a paragraph to §3.8 documenting the disconnect semantics (server keeps generating, persists full response). |
| `specs/001-multi-model-chatbot-mvp/contracts/openapi.yaml` | Adds a one-line description note to `/v1/chat/stream` describing persistence on disconnect. |

`src/modules/chat/provider/openai-compatible.client.ts` is **not** modified in this plan. The previous draft introduced an `AbortSignal` parameter on `stream()`; that work is dropped — YAGNI.

No new files are created.

---

## Task 1: Decouple consume-and-persist from Observable lifecycle in ChatService

**Files:**
- Modify: `src/modules/chat/chat.service.ts:51-228` — replace `streamChat` and `consumeStream`. The new design uses a private `runStream` helper that owns the consume loop and persistence; `streamChat` returns an Observable that only forwards events while the client is connected, and whose `unsubscribe` teardown just flips a boolean flag.
- Test: `test/unit/chat.service.spec.ts` — extend with three new cases (see Step 1).

**Interfaces:**
- Consumes: `OpenAICompatibleClient.stream(params)` (unchanged from current `master` — single argument, no signal).
- Produces: same public `ChatService.streamChat(userId, dto)` signature. The private helper is renamed from `consumeStream(...)` to `runStream(userId, dto, observer, isClientConnected)` and takes a callback rather than an abort flag.
- `ConversationsService.appendMessage(conversationId, content)` is still the only persistence entry point; no new method is introduced.

- [ ] **Step 1: Write the failing tests**

Append the following `describe` block to the bottom of `test/unit/chat.service.spec.ts` (just before the closing brace of the outer `describe('ChatService', ...)`):

```ts
  // ─── client-disconnect resilience ─────────────────────────────────────

  describe('client disconnect mid-stream', () => {
    /**
     * Build an async iterable that yields the given chunks with a delay
     * between each, then signals done. The consumer side keeps reading
     * regardless of any subscriber state, mimicking the production
     * OpenAI SDK behavior under the new "don't abort" contract.
     */
    function buildSlowStream(chunks: string[], delayMs: number) {
      return (async function* () {
        for (const c of chunks) {
          await new Promise((r) => setTimeout(r, delayMs));
          yield { choices: [{ delta: { content: c } }] } as any;
        }
      })();
    }

    it('persists the FULL assistant response even when the client unsubscribes mid-stream', async () => {
      // Arrange
      models.resolveActiveModel.mockResolvedValue({
        id: 'm1',
        actualName: 'gpt-4o',
        enabled: true,
        isDefault: true,
      } as any);
      conversations.create.mockReturnValue({ id: 'conv-1', messages: [] });

      // Three chunks, 30 ms apart. After ~45 ms the first two have been
      // yielded; the test unsubscribes then and waits long enough for
      // the third to also be consumed and persisted.
      providerClient.stream.mockResolvedValue(
        buildSlowStream(['Hello', ' ', 'world'], 30),
      );

      // Act
      const obs = svc.streamChat('user-1', { message: 'Hi' });
      const events: any[] = [];
      const sub = obs.subscribe({ next: (e) => events.push(e) });

      // Wait until at least one delta has been received.
      await new Promise((r) => setTimeout(r, 45));
      expect(events.some((e: any) => 'data' in e && !('event' in e))).toBe(true);

      // Simulate client disconnect.
      sub.unsubscribe();

      // Wait long enough for the consume loop to finish all three chunks
      // and the finally block to persist.
      await new Promise((r) => setTimeout(r, 200));

      // Assert: the FULL response was persisted, not a truncated one.
      expect(conversations.appendMessage).toHaveBeenCalledTimes(1);
      expect(conversations.appendMessage).toHaveBeenCalledWith('conv-1', 'Hello world');
    });

    it('emits no SSE events to the observer after the client has unsubscribed', async () => {
      // Arrange
      models.resolveActiveModel.mockResolvedValue({
        id: 'm1',
        actualName: 'gpt-4o',
        enabled: true,
        isDefault: true,
      } as any);
      conversations.create.mockReturnValue({ id: 'conv-2', messages: [] });
      providerClient.stream.mockResolvedValue(
        buildSlowStream(['a', 'b', 'c', 'd'], 30),
      );

      // Act
      const obs = svc.streamChat('user-1', { message: 'Hi' });
      const events: any[] = [];
      const sub = obs.subscribe({ next: (e) => events.push(e) });
      await new Promise((r) => setTimeout(r, 45));
      const eventsBeforeDisconnect = events.length;

      sub.unsubscribe();
      await new Promise((r) => setTimeout(r, 200));

      // Assert: no further events were emitted after unsubscribe.
      expect(events.length).toBe(eventsBeforeDisconnect);

      // Persistence still happened, with the full content.
      expect(conversations.appendMessage).toHaveBeenCalledWith('conv-2', 'abcd');
    });

    it('persists the partial response if the provider errors mid-stream after the client disconnected', async () => {
      // Arrange: a stream that yields one chunk, then throws a provider
      // error on the next iteration. The client is already gone when the
      // error fires.
      models.resolveActiveModel.mockResolvedValue({
        id: 'm1',
        actualName: 'gpt-4o',
        enabled: true,
        isDefault: true,
      } as any);
      conversations.create.mockReturnValue({ id: 'conv-3', messages: [] });

      const erroringStream = (async function* () {
        yield { choices: [{ delta: { content: 'partial' } }] } as any;
        await new Promise((r) => setTimeout(r, 30));
        throw new Error('upstream blew up');
      })();
      providerClient.stream.mockResolvedValue(erroringStream);

      // Act
      const obs = svc.streamChat('user-1', { message: 'Hi' });
      const sub = obs.subscribe({ next: () => {} });
      await new Promise((r) => setTimeout(r, 15));
      sub.unsubscribe();
      await new Promise((r) => setTimeout(r, 200));

      // Assert: the partial content observed before the error was persisted.
      expect(conversations.appendMessage).toHaveBeenCalledTimes(1);
      expect(conversations.appendMessage).toHaveBeenCalledWith('conv-3', 'partial');
    });
  });
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx jest test/unit/chat.service.spec.ts -t "client disconnect"`
Expected: all three new tests FAIL. The first test fails because the current code's `abortedRef.value` flag is broken (the wrapper object was constructed with `{ value: aborted }` and never updated), AND because the current `unsubscribe()` only flips a flag that doesn't propagate, so the consume loop's `if (abortedRef.value) break;` never breaks. The loop does run to completion in this specific mock (because the mock is fast), so the first test may actually pass on the persistence assertion — but the second test will fail because observer.next is still called after unsubscribe (no `isClientConnected` guard), and the third test will fail because the catch block emits `event: error` after the client has gone. In any case, at least the second and third cases fail, demonstrating the gap.

(If the first test happens to pass on the happy-path mock timing, that's coincidental — it does not invalidate the plan; the second and third tests still drive the refactor.)

- [ ] **Step 3: Refactor `ChatService.streamChat` and `consumeStream`**

In `src/modules/chat/chat.service.ts`, replace the body of `streamChat` (currently lines 71–175) and the entire `consumeStream` private method (currently lines 186–227) with the implementation below. Keep the rest of the file (imports, `updateUserLastSelectedModel`, the `Logger` field, the constructor, the `ChatMessage` interface, the `ChatStreamEvent` types) untouched.

```ts
  /**
   * Stream a chat completion as an RxJS Observable of SSE events.
   *
   * The controller returns this Observable synchronously to the
   * `@Sse()` decorator. All async setup (model resolution, provider
   * check, conversation creation) and the consume-and-persist loop run
   * inside `runStream`, which is launched as a detached background
   * task via `void runStream(...)`.
   *
   * **Disconnect resilience**: when the client unsubscribes (browser
   * closed, network dropped, refresh), the RxJS teardown flips
   * `clientConnected` to false. From that point on, `runStream` stops
   * forwarding events to the observer (its socket is gone — we must
   * not write to it), but it keeps consuming the provider stream and
   * persists the FULL assistant response via
   * `ConversationsService.appendMessage` once the consume loop exits
   * for any reason (normal completion, provider error, or stream end).
   *
   * The user can read the persisted message via `GET /v1/conversations/:id`
   * after the response is complete.
   */
  streamChat(userId: string, dto: ChatRequestDto): Observable<ChatStreamEvent> {
    return new Observable<ChatStreamEvent>((observer) => {
      let clientConnected = true;

      // Kick off the detached consume-and-persist task. It runs to
      // completion regardless of whether anyone is still subscribed.
      void this.runStream(userId, dto, observer, () => clientConnected);

      // Teardown: when the client disconnects (or the Observable is
      // unsubscribed for any other reason), mark the client as gone.
      // The consume loop will continue running and persist the full
      // response, but will skip writing SSE events to the closed socket.
      return () => {
        clientConnected = false;
      };
    });
  }

  // ─────────────────────────────── private ─────────────────────────────────

  private async updateUserLastSelectedModel(userId: string, modelId: string): Promise<void> {
    await this.userRepo.update({ id: userId }, { lastSelectedModelId: modelId });
  }

  /**
   * Background task that owns the consume-and-persist flow.
   *
   * Persistence contract: in the inner `finally` block, whatever
   * assistant text was accumulated into `fullResponse` is appended to
   * the conversation via `ConversationsService.appendMessage` — even
   * if the client has long since disconnected. An empty `fullResponse`
   * (zero tokens observed before the stream ended) is NOT persisted.
   *
   * The `isClientConnected` callback guards every `observer.next(...)`
   * call so we never write to a closed SSE socket.
   */
  private async runStream(
    userId: string,
    dto: ChatRequestDto,
    observer: { next: (e: ChatStreamEvent) => void; complete: () => void },
    isClientConnected: () => boolean,
  ): Promise<void> {
    let conversationId: string | undefined;
    let fullResponse = '';

    try {
      // ── setup phase ─────────────────────────────────────────────────
      // 1. Resolve the active model.
      const model = await this.models.resolveActiveModel({
        explicitModelId: dto.modelId ?? null,
        userId,
      });
      if (!model) {
        if (isClientConnected()) {
          observer.next({
            event: 'error',
            data: {
              code: 'no_model_available',
              message: 'No model is available. Ask an admin to set a default model or select one explicitly.',
            },
          });
        }
        observer.complete();
        return;
      }

      // 2. Verify central provider is configured.
      try {
        await this.providerClient.getClient();
      } catch {
        if (isClientConnected()) {
          observer.next({
            event: 'error',
            data: {
              code: 'provider_not_configured',
              message: 'Central provider is not configured. Ask an admin to set it up.',
            },
          });
        }
        observer.complete();
        return;
      }

      // 3. Validate message length (FR-014).
      if (dto.message.length < 1 || dto.message.length > 32000) {
        if (isClientConnected()) {
          observer.next({
            event: 'error',
            data: { code: 'invalid_message', message: 'Message must be 1..32000 characters.' },
          });
        }
        observer.complete();
        return;
      }

      // 4. Resolve or create conversation.
      let priorTurns: ChatMessage[];
      if (dto.conversationId) {
        const existing = await this.conversations.findById(dto.conversationId);
        if (!existing) {
          if (isClientConnected()) {
            observer.next({
              event: 'error',
              data: { code: 'conversation_not_found', message: 'Conversation not found.' },
            });
          }
          observer.complete();
          return;
        }
        conversationId = existing.id;
        priorTurns = existing.messages.map(
          (m) => ({ role: m.role as ChatMessage['role'], content: m.content }),
        );
      } else {
        const conv = await this.conversations.create({
          userId,
          modelId: model.id,
          userMessage: dto.message,
        });
        conversationId = conv.id;
        priorTurns = [{ role: 'user', content: dto.message }];
      }

      // 5. Persist sticky model choice (fire-and-forget).
      this.updateUserLastSelectedModel(userId, model.id).catch(() => {
        this.logger.warn(`Failed to update lastSelectedModelId for user ${userId}`);
      });

      // 6. Build the messages array for the provider (FR-015).
      const providerMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        ...priorTurns,
        { role: 'user', content: dto.message },
      ];

      // ── consume phase ───────────────────────────────────────────────
      try {
        const stream = await this.providerClient.stream({
          model: model.actualName,
          messages: providerMessages,
        });

        for await (const chunk of stream as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>) {
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) {
            fullResponse += delta;
            if (isClientConnected()) {
              observer.next({ data: { delta } });
            }
          }
        }

        if (isClientConnected()) {
          observer.next({ event: 'done', data: {} });
        }
      } catch (err) {
        this.logger.error(
          `Provider stream error: ${err instanceof Error ? err.message : String(err)}`,
        );
        if (isClientConnected()) {
          observer.next({
            event: 'error',
            data: {
              code: 'provider_error',
              message: 'The model provider returned an error.',
            },
          });
        }
      } finally {
        // Persistence ALWAYS runs in the consume-phase finally, even if
        // the client disconnected long ago. This is the core invariant
        // of this plan: the user's message is not lost to a network
        // failure, tab close, or page refresh.
        if (fullResponse && conversationId) {
          await this.conversations.appendMessage(conversationId, fullResponse);
        }
        observer.complete();
      }
    } catch (err) {
      // Setup-phase catch (errors from model resolution / DB lookups,
      // not from the provider stream itself).
      this.logger.error(
        `Chat setup error: ${err instanceof Error ? err.message : String(err)}`,
      );
      if (isClientConnected()) {
        observer.next({
          event: 'error',
          data: { code: 'internal_error', message: 'An unexpected error occurred.' },
        });
      }
      observer.complete();
    }
  }
```

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `npx jest test/unit/chat.service.spec.ts -t "client disconnect"`
Expected: PASS for all three new cases.

- [ ] **Step 5: Run the full unit suite to confirm no regression**

Run: `npm test -- --testPathPattern='test/unit'`
Expected: all unit tests green. The pre-existing "happy path — new conversation", "existing conversation", "no model available", and "empty message" cases all continue to pass because the consume task still drives the Observable to completion when the client stays connected.

- [ ] **Step 6: Append a suggested commit message**

```
Suggested commit message:
feat(chat): persist full assistant response even when client disconnects

- Detach the consume-and-persist task from the SSE Observable's
  lifecycle: a private `runStream` runs as a background task via
  `void runStream(...)` and is no longer cancelled when the client
  unsubscribes
- Track client connection via a boolean flag (closure over the
  Observable's `clientConnected` variable); flip it to false in the
  Observable's teardown
- Every `observer.next(...)` is guarded by `isClientConnected()` so
  we never write to a closed SSE socket
- The consume-phase `finally` block persists the FULL accumulated
  assistant text via `ConversationsService.appendMessage`,
  regardless of how the loop exited (normal completion, provider
  error, or client disconnect mid-stream)
- Replaces the prior broken `aborted` snapshot flag (which was
  captured by value and never propagated from the teardown to the
  consume loop)
- Drop the earlier AbortController/AbortSignal design — YAGNI.
  The upstream provider call is never cancelled by client state.
```

---

## Task 2: Integration test — full response persisted across client disconnect

**Files:**
- Modify: `test/integration/chat.stream.e2e.spec.ts` — add a new `it` block that simulates a client disconnect mid-stream and asserts the FULL assistant message lands in `messages` via `GET /v1/conversations/:id`. Also override `OpenAICompatibleClient` with a chunk-yielding fake.

**Interfaces:**
- Consumes: existing `AppModule` boot fixture (already set up in `beforeAll`), `OpenAICompatibleClient.stream()` override (added in this task), and the new `runStream` wiring from Task 1.
- Produces: an additional passing e2e case that exercises the full NestJS HTTP → SSE → ChatService → provider-mock → DB → conversation-read path under a simulated disconnect.

- [ ] **Step 1: Add the failing e2e case**

Replace the `beforeAll` block in `test/integration/chat.stream.e2e.spec.ts` so the test module overrides `OpenAICompatibleClient` with a fake that yields three chunks slowly. Concretely:

(a) At the top of the file, add these imports (preserve any existing imports from this file):

```ts
import { OpenAICompatibleClient } from '../../src/modules/chat/provider/openai-compatible.client';
import { CentralProvider as CentralProviderEntity } from '../../src/modules/provider/entities/central-provider.entity';
import { decrypt } from '../../src/common/crypto/credential-cipher';
import OpenAI from 'openai';
```

(b) Add a shared holder above `describe(...)`:

```ts
const providerMock = {
  yieldChunks: async function* (chunks: string[], delayMs: number) {
    for (const c of chunks) {
      await new Promise((r) => setTimeout(r, delayMs));
      yield { choices: [{ delta: { content: c } }] } as any;
    }
  },
};
```

(c) Replace the existing `Test.createTestingModule({ imports: [AppModule] }).compile()` block with a version that also overrides `OpenAICompatibleClient`. Build a real `OpenAI` client from the seeded `CentralProvider` row so `getClient()` still works for the existing tests:

```ts
const baseModuleRef: TestingModule = await Test.createTestingModule({
  imports: [AppModule],
}).compile();

const centralProviderRepo = baseModuleRef.get(
  baseModuleRef.get<any>('Repository<CentralProviderEntity>').constructor === Object
    ? baseModuleRef.get(require('@nestjs/typeorm').getRepositoryToken(CentralProviderEntity))
    : baseModuleRef.get(require('@nestjs/typeorm').getRepositoryToken(CentralProviderEntity)),
);

const moduleRef: TestingModule = await baseModuleRef
  .overrideProvider(OpenAICompatibleClient)
  .useFactory({
    factory: () => ({
      getClient: async () => {
        const provider = await centralProviderRepo.findOne({ where: { id: 'singleton' } });
        if (!provider) throw new Error('Central provider not configured');
        return new OpenAI({
          baseURL: provider.baseUrl,
          apiKey: decrypt(provider.apiKeyEncrypted),
        });
      },
      stream: async (_params: any) => providerMock.yieldChunks(['Hello', ' ', 'world'], 30),
    }),
  })
  .compile();

app = moduleRef.createNestApplication();
// (existing app.useGlobalPipes / app.useGlobalFilters / await app.init() unchanged)
```

(If the `useFactory` syntax doesn't compile in this Nest version, use the simpler `useValue` form: build the override object above and pass it to `.useValue(...)`. Both forms are equivalent for this test.)

(d) Add the new test case at the bottom of the `describe` block:

```ts
  it('persists the FULL assistant response when the client disconnects mid-stream', async () => {
    const server = app.getHttpServer();

    // Manually drive the SSE request so we can abort it after the
    // first delta. supertest's default behavior buffers the response
    // and would only complete after the full stream — we want to drop
    // the socket mid-stream.
    const chunks: string[] = [];
    const req = request(server)
      .post('/v1/chat/stream')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Accept', 'text/event-stream')
      .buffer(false)
      .parse((res: any, cb: any) => {
        res.on('data', (buf: Buffer) => chunks.push(buf.toString('utf8')));
        res.on('end', () => cb(null, chunks.join('')));
      })
      .send({ message: 'Tell me a long story' });

    // Wait until at least the first delta has arrived on the wire.
    await new Promise<void>((resolve, reject) => {
      const start = Date.now();
      const t = setInterval(() => {
        const joined = chunks.join('');
        if (joined.includes('"delta":"Hello"')) {
          clearInterval(t);
          resolve();
        } else if (Date.now() - start > 5000) {
          clearInterval(t);
          reject(new Error('Timed out waiting for first delta'));
        }
      }, 20);
    });

    // Force the underlying socket to close — simulates the user
    // closing the browser or navigating away.
    req.abort();

    // Give the server enough time to consume the remaining two chunks
    // and persist the full response.
    await new Promise((r) => setTimeout(r, 200));

    // The most recent conversation must contain exactly one assistant
    // message whose content is the FULL provider output, not a
    // truncated version captured at the time of disconnect.
    const list = await request(server)
      .get('/v1/conversations')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(list.body.items.length).toBeGreaterThan(0);
    const conversationId = list.body.items[0].id;

    const detail = await request(server)
      .get(`/v1/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const assistantMessages = detail.body.messages.filter((m: any) => m.role === 'assistant');
    expect(assistantMessages.length).toBe(1);
    expect(assistantMessages[0].content).toBe('Hello world');
  });
```

- [ ] **Step 2: Run the new test to verify it fails**

Run: `npx jest test/integration/chat.stream.e2e.spec.ts -t "persists the FULL assistant response when the client disconnects mid-stream"`
Expected: FAIL. With the current buggy code, `appendMessage` either runs with `fullResponse` empty (because `abortedRef.value` is stuck at `false` and the for-await loop never breaks) or never runs at all (because the consume loop awaits forever on the never-yielding mocked stream after the client aborts). The `GET /v1/conversations/:id` returns either zero assistant messages or an empty one. The exact failure message depends on timing — the assertion `expect(assistantMessages[0].content).toBe('Hello world')` is the contract that drives the fix.

- [ ] **Step 3: Verify Task 1 is applied**

Run: `npm test -- --testPathPattern='test/unit/chat.service.spec.ts'`
Expected: PASS. Confirms the refactor in Task 1 is in place before we run the e2e.

- [ ] **Step 4: Run the new e2e test to verify it passes**

Run: `npx jest test/integration/chat.stream.e2e.spec.ts -t "persists the FULL assistant response when the client disconnects mid-stream"`
Expected: PASS. The mock yields `'Hello'`, `' '`, `'world'` 30 ms apart. The test reads the first delta, aborts the HTTP connection, waits 200 ms, then asserts that `GET /v1/conversations/:id` returns a single assistant message with the FULL content `'Hello world'` — proving the consume task ran to completion after the client disconnect and persisted the full response.

- [ ] **Step 5: Run the full integration suite to confirm no regression**

Run: `npm test`
Expected: PASS. The two pre-existing `it` blocks in `chat.stream.e2e.spec.ts` still pass — the override still satisfies `getClient()` for the boot path and yields a stream that the existing happy-path test reads with supertest's default buffered mode (the buffered mode will collect all chunks once the stream completes; with a 30 ms chunk cadence and no abort, all three chunks arrive before the response ends).

- [ ] **Step 6: Append a suggested commit message**

```
Suggested commit message:
test(chat): e2e coverage for full-response persistence across disconnect

- Override OpenAICompatibleClient with a chunk-yielding fake (3 chunks
  at 30 ms intervals) whose getClient() delegates to the seeded
  CentralProvider row, so the real provider credentials path is still
  exercised for non-overridden calls
- New e2e case: read the SSE stream until the first delta, abort the
  HTTP connection, then assert GET /v1/conversations/:id shows the
  FULL assistant message ("Hello world"), not the truncated text
  captured at disconnect time
- Confirms the detached consume-and-persist task from the previous
  commit flows all the way through NestJS HTTP → ChatService →
  ConversationsService → SQLite
```

---

## Task 3: Document the disconnect-resilience behavior

**Files:**
- Modify: `specs/001-multi-model-chatbot-mvp/spec.md:124-132` — tighten US3 acceptance scenario 3 to make the new behavior normative.
- Modify: `specs/001-multi-model-chatbot-mvp/api-contract.md:220-240` — replace the §3.8 closing paragraph with a "Disconnect resilience" section.
- Modify: `specs/001-multi-model-chatbot-mvp/contracts/openapi.yaml:243-296` — replace the `description:` block on `/v1/chat/stream` with a version that documents the new behavior.

**Interfaces:**
- Consumes: the implementation introduced by Tasks 1–2.
- Produces: updated documentation artifacts that match the new behavior. No code change.

- [ ] **Step 1: Tighten US3 scenario 3 in `spec.md`**

In `specs/001-multi-model-chatbot-mvp/spec.md`, find the US3 acceptance scenarios (around lines 124–132). Replace scenario 3 with this version:

```markdown
3. **Given** the user is mid-stream, **When** they navigate away or close
   the browser, **Then** the server keeps generating the assistant's
   response to completion (the upstream provider call is not cancelled)
   and persists the FULL response to the conversation history, so the
   user can read the complete assistant turn from the history view on
   return. The SSE socket on the disconnected client is closed cleanly
   with no half-open connection on the server.
```

Keep scenarios 1, 2, and 4 unchanged.

- [ ] **Step 2: Replace the §3.8 closing paragraph in `api-contract.md`**

In `specs/001-multi-model-chatbot-mvp/api-contract.md`, find §3.8 ("SSE event shapes (chat stream)") near the end of the file. Replace the existing paragraph that starts with "The stream MUST terminate cleanly..." (the lines immediately following the three fenced `data:` / `event: done` / `event: error` examples) with:

```markdown
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
```

- [ ] **Step 3: Replace the `description:` block on `/v1/chat/stream` in `openapi.yaml`**

In `specs/001-multi-model-chatbot-mvp/contracts/openapi.yaml`, find the `/v1/chat/stream` path (around lines 243–296) and replace the entire `description:` value (currently the indented block under the `description: |` line) with:

```yaml
      description: |
        Send a user message and receive a streaming chat completion.
        The response is a `text/event-stream`. Each event payload is a
        JSON object. The stream terminates with a final `event: done`
        on success or `event: error` on failure.

        **Active model resolution**: explicit `modelId` → caller's sticky
        choice → admin's default model. If no model is resolvable, the
        server returns 422 with `code = "no_model_available"`.

        **Disconnect resilience**: if the client disconnects mid-stream
        (browser closed, network dropped, navigation away, page refresh),
        the server keeps generating the assistant response to completion
        and persists the FULL response as a `role: "assistant"` message
        on the conversation. No `event: done` is delivered to the
        disconnected client (its socket is gone), but the server-side
        work runs to the end. The user can read the persisted message
        via `GET /v1/conversations/:id` after generation completes.
```

No other fields of the operation change — the request schema, response codes, and security remain identical.

- [ ] **Step 4: Append a suggested commit message**

```
Suggested commit message:
docs(chat): document disconnect-resilience semantics

- Tighten spec.md US3 scenario 3 to make the new behavior normative:
  "server keeps generating, persists full response, no half-open
  connection"
- Replace the §3.8 closing paragraph in api-contract.md with a
  "Disconnect resilience" section that explains provider cost, the
  partial-on-provider-error case, and the GET-based recovery path
- Replace the description on /v1/chat/stream in openapi.yaml to match
```

---

## Task 4: Final verification

**Files:** none modified — this task only runs commands.

- [ ] **Step 1: Run lint**

Run: `npm run lint`
Expected: exit 0 with no errors. The refactor in Task 1 introduces no new lint findings because it preserves the existing import set and naming conventions.

- [ ] **Step 2: Run type-check**

Run: `npx tsc --noEmit`
Expected: exit 0. The new `runStream` private method type-checks against the existing `ChatMessage` interface, `OpenAI.Chat.Completions.ChatCompletionMessageParam`, `ChatStreamEvent` union, and the existing `OpenAICompatibleClient.stream(params)` signature (unchanged — single argument, no signal).

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: exit 0. All unit and integration suites pass, including the three new "client disconnect" cases in `chat.service.spec.ts` and the new e2e disconnect-resilience case in `chat.stream.e2e.spec.ts`. The pre-existing happy-path tests still pass.

- [ ] **Step 4: Run the build**

Run: `npm run build`
Expected: exit 0 with `dist/` populated. Confirms the change compiles to a deployable artifact.

- [ ] **Step 5: Append a final suggested commit message**

```
Suggested commit message:
chore(chat): no-op verification pass for the disconnect-resilience change

- Lint, type-check, full test suite, and build all green
- No code changes in this commit; this is the release-gate snapshot
```

---

## Self-Review

**1. Spec coverage.** Skim `specs/001-multi-model-chatbot-mvp/spec.md`:

- FR-004 (stream from provider): unchanged, satisfied by the existing implementation.
- FR-005 (persist completed chat exchanges): extended by Task 3 spec edit to also cover disconnect-survived exchanges (and partial exchanges when the provider errors after disconnect).
- FR-013 (terminate streaming responses cleanly when client disconnects): now satisfied in two layers — (a) the SSE socket is closed cleanly because no further writes are attempted after `clientConnected` flips false, AND (b) the server-side consume task continues to a clean end. The old reading of FR-013 ("cancel upstream on disconnect") is explicitly overridden by the user's clarification and the updated spec scenario 3.
- US3 scenario 3 (mid-stream behavior): rewritten in Task 3 to require persistence of the full response.
- US3 scenario 4 (completed conversation shows both turns): still satisfied.

Every section of the spec that touches chat streaming is covered. No gaps.

**2. Placeholder scan.** Searched the plan for red-flag patterns:
- No "TBD", "TODO", "implement later", "fill in details".
- No "Add appropriate error handling" without code.
- Every test in Tasks 1–2 includes full test code, not a description.
- The `runStream` body in Task 1 is fully written, not stubbed.
- The OpenAPI description in Task 3 is fully written.

Clean.

**3. Type consistency.** Spot-checked:
- `ChatService.streamChat(userId, dto)` keeps its public signature `(userId: string, dto: ChatRequestDto): Observable<ChatStreamEvent>` — no external caller changes.
- The private `runStream` signature is `(userId, dto, observer, isClientConnected)` — only called from `streamChat` inside the same file.
- `ConversationsService.appendMessage(conversationId, content)` signature unchanged from `src/modules/conversations/conversations.service.ts:67`.
- The test fixtures use the same `buildSlowStream(chunks, delayMs)` shape across all three new `it` blocks — kept consistent.
- The integration test references `CentralProviderEntity` and the existing test file's existing import of `CentralProvider` from the entities path — consistent with what is already imported at the top of `chat.stream.e2e.spec.ts`.

Consistent.

**4. Cross-check against user's clarification.** The user said: "we don't want the message to abort if client disconnected, we want the message to be protected from user network failure, tab closes and refreshes, or any disconnection." The plan:
- ✅ Does **not** abort the upstream provider call on client disconnect (no `AbortController` in the design).
- ✅ Persists the FULL assistant response when the client disconnects mid-stream (Task 1 `runStream` + Task 2 e2e proves it).
- ✅ Protects against the four disconnect causes the user named (network failure, tab close, page refresh, any disconnection) — they all manifest as RxJS `unsubscribe` and are handled by the same `clientConnected` flag flip.

Aligned with intent.
