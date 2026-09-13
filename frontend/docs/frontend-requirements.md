# Frontend Specification — Phase 1 (MVP)
**Project:** CODELESS — AI Multi-Model Chat Platform  
**Target:** Days 1–2 (Vue 3 App Setup, Auth Flow, Chat Interface with SSE, Admin Models Panel)  
**Stack:** Vue 3 (Composition API `<script setup>`), Vite, Tailwind CSS, Pinia, Vue Router, Lucide Icons, Markdown-it  
**Text Direction:** LTR (Left-To-Right)

---

## 1. Project Structure & Organization

The frontend must be structured using Vue 3 Composition API with `<script setup lang="ts">`:

src/ ├── assets/ # Global styles, fonts ├── components/ │ ├── common/ # Button,
Input, Modal, Dropdown, ToggleSwitch │ ├── chat/ # ChatMessage.vue,
ChatInput.vue, ModelSelector.vue │ └── layout/ # AppSidebar.vue,
ConversationItem.vue ├── composables/ # useChatStream.ts, useAutoScroll.ts ├──
layouts/ │ ├── AuthLayout.vue │ ├── MainLayout.vue # Sidebar + Content Area │
└── AdminLayout.vue ├── router/ │ └── index.ts # Routes and navigation guards
├── services/ # Axios/Fetch API client modules │ ├── api.ts # Axios
instance with Bearer interceptor │ ├── auth.service.ts │ ├── models.service.ts │
├── conversations.service.ts │ └── chat.service.ts # Streaming fetch handler ├──
stores/ │ ├── auth.store.ts │ ├── models.store.ts │ └── chat.store.ts ├── types/
# TypeScript interfaces for Entities & DTOs └── views/ ├── AuthView.vue # /auth
(Login & Register toggle) ├── ChatView.vue # /chat and /chat/:conversationId └──
AdminModelsView.vue # /admin/models


---

## 2. Environment Configuration (`.env`)

```env
VITE_API_BASE_URL=http://localhost:3000/api

3. State Management (Pinia Stores)

3.1. useAuthStore (stores/auth.store.ts)

  - State:
    interface AuthState {
      token: string | null;
      user: { id: string; email: string; role: 'user' | 'admin' } | null;
      isAuthenticated: boolean;
    }
  - Actions:
      - setAuth(user, token): Saves token to localStorage and memory; sets
        default Axios header.
      - logout(): Clears token, user, resets chat store, redirects to /auth.
      - fetchCurrentUser(): Calls GET /api/auth/me on app launch if token
        exists.

3.2. useModelsStore (stores/models.store.ts)

  - State:
    interface ModelsState {
      activeModels: Array<{ id: string; modelId: string; displayName: string; isDefault: boolean }>;
      allAdminModels: Array<{ id: string; modelId: string; displayName: string; isActive: boolean; isDefault: boolean }>;
      selectedModelId: string | null;
      isLoading: boolean;
    }
  - Actions:
      - fetchActiveModels(): Calls GET /api/models; sets selectedModelId to the
        default model.
      - fetchAdminModels(): Calls GET /api/admin/models (admin only).
      - toggleModelActive(id: string): Calls PATCH
        /api/admin/models/:id/toggle-active.
      - setDefaultModel(id: string): Calls PATCH
        /api/admin/models/:id/set-default.

3.3. useChatStore (stores/chat.store.ts)

  - State:
    interface ChatState {
      conversations: Array<{ id: string; title: string; updatedAt: string }>;
      activeConversationId: string | null;
      messages: Array<{ id?: string; sender: 'user' | 'assistant'; content: string; createdAt?: string }>;
      isStreaming: boolean;
      error: string | null;
    }
  - Actions:
      - fetchConversations(): Calls GET /api/conversations.
      - selectConversation(id: string): Loads messages via GET
        /api/conversations/:id/messages.
      - startNewChat(): Clears activeConversationId and messages, navigates to
        /chat.
      - appendChunkToLastMessage(content: string): Appends incoming token to the
        assistant's placeholder.

4. Routing & Route Guards (router/index.ts)

| Route Path              | View Component                              | Guard / Access Level                                  |
| ----------------------- | ------------------------------------------- | ----------------------------------------------------- |
| `/auth`                 | `AuthView.vue`                              | Public (Redirect to `/chat` if already authenticated) |
| `/chat`                 | `ChatView.vue` (under `MainLayout`)         | Requires Authentication                               |
| `/chat/:conversationId` | `ChatView.vue` (under `MainLayout`)         | Requires Authentication                               |
| `/admin/models`         | `AdminModelsView.vue` (under `AdminLayout`) | Requires Authentication + `role === 'admin'`          |
| `/:pathMatch(.*)*`      | Redirect to `/chat`                         | Fallback                                              |

Navigation Guard Rules:

1.  If route requires auth and token is missing: redirect to /auth.
2.  If route requires admin role and user.role !== 'admin': redirect to /chat.
3.  If user is authenticated and attempts to visit /auth: redirect to /chat.

5. UI Views & Requirements

5.1. Authentication View (/auth)

  - Minimalist centered card with clean toggle: [Sign In] | [Sign Up].
  - Form fields:
      - Email (input[type="email"])
      - Password (input[type="password"])
      - Submit Button (with loading spinner state)
  - Displays inline error message if API returns an error.
  - On success: stores auth state and immediately redirects to /chat.

5.2. Main Chat View (/chat & /chat/:id)

  - Layout Structure:
      - Sidebar (Left, 260px fixed width, collapsible on mobile):
          - Top: "+ New Chat" primary button.
          - Middle: Scrollable list of user conversations. Active conversation
            is highlighted.
          - Bottom: User email label, role badge (if Admin: button linking to
            /admin/models), and "Logout" icon button.
      - Main Chat Area (Flex-1):
          - Top Header: Model selector dropdown (shows active models fetched
            from useModelsStore). Displays active model's displayName.
          - Message Feed Container (Flex-1, auto-scrolling):
              - User messages: Aligned right, distinct background color (e.g.
                bg-zinc-800 or bg-blue-600), plain text.
              - Assistant messages: Aligned left, clean card background with
                rendered Markdown (paragraphs, bullet lists, code blocks with
                pre/code formatting).
              - Streaming indicator: Subtle blinking cursor (▋) while
                isStreaming === true.
          - Input Bar (Bottom fixed):
              - Auto-resizing textarea or single-line textarea.
              - Submits on Enter (without Shift). Shift+Enter inserts a newline.
              - Send icon button (disabled when streaming or input is empty).

5.3. Admin Models View (/admin/models)

  - Back button navigating back to /chat.
  - Header: "AI Models Management".
  - Clean table displaying all models:
      - Columns: Model Identifier, Display Name, Status (Active / Inactive),
        Default Selection.
      - Status column: Toggle switch calling toggleModelActive(model.id).
        (Disabled if model is currently default).
      - Default column: Radio button or "Set as Default" button calling
        setDefaultModel(model.id).

6. SSE Streaming Implementation Pattern (Critical)

Standard Axios does not handle stream reading cleanly in browsers. The streaming
must be executed using the native fetch() API with ReadableStream reader.

Composable: useChatStream.ts

export async function sendChatMessageStream({
  conversationId,
  message,
  modelId,
  token,
  onStart,
  onChunk,
  onDone,
  onError,
}: {
  conversationId?: string | null;
  message: string;
  modelId?: string | null;
  token: string;
  onStart: (convId: string) => void;
  onChunk: (chunk: string) => void;
  onDone: (messageId: string) => void;
  onError: (err: string) => void;
}) {
  try {
    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ conversationId, message, modelId }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`HTTP Error ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || ''; // keep trailing unparsed data

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const raw = line.replace('data: ', '').trim();
          if (!raw) continue;
          const payload = JSON.parse(raw);

          if (payload.type === 'start') onStart(payload.conversationId);
          else if (payload.type === 'chunk') onChunk(payload.content);
          else if (payload.type === 'done') onDone(payload.messageId);
          else if (payload.type === 'error') onError(payload.message);
        }
      }
    }
  } catch (error: any) {
    onError(error.message || 'Stream connection failed');
  }
}

7. Markdown & Code Block Rendering

  - Install: npm install markdown-it @types/markdown-it
  - Use a lightweight helper or custom directive:

import MarkdownIt from 'markdown-it';
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

export function renderMarkdown(content: string): string {
  return md.render(content || '');
}

  - Style code tags in CSS/Tailwind:
    .prose pre {
      background-color: #1e1e2e;
      color: #f8f8f2;
      padding: 0.75rem 1rem;
      border-radius: 0.5rem;
      overflow-x: auto;
      direction: ltr;
    }

8. Definition of Done (DoD) for Frontend Agent

- [ ] App compiles without TypeScript or Vite errors (npm run build).
- [ ] Users can register and login; session token persists on page refresh.
- [ ] Unauthorized users are redirected away from /chat and /admin.
- [ ] User can create a new conversation and send a message.
- [ ] Tokens stream in real time into the assistant bubble without lag or
  re-rendering entire history.
- [ ] Markdown renders properly for lists, bold text, and code blocks.
- [ ] Sidebar dynamically lists past conversations and allows switching between
  them.
- [ ] Admin user can access /admin/models and toggle active state / change
  default model.

