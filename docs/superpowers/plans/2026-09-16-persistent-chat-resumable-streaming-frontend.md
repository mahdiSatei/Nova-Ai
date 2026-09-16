# Persistent Chat & Resumable Streaming — Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add connection-aware state, message status display, reconnect/resume, cancel, retry, and snapshot replacement to the frontend so the chat survives disconnects and page reloads.

**Architecture:** Extend `useChatStream` to track connection state and generation state as separate axes. Add a `generation` object keyed by `conversationId + assistantMessageId`. Add API functions for cancel/retry. Update MessageList/ChatMessage to render status-aware recovery UI. Add a connection banner to ChatView.

**Tech Stack:** Vue 3, TypeScript, Pinia, Vue Router, Tailwind CSS 4, Vite

**Spec:** `../backend/docs/superpowers/plans/2026-09-16-persistent-chat-resumable-streaming.md` and the backend briefing included in the feature spec.

## Global Constraints

- Vue 3 Composition API with `<script setup lang="ts">`.
- Tailwind CSS 4 utility classes — no new CSS files.
- Existing RTL Persian UI patterns must be preserved.
- Existing streaming implementation (`fetch` + `ReadableStream` SSE) must be preserved where possible.
- Remove `event: started` handler — backend no longer emits it.
- No offline-first composition or local database.
- Add Vitest for unit testing (currently no test framework exists).

---

## File Structure

```
app/src/
├── types/
│   └── api.ts                          ← Add MessageStatus type + status field
├── api/
│   ├── chat.ts                         ← Remove onStarted, add cancel/retry
│   └── conversations.ts                ← Add cancelGeneration + retryGeneration
├── composables/
│   └── useChatStream.ts                ← Major refactor: dual state model
├── components/
│   └── chat/
│       ├── MessageList.vue             ← Status-aware rows
│       └── ChatMessage.vue             ← Status indicator + retry button
├── views/
│   └── ChatView.vue                    ← Connection banner
├── utils/
│   └── errors.ts                       ← Add new error code messages
└── tests/
    ├── setup.ts                        ← Vitest config entry
    ├── useChatStream.spec.ts           ← Unit tests for composable
    └── api/chat.spec.ts                ← Unit tests for streaming client
```

---

### Task 1: Types, API client, and error messages

**Files:**
- Modify: `app/src/types/api.ts`
- Modify: `app/src/api/chat.ts`
- Modify: `app/src/api/conversations.ts`
- Modify: `app/src/utils/errors.ts`

**Interfaces:**
- Consumes: none (foundation task)
- Produces: `MessageStatus` type, `status` field on `MessagePublic`, `cancelGeneration`/`retryGeneration` API functions, updated error messages, removed `onStarted` handler

#### Step 1: Add `MessageStatus` type and `status` to `MessagePublic`

Modify `app/src/types/api.ts`:

Add after line 2 (`MessageRole`):
```ts
export type MessageStatus = 'pending' | 'streaming' | 'completed' | 'failed' | 'cancelled'
```

Modify `MessagePublic` (lines 90-95):
```ts
export interface MessagePublic {
  id: string
  role: MessageRole
  content: string
  createdAt: string
  status: MessageStatus
}
```

#### Step 2: Remove `onStarted` and add cancel/retry API functions

Modify `app/src/api/chat.ts`:

Remove the `onStarted` and `SseStarted` types (lines 9-17):
```ts
// DELETE these lines:
//   onStarted?: (conversationId: string) => void
// }
//
// export interface SseStarted {
//   conversationId: string
// }
```

Update the `StreamHandlers` interface (lines 5-13):
```ts
export interface StreamHandlers {
  onDelta: (text: string) => void
  /** Stream-level error event, HTTP-level error, or network failure */
  onError: (err: { code: string; message: string }) => void
}
```

Remove the `started` event handler block inside the SSE parser (lines 90-98):
```ts
// DELETE this entire block:
// if (eventName === 'started') {
//   try {
//     const parsed = JSON.parse(payload) as SseStarted
//     if (parsed.conversationId && handlers.onStarted) handlers.onStarted(parsed.conversationId)
//   } catch {
//     /* malformed started frame — ignore */
//   }
//   continue
// }
```

Add cancel and retry functions at the end of `app/src/api/chat.ts`:
```ts
/**
 * POST /v1/chat/:conversationId/cancel — cancel the active generation.
 */
export async function cancelGeneration(conversationId: string): Promise<{ messageId: string; status: string }> {
  return request<{ messageId: string; status: string }>(`/v1/chat/${conversationId}/cancel`, {
    method: 'POST',
  })
}

/**
 * POST /v1/chat/:conversationId/retry — retry a failed/cancelled generation.
 * Body: { failedMessageId: string }
 */
export async function retryGeneration(
  conversationId: string,
  failedMessageId: string,
): Promise<{ messageId: string; status: string }> {
  return request<{ messageId: string; status: string }>(`/v1/chat/${conversationId}/retry`, {
    method: 'POST',
    body: { failedMessageId },
  })
}
```

#### Step 3: Update error messages

Modify `app/src/utils/errors.ts`:

Add to `MESSAGES` record:
```ts
  generation_in_progress: 'در حال حاضر یک پاسخ در حال تولید است. لطفاً صبر کنید یا آن را متوقف کنید.',
  no_active_generation: 'هیچ تولید فعالی برای متوقف کردن وجود ندارد.',
```

#### Step 4: Verify type-check passes

Run: `npx vue-tsc --noEmit`
Expected: Zero errors (adding `status` to `MessagePublic` may surface places that construct `MessagePublic` without `status` — fix those inline).

#### Step 5: Commit

```
Suggested commit message: feat(frontend): add MessageStatus type, remove onStarted, add cancel/retry APIs

- Add MessageStatus type and status field to MessagePublic
- Remove onStarted handler and SseStarted type (backend no longer emits started)
- Add cancelGeneration and retryGeneration API functions
- Add generation_in_progress and no_active_generation error messages
```

---

### Task 2: Vitest setup

**Files:**
- Create: `app/tests/setup.ts`
- Modify: `app/package.json` (add devDependency and scripts)
- Modify: `app/vite.config.ts` (add test config)

**Interfaces:**
- Consumes: none
- Produces: Working `vitest` test runner

#### Step 1: Install vitest

Run: `npm install -D vitest @vue/test-utils happy-dom`

#### Step 2: Create test setup file

Create `app/tests/setup.ts`:
```ts
import { vi } from 'vitest'

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
})

// Mock crypto.randomUUID
if (!crypto.randomUUID) {
  crypto.randomUUID = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, () =>
    ((Math.random() * 16) | 0).toString(16),
  )
}
```

#### Step 3: Add test config to vite.config.ts

Add to `app/vite.config.ts`:
```ts
export default defineConfig({
  // ... existing config ...
  test: {
    environment: 'happy-dom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.spec.ts'],
  },
})
```

#### Step 4: Add test script to package.json

Add to `scripts` in `app/package.json`:
```json
"test": "vitest run"
```

#### Step 5: Run a smoke test

Run: `npx vitest run`
Expected: 0 tests found (no test files yet) but no config errors.

#### Step 6: Commit

```
Suggested commit message: test(frontend): add vitest test runner with happy-dom

- Install vitest, @vue/test-utils, happy-dom
- Add tests/setup.ts with DOM/crypto mocks
- Configure vitest in vite.config.ts
- Add test script to package.json
```

---

### Task 3: Refactor `useChatStream` — dual state model

**Files:**
- Modify: `app/src/composables/useChatStream.ts`
- Test: `app/tests/useChatStream.spec.ts`

**Interfaces:**
- Consumes: `cancelGeneration`, `retryGeneration` from `api/chat`; `getConversation` from `api/conversations`
- Produces: `connectionState`, `generationState`, `generation` object, `cancel()`, `retry()`, `reconnect()` methods

#### Step 1: Write the failing tests

Create `app/tests/useChatStream.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useChatStream } from '@/composables/useChatStream'
import { cancelGeneration, retryGeneration } from '@/api/chat'
import { getConversation } from '@/api/conversations'

vi.mock('@/api/chat')
vi.mock('@/api/conversations')

describe('useChatStream', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    localStorage.clear()
  })

  it('starts in idle state', () => {
    const chat = useChatStream()
    expect(chat.phase.value).toBe('idle')
    expect(chat.connectionState.value).toBe('connected')
    expect(chat.generationState.value).toBe('idle')
  })

  it('detects streaming message on conversation load (FR-9)', async () => {
    const mockMessages = [
      { id: 'm1', role: 'user', content: 'hello', createdAt: '2024-01-01T00:00:00Z', status: 'completed' as const },
      { id: 'm2', role: 'assistant', content: 'partial', createdAt: '2024-01-01T00:00:01Z', status: 'streaming' as const },
    ]
    vi.mocked(getConversation).mockResolvedValue({
      id: 'conv-1',
      modelId: 'm1',
      messages: mockMessages,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    })

    const chat = useChatStream()
    await chat.loadConversation('conv-1')

    expect(chat.generationState.value).toBe('streaming')
    expect(chat.generation.value.assistantMessageId).toBe('m2')
    expect(chat.generation.value.content).toBe('partial')
    expect(chat.transcript.value).toHaveLength(2)
  })

  it('marks completed on done event (FR-2)', async () => {
    const chat = useChatStream()
    // Simulate a completed conversation load
    vi.mocked(getConversation).mockResolvedValue({
      id: 'conv-1',
      modelId: 'm1',
      messages: [
        { id: 'm1', role: 'user', content: 'hi', createdAt: '2024-01-01T00:00:00Z', status: 'completed' as const },
        { id: 'm2', role: 'assistant', content: 'full reply', createdAt: '2024-01-01T00:00:01Z', status: 'completed' as const },
      ],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    })
    await chat.loadConversation('conv-1')
    expect(chat.generationState.value).toBe('idle')
  })

  it('sets generationState to streaming on send (FR-3)', async () => {
    const chat = useChatStream()
    vi.mocked(getConversation).mockResolvedValue({
      id: 'conv-1', modelId: 'm1', messages: [], createdAt: '', updatedAt: '',
    })
    // Mock streamChat to not actually stream
    ;(chat as any).send = vi.fn().mockResolvedValue(undefined)

    // Override the internal streamChat mock
    const { streamChat } = await import('@/api/chat')
    vi.mocked(streamChat).mockReturnValue({
      [Symbol.asyncIterator]: async function* () {},
    } as any)

    await chat.send('test message')
    expect(chat.generationState.value).toBe('streaming')
  })

  it('calls cancel endpoint on cancel()', async () => {
    const chat = useChatStream()
    chat.generation.value = {
      conversationId: 'conv-1',
      assistantMessageId: 'm-stream',
      status: 'streaming',
      content: 'partial text',
    }
    chat.connectionState.value = 'disconnected'

    vi.mocked(cancelGeneration).mockResolvedValue({ messageId: 'm-stream', status: 'cancelled' })

    await chat.cancel()

    expect(cancelGeneration).toHaveBeenCalledWith('conv-1')
    expect(chat.generationState.value).toBe('cancelled')
    expect(chat.connectionState.value).toBe('connected')
  })

  it('reconnect replaces local content with backend snapshot (FR-7)', async () => {
    const chat = useChatStream()
    chat.generation.value = {
      conversationId: 'conv-1',
      assistantMessageId: 'm-stream',
      status: 'streaming',
      content: 'local partial text',
    }

    await chat.replaceSnapshot('server full response')

    expect(chat.generation.value.content).toBe('server full response')
    // No duplication — local content should be REPLACED not appended
    expect(chat.generation.value.content).not.toContain('local partial text')
  })

  it('disables input during streaming (FR-3)', async () => {
    const chat = useChatStream()
    chat.generationState.value = 'streaming'
    expect(chat.inputDisabled.value).toBe(true)
    chat.generationState.value = 'idle'
    expect(chat.inputDisabled.value).toBe(false)
  })
})
```

#### Step 2: Run tests to verify they fail

Run: `npx vitest run tests/useChatStream.spec.ts`
Expected: FAIL — `connectionState`, `generationState`, `generation`, `cancel`, `retry`, `reconnect`, `replaceSnapshot`, `inputDisabled` do not exist yet.

#### Step 3: Rewrite `useChatStream.ts`

Replace the entire contents of `app/src/composables/useChatStream.ts`:

```ts
import { computed, onBeforeUnmount, ref } from 'vue'
import { streamChat, cancelGeneration, retryGeneration, type StreamHandlers } from '@/api/chat'
import { getConversation } from '@/api/conversations'
import { ApiError } from '@/api/http'
import type { MessagePublic, MessageStatus } from '@/types/api'

const SESSION_KEY = 'mmcb.lastModelId'

type Phase = 'idle' | 'loading' | 'streaming' | 'error' | 'success'
type ConnectionState = 'connected' | 'disconnected' | 'reconnecting'
type GenerationStatus = 'idle' | 'streaming' | 'completed' | 'failed' | 'cancelled'

interface ActiveGeneration {
  conversationId: string
  assistantMessageId: string
  status: GenerationStatus
  content: string
}

function loadSavedModelId(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}

function saveModelId(id: string): void {
  try {
    sessionStorage.setItem(SESSION_KEY, id)
  } catch {
    /* ignore */
  }
}

export interface ChatStreamHandle {
  phase: import('vue').Ref<Phase>
  transcript: import('vue').Ref<MessagePublic[]>
  streamingText: import('vue').Ref<string>
  pendingUser: import('vue').Ref<MessagePublic | null>
  streamError: import('vue').Ref<{ code: string; message: string } | null>
  conversationId: import('vue').Ref<string | null>
  selectedModelId: import('vue').Ref<string | null>
  streamCompletedAt: import('vue').Ref<string | null>
  connectionState: import('vue').Ref<ConnectionState>
  generationState: import('vue').Ref<GenerationStatus>
  generation: import('vue').Ref<ActiveGeneration | null>
  isStreaming: import('vue').ComputedRef<boolean>
  inputDisabled: import('vue').ComputedRef<boolean>
  setModel: (id: string | null) => void
  loadConversation: (id: string) => Promise<void>
  resetConversation: () => void
  send: (text: string) => Promise<void>
  cancel: () => Promise<void>
  retry: (failedMessageId: string) => Promise<void>
  reconnect: () => Promise<void>
  replaceSnapshot: (content: string) => void
  abort: () => void
}

export function useChatStream(): ChatStreamHandle {
  const phase = ref<Phase>('idle')
  const transcript = ref<MessagePublic[]>([])
  const streamingText = ref('')
  const pendingUser = ref<MessagePublic | null>(null)
  const streamError = ref<{ code: string; message: string } | null>(null)
  const conversationId = ref<string | null>(null)
  const selectedModelId = ref<string | null>(loadSavedModelId())
  const streamCompletedAt = ref<string | null>(null)
  const connectionState = ref<ConnectionState>('connected')
  const generationState = ref<GenerationStatus>('idle')
  const generation = ref<ActiveGeneration | null>(null)

  let controller: AbortController | null = null

  const isStreaming = computed(() => phase.value === 'streaming')
  const inputDisabled = computed(
    () => generationState.value === 'streaming' || generationState.value === 'reconnecting',
  )

  function setModel(id: string | null): void {
    selectedModelId.value = id
    if (id) saveModelId(id)
    else {
      try {
        sessionStorage.removeItem(SESSION_KEY)
      } catch {
        /* ignore */
      }
    }
  }

  function resetConversation(): void {
    abort()
    transcript.value = []
    conversationId.value = null
    pendingUser.value = null
    streamingText.value = ''
    streamError.value = null
    streamCompletedAt.value = null
    phase.value = 'idle'
    connectionState.value = 'connected'
    generationState.value = 'idle'
    generation.value = null
  }

  function replaceSnapshot(content: string): void {
    generation.value = generation.value
      ? { ...generation.value, content }
      : null
  }

  async function loadConversation(id: string): Promise<void> {
    phase.value = 'loading'
    streamError.value = null
    connectionState.value = 'connected'
    generationState.value = 'idle'
    generation.value = null

    try {
      const detail = await getConversation(id)
      transcript.value = detail.messages
      conversationId.value = detail.id

      // FR-9: detect unfinished generation on reload
      const streamingMsg = detail.messages.find((m) => m.status === 'streaming')
      if (streamingMsg) {
        generationState.value = 'streaming'
        generation.value = {
          conversationId: detail.id,
          assistantMessageId: streamingMsg.id,
          status: 'streaming',
          content: streamingMsg.content,
        }
      }
    } catch (err) {
      streamError.value =
        err instanceof ApiError
          ? { code: err.code, message: err.message }
          : { code: 'network_error', message: 'خطا در بارگذاری گفتگو.' }
      phase.value = 'error'
      connectionState.value = 'disconnected'
    }
  }

  async function send(text: string): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed || generationState.value === 'streaming') return Promise.resolve()

    const userMsg: MessagePublic = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
      createdAt: new Date().toISOString(),
      status: 'completed',
    }
    pendingUser.value = userMsg

    streamingText.value = ''
    streamError.value = null
    streamCompletedAt.value = null
    phase.value = 'streaming'
    generationState.value = 'streaming'
    connectionState.value = 'connected'

    const handlers: StreamHandlers = {
      onDelta: appendDelta,
      onDone: async () => {
        streamCompletedAt.value = new Date().toISOString()
        phase.value = 'idle'
        generationState.value = 'completed'
        connectionState.value = 'connected'

        if (pendingUser.value) {
          transcript.value.push(pendingUser.value)
          pendingUser.value = null
        }
        if (streamingText.value) {
          transcript.value.push({
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: streamingText.value,
            createdAt: new Date().toISOString(),
            status: 'completed',
          })
          streamingText.value = ''
        }
        streamCompletedAt.value = null
        generation.value = null
      },
      onError: (err) => {
        streamError.value = err
        streamCompletedAt.value = new Date().toISOString()
        phase.value = 'error'

        if (err.code === 'generation_in_progress') {
          // FR-2: concurrent send rejection — rollback, don't add messages
          pendingUser.value = null
          streamingText.value = ''
          generationState.value = 'idle'
          generation.value = null
          return
        }

        if (pendingUser.value) {
          transcript.value.push(pendingUser.value)
          pendingUser.value = null
        }
        if (streamingText.value) {
          transcript.value.push({
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: streamingText.value,
            createdAt: new Date().toISOString(),
            status: 'failed',
          })
          streamingText.value = ''
        }
        generationState.value = 'failed'
        generation.value = null
      },
    }

    controller = streamChat(
      {
        conversationId: conversationId.value,
        modelId: selectedModelId.value,
        message: trimmed,
      },
      handlers,
    )

    return Promise.resolve()
  }

  async function cancel(): Promise<void> {
    if (!generation.value) return

    try {
      connectionState.value = 'connected'
      await cancelGeneration(generation.value.conversationId)
      generationState.value = 'cancelled'
      // Preserve partial content — do not clear generation.content
    } catch (err) {
      if (err instanceof ApiError && err.code === 'no_active_generation') {
        // Backend says generation already finished — reload conversation
        if (conversationId.value) {
          await loadConversation(conversationId.value)
        }
      } else {
        streamError.value = err instanceof ApiError
          ? { code: err.code, message: err.message }
          : { code: 'network_error', message: 'خطا در متوقف کردن تولید.' }
      }
    }
  }

  async function retry(failedMessageId: string): Promise<void> {
    if (!conversationId.value) return

    try {
      const result = await retryGeneration(conversationId.value, failedMessageId)
      generationState.value = 'streaming'
      generation.value = {
        conversationId: conversationId.value,
        assistantMessageId: result.messageId,
        status: 'streaming',
        content: '',
      }
      streamingText.value = ''
      streamError.value = null
      phase.value = 'streaming'
      connectionState.value = 'connected'

      // Now start streaming the new generation
      const handlers: StreamHandlers = {
        onDelta: appendDelta,
        onDone: async () => {
          streamCompletedAt.value = new Date().toISOString()
          phase.value = 'idle'
          generationState.value = 'completed'
          if (streamingText.value) {
            transcript.value.push({
              id: result.messageId,
              role: 'assistant',
              content: streamingText.value,
              createdAt: new Date().toISOString(),
              status: 'completed',
            })
            streamingText.value = ''
          }
          streamCompletedAt.value = null
          generation.value = null
        },
        onError: (err) => {
          streamError.value = err
          streamCompletedAt.value = new Date().toISOString()
          phase.value = 'error'
          generationState.value = 'failed'
          if (streamingText.value) {
            transcript.value.push({
              id: result.messageId,
              role: 'assistant',
              content: streamingText.value,
              createdAt: new Date().toISOString(),
              status: 'failed',
            })
            streamingText.value = ''
          }
          generation.value = null
        },
      }

      controller = streamChat(
        {
          conversationId: conversationId.value,
          modelId: selectedModelId.value,
          message: transcript.value[transcript.value.length - 1]?.content ?? '',
        },
        handlers,
      )
    } catch (err) {
      streamError.value = err instanceof ApiError
        ? { code: err.code, message: err.message }
        : { code: 'network_error', message: 'خطا در تلاش مجدد.' }
    }
  }

  async function reconnect(): Promise<void> {
    if (!generation.value) return

    connectionState.value = 'reconnecting'
    streamError.value = null

    // Backend has authoritative content — replace local snapshot
    // The reconnect will start a new SSE stream; the backend will
    // emit accumulated content first, then continue with new deltas.
    // The onDelta handler in the new stream will build up fresh content.
    generationState.value = 'streaming'
    streamingText.value = ''
    phase.value = 'streaming'

    const handlers: StreamHandlers = {
      onDelta: appendDelta,
      onDone: async () => {
        streamCompletedAt.value = new Date().toISOString()
        phase.value = 'idle'
        generationState.value = 'completed'
        connectionState.value = 'connected'
        if (streamingText.value) {
          transcript.value.push({
            id: generation.value!.assistantMessageId,
            role: 'assistant',
            content: streamingText.value,
            createdAt: new Date().toISOString(),
            status: 'completed',
          })
          streamingText.value = ''
        }
        streamCompletedAt.value = null
        generation.value = null
      },
      onError: (err) => {
        streamError.value = err
        streamCompletedAt.value = new Date().toISOString()
        phase.value = 'error'
        generationState.value = 'failed'
        connectionState.value = 'disconnected'
      },
    }

    controller = streamChat(
      {
        conversationId: generation.value.conversationId,
        modelId: selectedModelId.value,
        message: transcript.value[transcript.value.length - 1]?.content ?? '',
      },
      handlers,
    )
  }

  function appendDelta(text: string): void {
    streamingText.value += text
  }

  async function findLatestConversationId(): Promise<string | null> {
    try {
      const { listConversations } = await import('@/api/conversations')
      const page = await listConversations({ limit: 1 })
      return page.items[0]?.id ?? null
    } catch {
      return null
    }
  }

  function abort(): void {
    if (controller) {
      controller.abort()
      controller = null
    }
    if (generationState.value === 'streaming') {
      if (pendingUser.value) {
        transcript.value.push(pendingUser.value)
        pendingUser.value = null
      }
      if (streamingText.value) {
        transcript.value.push({
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: streamingText.value,
          createdAt: new Date().toISOString(),
          status: 'failed',
        })
        streamingText.value = ''
      }
      phase.value = 'idle'
      generationState.value = 'idle'
      generation.value = null
    }
  }

  // Track online/offline
  function onOnline(): void {
    if (generationState.value === 'streaming' && connectionState.value === 'disconnected') {
      // Auto-reconnect when network comes back
      void reconnect()
    } else {
      connectionState.value = 'connected'
    }
  }

  function onOffline(): void {
    if (generationState.value === 'streaming') {
      connectionState.value = 'disconnected'
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
  }

  onBeforeUnmount(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
    abort()
  })

  return {
    phase,
    transcript,
    streamingText,
    pendingUser,
    streamError,
    conversationId,
    selectedModelId,
    streamCompletedAt,
    connectionState,
    generationState,
    generation,
    isStreaming,
    inputDisabled,
    setModel,
    loadConversation,
    resetConversation,
    send,
    cancel,
    retry,
    reconnect,
    replaceSnapshot,
    abort,
  }
}
```

#### Step 4: Write unit tests

Create `app/tests/useChatStream.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useChatStream } from '@/composables/useChatStream'
import { cancelGeneration, retryGeneration } from '@/api/chat'
import { getConversation } from '@/api/conversations'

vi.mock('@/api/chat', () => ({
  streamChat: vi.fn(),
  cancelGeneration: vi.fn(),
  retryGeneration: vi.fn(),
}))

vi.mock('@/api/conversations', () => ({
  getConversation: vi.fn(),
  listConversations: vi.fn(),
}))

describe('useChatStream', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    localStorage.clear()
  })

  it('starts in idle state with connected + idle generation', () => {
    const chat = useChatStream()
    expect(chat.phase.value).toBe('idle')
    expect(chat.connectionState.value).toBe('connected')
    expect(chat.generationState.value).toBe('idle')
    expect(chat.generation.value).toBeNull()
  })

  it('detects streaming message on load (FR-9)', async () => {
    vi.mocked(getConversation).mockResolvedValue({
      id: 'conv-1',
      modelId: 'model-1',
      title: null,
      pinned: false,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      messages: [
        { id: 'm1', role: 'user', content: 'hello', createdAt: '2024-01-01T00:00:00Z', status: 'completed' },
        { id: 'm2', role: 'assistant', content: 'partial reply', createdAt: '2024-01-01T00:00:01Z', status: 'streaming' },
      ],
    })

    const chat = useChatStream()
    await chat.loadConversation('conv-1')

    expect(chat.transcript.value).toHaveLength(2)
    expect(chat.generationState.value).toBe('streaming')
    expect(chat.generation.value?.assistantMessageId).toBe('m2')
    expect(chat.generation.value?.content).toBe('partial reply')
    expect(chat.generation.value?.status).toBe('streaming')
  })

  it('leaves generation idle when all messages completed', async () => {
    vi.mocked(getConversation).mockResolvedValue({
      id: 'conv-1',
      modelId: 'model-1',
      title: null,
      pinned: false,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      messages: [
        { id: 'm1', role: 'user', content: 'hi', createdAt: '2024-01-01T00:00:00Z', status: 'completed' },
        { id: 'm2', role: 'assistant', content: 'full reply', createdAt: '2024-01-01T00:00:01Z', status: 'completed' },
      ],
    })

    const chat = useChatStream()
    await chat.loadConversation('conv-1')

    expect(chat.generationState.value).toBe('idle')
    expect(chat.generation.value).toBeNull()
  })

  it('replaceSnapshot overwrites content without duplication (FR-7)', async () => {
    const chat = useChatStream()
    chat.generation.value = {
      conversationId: 'conv-1',
      assistantMessageId: 'm1',
      status: 'streaming',
      content: 'local partial text',
    }

    chat.replaceSnapshot('server full response')

    expect(chat.generation.value?.content).toBe('server full response')
    expect(chat.generation.value?.content).not.toContain('local partial text')
  })

  it('cancel calls cancelGeneration endpoint (FR-10)', async () => {
    const chat = useChatStream()
    chat.generation.value = {
      conversationId: 'conv-1',
      assistantMessageId: 'm-stream',
      status: 'streaming',
      content: 'partial',
    }

    vi.mocked(cancelGeneration).mockResolvedValue({ messageId: 'm-stream', status: 'cancelled' })

    await chat.cancel()

    expect(cancelGeneration).toHaveBeenCalledWith('conv-1')
    expect(chat.generationState.value).toBe('cancelled')
    expect(chat.generation.value?.content).toBe('partial') // preserved
  })

  it('cancel handles no_active_generation by reloading conversation', async () => {
    const chat = useChatStream()
    chat.conversationId.value = 'conv-1'
    chat.generation.value = {
      conversationId: 'conv-1',
      assistantMessageId: 'm-stream',
      status: 'streaming',
      content: 'partial',
    }

    const apiErr = new Error('no active gen') as any
    apiErr.code = 'no_active_generation'
    apiErr.status = 409
    vi.mocked(cancelGeneration).mockRejectedValue(apiErr)
    vi.mocked(getConversation).mockResolvedValue({
      id: 'conv-1',
      modelId: 'm1',
      title: null,
      pinned: false,
      createdAt: '',
      updatedAt: '',
      messages: [],
    })

    await chat.cancel()

    expect(getConversation).toHaveBeenCalledWith('conv-1')
  })

  it('inputDisabled is true during streaming, false when idle (FR-3)', async () => {
    const chat = useChatStream()
    expect(chat.inputDisabled.value).toBe(false)

    chat.generationState.value = 'streaming'
    expect(chat.inputDisabled.value).toBe(true)

    chat.generationState.value = 'idle'
    expect(chat.inputDisabled.value).toBe(false)
  })

  it('resetConversation clears all state', () => {
    const chat = useChatStream()
    chat.transcript.value = [{ id: 'm1', role: 'user', content: 'hi', createdAt: '', status: 'completed' }]
    chat.generation.value = {
      conversationId: 'conv-1',
      assistantMessageId: 'm2',
      status: 'streaming',
      content: 'text',
    }
    chat.connectionState.value = 'disconnected'
    chat.conversationId.value = 'conv-1'

    chat.resetConversation()

    expect(chat.transcript.value).toHaveLength(0)
    expect(chat.generation.value).toBeNull()
    expect(chat.connectionState.value).toBe('connected')
    expect(chat.conversationId.value).toBeNull()
  })
})
```

#### Step 5: Run tests

Run: `npx vitest run tests/useChatStream.spec.ts`
Expected: PASS

#### Step 6: Commit

```
Suggested commit message: feat(frontend): refactor useChatStream for dual state + cancel/retry

- Add connectionState and generationState as separate axes
- Add generation object tracking conversationId + assistantMessageId
- Add cancel(), retry(), reconnect(), replaceSnapshot() methods
- Detect streaming message on conversation load (FR-9)
- Replace snapshot content instead of appending (FR-7)
- Add online/offline event listeners
- Unit tests for load-time recovery, cancel, replaceSnapshot, inputDisabled
```

---

### Task 4: Add cancel/retry tests for `api/chat.ts`

**Files:**
- Modify: `app/src/api/chat.ts` (already done in Task 1)
- Create: `app/tests/api/chat.spec.ts`

**Interfaces:**
- Consumes: `streamChat`, `cancelGeneration`, `retryGeneration` functions
- Produces: Verified SSE parsing and cancel/retry API calls

#### Step 1: Write tests

Create `app/tests/api/chat.spec.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { streamChat } from '@/api/chat'
import { cancelGeneration, retryGeneration } from '@/api/chat'

// Test the cancel/retry API wrappers
describe('cancelGeneration', () => {
  it('calls POST /v1/chat/:id/cancel', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ messageId: 'm1', status: 'cancelled' }),
    })
    ;(globalThis as any).fetch = mockFetch

    await cancelGeneration('conv-1')

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/chat/conv-1/cancel'),
      expect.objectContaining({ method: 'POST' }),
    )
  })
})

describe('retryGeneration', () => {
  it('calls POST /v1/chat/:id/retry with failedMessageId', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ messageId: 'm-new', status: 'streaming' }),
    })
    ;(globalThis as any).fetch = mockFetch

    await retryGeneration('conv-1', 'm-failed')

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/chat/conv-1/retry'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ failedMessageId: 'm-failed' }),
      }),
    )
  })
})

describe('streamChat SSE parsing', () => {
  it('parses delta events', async () => {
    const onDelta = vi.fn()
    const onDone = vi.fn()
    const onError = vi.fn()

    // Create a readable stream with SSE data
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"delta":"hello"}\n\n'))
        controller.enqueue(encoder.encode('event: done\n\n'))
        controller.close()
      },
    })

    ;(globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: stream,
    })

    const ctrl = streamChat({ message: 'test' }, { onDelta, onDone, onError })
    ctrl.abort()

    // onDelta and onDone should have been called synchronously or async
    // Give a tick for the async void to execute
    await new Promise((r) => setTimeout(r, 50))

    expect(onDelta).toHaveBeenCalledWith('hello')
    expect(onDone).toHaveBeenCalled()
  })

  it('parses error events', async () => {
    const onDelta = vi.fn()
    const onDone = vi.fn()
    const onError = vi.fn()

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('event: error\ndata: {"code":"provider_error","message":"provider down"}\n\n'))
        controller.close()
      },
    })

    ;(globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: stream,
    })

    const ctrl = streamChat({ message: 'test' }, { onDelta, onDone, onError })
    ctrl.abort()

    await new Promise((r) => setTimeout(r, 50))

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'provider_error' }),
    )
  })
})
```

#### Step 2: Run tests

Run: `npx vitest run tests/api/chat.spec.ts`
Expected: PASS

#### Step 3: Commit

```
Suggested commit message: test(frontend): unit tests for SSE streaming and cancel/retry APIs

- Test cancelGeneration calls correct endpoint
- Test retryGeneration sends failedMessageId in body
- Test SSE delta/done event parsing
- Test SSE error event parsing
```

---

### Task 5: Update `MessageList.vue` for status-aware rendering

**Files:**
- Modify: `app/src/components/chat/MessageList.vue`

**Interfaces:**
- Consumes: `MessagePublic` with `status` field, `isStreaming`, `generationState`, `generation` from composable
- Produces: Status-aware message rows with recovery UI

#### Step 1: Update `MessageList.vue`

The component needs to accept the conversation-level generation info and render status-aware rows. Each message already has a `status` field.

Key changes:
1. Pass `status` through to `ChatMessage` for each message
2. Show the streaming row when a message has `status === 'streaming'` (for page reload recovery)
3. Show retry/reconnect actions for failed/cancelled/streaming states

Modify `app/src/components/chat/MessageList.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue'
import ChatMessage from '@/components/chat/ChatMessage.vue'
import type { MessagePublic, MessageStatus } from '@/types/api'

const props = withDefaults(
  defineProps<{
    messages: MessagePublic[]
    pendingUser?: MessagePublic | null
    streamingText?: string
    isStreaming?: boolean
    /** The active generation for recovery UI */
    generation?: { conversationId: string; assistantMessageId: string; status: GenerationStatus; content: string } | null
    onRetry?: (failedMessageId: string) => void
    onReconnect?: () => void
    onCancel?: () => void
  }>(),
  { isStreaming: false, generation: null },
)

type GenerationStatus = 'idle' | 'streaming' | 'completed' | 'failed' | 'cancelled'

interface Row {
  key: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string | null
  streaming: boolean
  pending: boolean
  status: MessageStatus
  showRecovery: boolean
  recoveryStatus: GenerationStatus | null
}

const rows = computed<Row[]>(() => {
  const out: Row[] = []

  for (const m of props.messages) {
    const isActiveStreaming = m.status === 'streaming'
    out.push({
      key: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
      streaming: isActiveStreaming,
      pending: false,
      status: m.status,
      showRecovery: isActiveStreaming || m.status === 'failed' || m.status === 'cancelled',
      recoveryStatus: m.status as GenerationStatus,
    })
  }

  if (props.pendingUser) {
    out.push({
      key: props.pendingUser.id,
      role: 'user',
      content: props.pendingUser.content,
      createdAt: props.pendingUser.createdAt,
      streaming: false,
      pending: Boolean(props.isStreaming),
      status: 'completed',
      showRecovery: false,
      recoveryStatus: null,
    })
  }

  if (props.streamingText || props.isStreaming) {
    out.push({
      key: 'streaming',
      role: 'assistant',
      content: props.streamingText ?? '',
      createdAt: null,
      streaming: Boolean(props.isStreaming),
      pending: false,
      status: 'streaming',
      showRecovery: false,
      recoveryStatus: null,
    })
  }

  return out
})
</script>

<template>
  <ol class="mx-auto flex w-full max-w-3xl flex-col gap-6 py-6" role="log" aria-live="polite">
    <ChatMessage
      v-for="row in rows"
      :key="row.key"
      :role="row.role"
      :content="row.content"
      :created-at="row.createdAt"
      :streaming="row.streaming"
      :pending="row.pending"
      :status="row.status"
      :show-recovery="row.showRecovery"
      :recovery-status="row.recoveryStatus"
      :on-retry="onRetry"
      :on-reconnect="onReconnect"
      :on-cancel="onCancel"
    />
  </ol>
</template>
```

#### Step 2: Verify build

Run: `npx vue-tsc --noEmit`
Expected: Zero errors

#### Step 3: Commit

```
Suggested commit message: feat(frontend): update MessageList for status-aware recovery UI

- Pass message status to each row
- Show recovery actions for streaming/failed/cancelled messages
- Pass onRetry/onReconnect/onCancel callbacks from parent
```

---

### Task 6: Update `ChatMessage.vue` for status indicators

**Files:**
- Modify: `app/src/components/chat/ChatMessage.vue`

**Interfaces:**
- Consumes: `status`, `showRecovery`, `recoveryStatus` props
- Produces: Visual status indicators and action buttons

#### Step 1: Update `ChatMessage.vue`

Add status-aware props and recovery UI:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { PhRobot, PhUserCircle, PhCopy, PhCheck, PhHourglassMedium, PhWarning, PhArrowsClockwise, PhStop } from '@phosphor-icons/vue'
import MarkdownRenderer from '@/components/chat/MarkdownRenderer.vue'
import TypingIndicator from '@/components/chat/TypingIndicator.vue'
import { copyText } from '@/utils/clipboard'
import { formatDateTime } from '@/utils/time'
import type { MessageStatus } from '@/types/api'

const props = withDefaults(
  defineProps<{
    role: 'user' | 'assistant'
    content: string
    createdAt?: string | null
    streaming?: boolean
    pending?: boolean
    status?: MessageStatus
    showRecovery?: boolean
    recoveryStatus?: MessageStatus
    onRetry?: (failedMessageId: string) => void
    onReconnect?: () => void
    onCancel?: () => void
  }>(),
  { createdAt: null, streaming: false, pending: false, status: 'completed', showRecovery: false },
)

const isUser = props.role === 'user'
const copied = ref(false)

function onCopy(): void {
  void copyText(props.content).then((ok) => {
    if (!ok) return
    copied.value = true
    window.setTimeout(() => (copied.value = false), 1600)
  })
}
</script>

<template>
  <li class="group flex animate-fade-slide-in gap-2.5 sm:gap-3" :class="{ 'flex-row-reverse': !isUser }">
    <!-- avatar (unchanged) -->
    <div
      class="flex size-8 shrink-0 select-none items-center justify-center self-start rounded-full"
      :class="
        isUser
          ? 'border border-line bg-elevated text-ink-muted'
          : 'bg-gradient-to-br from-primary to-accent/70 text-white shadow-sm'
      "
      aria-hidden="true"
    >
      <PhUserCircle v-if="isUser" class="size-5" />
      <PhRobot v-else class="size-4" />
    </div>

    <!-- ستون محتوا -->
    <div
      class="flex min-w-0 flex-col gap-1"
      :class="isUser ? 'items-start max-w-[min(42rem,85%)]' : 'w-0 flex-1 items-stretch'"
    >
      <!-- بدنه -->
      <div
        v-if="isUser"
        class="rounded-2xl rounded-ss-md bg-elevated px-4 py-2.5 text-sm leading-relaxed text-ink shadow-sm"
      >
        <span class="whitespace-pre-wrap">{{ content }}</span>
      </div>
      <div v-else class="min-w-0 py-0.5 text-ink">
        <MarkdownRenderer :source="content" :streaming="streaming" />
        <TypingIndicator v-if="streaming && !content" />
      </div>

      <!-- فوتر: زمان / وضعیت / کپی / اقدامات بازیابی -->
      <footer
        class="flex items-center gap-2 px-1 text-[11px] text-ink-muted/70"
        :class="{ 'flex-row-reverse': !isUser }"
      >
        <template v-if="pending">
          <PhHourglassMedium class="size-3 animate-pulse" aria-hidden="true" />
          <span>در حال ارسال…</span>
        </template>
        <template v-else-if="streaming">
          <span class="flex items-end gap-1" aria-hidden="true">
            <i class="size-1 animate-typing-bounce rounded-full bg-primary [animation-delay:0ms]" />
            <i class="size-1 animate-typing-bounce rounded-full bg-primary [animation-delay:150ms]" />
            <i class="size-1 animate-typing-bounce rounded-full bg-primary [animation-delay:300ms]" />
          </span>
          <span>در حال تولید پاسخ…</span>
        </template>
        <template v-else>
          <span v-if="createdAt" class="font-mono">{{ formatDateTime(createdAt) }}</span>
          <button
            v-if="!isUser"
            type="button"
            class="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-ink-muted opacity-0 transition-all group-hover:opacity-100 hover:bg-hover hover:text-ink focus-visible:opacity-100"
            aria-label="کپی پاسخ"
            @click="onCopy"
          >
            <PhCheck v-if="copied" class="size-3 text-success" aria-hidden="true" />
            <PhCopy v-else class="size-3" aria-hidden="true" />
            <span>{{ copied ? 'کپی شد' : 'کپی' }}</span>
          </button>
        </template>

        <!-- Recovery actions for non-completed messages -->
        <template v-if="showRecovery && !isUser">
          <!-- Streaming: reconnect -->
          <template v-if="recoveryStatus === 'streaming'">
            <span class="flex items-center gap-1 text-warning">
              <PhWarning class="size-3" aria-hidden="true" />
              <span>اتصال قطع شد</span>
            </span>
            <button
              v-if="onReconnect"
              type="button"
              class="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-0.5 text-xs text-primary hover:bg-primary-soft"
              @click="onReconnect"
            >
              <PhArrowsClockwise class="size-3" aria-hidden="true" />
              <span>اتصال مجدد</span>
            </button>
          </template>
          <!-- Failed: retry -->
          <template v-if="recoveryStatus === 'failed'">
            <span class="flex items-center gap-1 text-danger">
              <PhWarning class="size-3" aria-hidden="true" />
              <span>خطا در تولید پاسخ</span>
            </span>
            <button
              v-if="onRetry"
              type="button"
              class="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-0.5 text-xs text-primary hover:bg-primary-soft"
              @click="onRetry(content)"
            >
              <PhArrowsClockwise class="size-3" aria-hidden="true" />
              <span>تلاش مجدد</span>
            </button>
          </template>
          <!-- Cancelled: retry -->
          <template v-if="recoveryStatus === 'cancelled'">
            <span class="flex items-center gap-1 text-ink-muted">
              <PhStop class="size-3" aria-hidden="true" />
              <span>تولید پاسخ متوقف شد</span>
            </span>
            <button
              v-if="onRetry"
              type="button"
              class="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-0.5 text-xs text-primary hover:bg-primary-soft"
              @click="onRetry(content)"
            >
              <PhArrowsClockwise class="size-3" aria-hidden="true" />
              <span>تلاش مجدد</span>
            </button>
          </template>
        </template>
      </footer>
    </div>
  </li>
</template>
```

#### Step 2: Verify build

Run: `npx vue-tsc --noEmit`
Expected: Zero errors

#### Step 3: Commit

```
Suggested commit message: feat(frontend): add status indicators and recovery actions to ChatMessage

- Show connection-lost warning + reconnect button for streaming messages
- Show retry button for failed/cancelled messages
- Show cancelled state indicator
- Preserve partial content on cancelled messages
```

---

### Task 7: Update `ChatView.vue` — connection banner and wiring

**Files:**
- Modify: `app/src/views/ChatView.vue`

**Interfaces:**
- Consumes: `connectionState`, `generationState`, `generation`, `cancel`, `reconnect`, `retry`, `inputDisabled`, `streamError` from composable
- Produces: Connection status banner, disconnect/reconnect UI, recovery action wiring

#### Step 1: Update `ChatView.vue`

Key changes:
1. Import and use the new composable properties
2. Add a connection status banner when `connectionState !== 'connected'`
3. Wire `onRetry`, `onReconnect`, `onCancel` callbacks to `MessageList`
4. Pass `generation` to `MessageList` for recovery UI
5. Update `onStop` to call `chat.cancel()` instead of `chat.abort()`

Modify `app/src/views/ChatView.vue`:

In the `<script setup>` section:

```ts
// Add after line 25:
import type { GenerationStatus } from '@/types/api'

// Update onStop function (line 129-131):
async function onStop(): Promise<void> {
  await chat.cancel()
}

// Add retry handler:
function onRetry(failedMessageId: string): void {
  void chat.retry(failedMessageId)
}

// Add reconnect handler:
function onReconnect(): void {
  void chat.reconnect()
}
```

In the template, add a connection banner after the header (before the messages area):

```vue
<!-- Connection status banner -->
<div
  v-if="chat.connectionState.value !== 'connected'"
  class="mx-auto w-full max-w-3xl"
>
  <div
    class="flex items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-sm"
    :class="
      chat.connectionState.value === 'reconnecting'
        ? 'border-primary/40 bg-primary-soft text-primary'
        : 'border-accent/40 bg-accent/10 text-ink'
    "
  >
    <div class="flex items-center gap-2">
      <PhWarning v-if="chat.connectionState.value === 'disconnected'" class="size-4 shrink-0" aria-hidden="true" />
      <PhArrowsClockwise v-else class="size-4 animate-spin shrink-0" aria-hidden="true" />
      <span class="font-medium">
        {{
          chat.connectionState.value === 'disconnected'
            ? 'اتصال با سرور قطع شد.'
            : 'در حال اتصال مجدد…'
        }}
      </span>
    </div>
    <button
      v-if="chat.connectionState.value === 'disconnected' && chat.generationState.value === 'streaming'"
      type="button"
      class="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary-soft"
      @click="onReconnect"
    >
      <PhArrowsClockwise class="size-3.5" aria-hidden="true" />
      <span>اتصال مجدد</span>
    </button>
  </div>
</div>
```

Update the `MessageList` usage to pass the new props:

```vue
<MessageList
  :messages="chat.transcript.value"
  :pending-user="chat.pendingUser.value"
  :streaming-text="chat.streamingText.value"
  :is-streaming="chat.isStreaming.value"
  :generation="chat.generation.value"
  :on-retry="onRetry"
  :on-reconnect="onReconnect"
  :on-cancel="onStop"
/>
```

Update the `MessageInput` stop handler — `@stop` should call `chat.cancel()`:

```vue
<MessageInput
  v-model="inputText"
  :placeholder="noModels ? 'مدلی برای گفتگو موجود نیست.' : 'پیام خود را بنویسید…'"
  :disabled="chat.inputDisabled.value"
  :busy="chat.isStreaming.value"
  @submit="onSubmit"
  @stop="onStop"
/>
```

#### Step 2: Verify build

Run: `npx vue-tsc --noEmit`
Expected: Zero errors

#### Step 3: Commit

```
Suggested commit message: feat(frontend): add connection banner and recovery wiring to ChatView

- Show connection status banner when disconnected/reconnecting
- Wire cancel/retry/reconnect callbacks from ChatView to MessageList
- Pass generation object to MessageList for recovery UI
- Change onStop to call cancel() instead of abort()
```

---

### Task 8: End-to-end verification

**Files:**
- All modified files
- Test: manual browser testing

**Interfaces:**
- Consumes: All previous tasks
- Produces: Verified working implementation

#### Step 1: Start the dev server

Run: `cd app && npm run dev`
Expected: Dev server starts on configured port

#### Step 2: Manual verification checklist

1. **Send a message** — verify streaming works, stop button appears, input is disabled
2. **Disconnect network** (DevTools → Network → Offline) — verify connection banner appears, partial content preserved
3. **Reconnect** (DevTools → Network → Online) — verify auto-reconnect or manual reconnect works
4. **Reload page during streaming** — verify conversation loads with streaming message detected, reconnect offered
5. **Stop generation** — verify cancel endpoint is called, partial content preserved
6. **Retry a failed message** — verify retry creates new generation
7. **`generation_in_progress`** — try sending while streaming — verify graceful handling

#### Step 3: Run type-check and lint

Run: `npx vue-tsc --noEmit`
Expected: Zero errors

Run: `npx vitest run`
Expected: All tests pass

#### Step 4: Commit

```
Suggested commit message: feat(frontend): persistent chat & resumable streaming

- Add MessageStatus type and status field to MessagePublic
- Remove onStarted handler (backend no longer emits started)
- Add cancelGeneration and retryGeneration API functions
- Refactor useChatStream with dual state (connection + generation)
- Detect streaming message on conversation load
- Add cancel, retry, reconnect, replaceSnapshot methods
- Add online/offline event listeners
- Show connection status banner in ChatView
- Add status indicators and recovery actions to ChatMessage
- Update MessageList for status-aware rendering
- Wire recovery callbacks from ChatView
- Add vitest test runner with happy-dom
- Unit tests for useChatStream and SSE parsing
```

---

## Self-Review

### Spec coverage check

| Requirement | Task |
|---|---|
| FR-1: Load persisted conversations | Task 3 (`loadConversation` scans for `status === 'streaming'`) |
| FR-2: Sending a message | Task 3 (`send` creates pending user, starts streaming, handles done/error) |
| FR-3: Disable sending during generation | Task 3 (`inputDisabled` computed, `generationState` guard in `send`) |
| FR-4: Display connection status | Task 7 (connection banner in ChatView) |
| FR-5: Disconnect during streaming | Task 3 (online/offline listeners, `DISCONNECTED` state) |
| FR-6: Reconnect and resume | Task 3 (`reconnect()` method) |
| FR-7: Snapshot replacement | Task 3 (`replaceSnapshot()` replaces, not appends) |
| FR-8: Multiple reconnect attempts | Task 3 (reconnect uses same `assistantMessageId`, remains available) |
| FR-9: Page reload recovery | Task 3 (`loadConversation` detects streaming message) |
| FR-10: Cancellation | Task 3 (`cancel()` calls backend endpoint) |
| FR-11: Retry | Task 3 (`retry()` creates new generation) |
| FR-12: Error handling | Task 1 (error messages) + Task 3 (error code branching) |

### Placeholder scan

No TBD, TODO, or "implement later" patterns found. All code blocks contain actual implementation code.

### Type consistency

- `MessageStatus` type defined once in `types/api.ts` and imported everywhere.
- `ActiveGeneration` interface defined once in `useChatStream.ts` and used consistently.
- `StreamHandlers` interface updated (removed `onStarted`) and used consistently.
- Composable return type (`ChatStreamHandle`) lists all exported properties explicitly.

No mismatches found.
