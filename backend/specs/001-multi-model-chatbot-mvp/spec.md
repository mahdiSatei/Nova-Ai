# Feature Specification: Multi-Model Chatbot Platform (MVP)

**Feature Branch**: `[001-multi-model-chatbot-mvp]`

**Created**: 2026-09-13

**Status**: Draft

**Input**: User description: "this project is going to be a web application as a chatbot with support of multiple models. there is a user and an admin sides. user can register and login, then select desired model and chat with it in a streaming way. admin could edit configurations, including providers, models and apis."

**Scope**: This is the MVP scope of the platform. Scope reductions applied for MVP are recorded under "Out of Scope (MVP)" below.

## Out of Scope (MVP)

The following are intentionally **out of scope** for this MVP phase and MUST NOT
be delivered as part of this spec. They are listed here so the spec stays
explicit about what is deferred:

- Admin management of regular user accounts (no list, search, disable, or
  re-enable of regular users by admin).
- Adding multiple providers — MVP supports exactly one central provider.
- Non-OpenAI-compatible providers (Anthropic-native, Google-native,
  Bedrock-native, etc.) — providers MUST present an OpenAI-compatible
  `/chat/completions` endpoint shape.

These items will be reconsidered in a later phase.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Account Registration and Login (Priority: P1)

A new visitor lands on the chatbot web application and creates an account using
their email and a chosen password. They can subsequently log in from any session
and log out when finished. Password handling follows standard secure practice:
passwords are never stored in plain text, never echoed back in API responses, and
never logged.

**Why this priority**: Without authentication, every other story is either
inaccessible (chat, model selection) or unauthenticated (admin configuration) —
this is the foundation.

**Independent Test**: Can be fully tested by registering a new user via the public
signup endpoint, logging in, receiving a valid session token, and logging out.
Delivers a working identity boundary that all other stories depend on.

**Acceptance Scenarios**:

1. **Given** an unregistered email and a valid password, **When** the visitor
   submits the registration form, **Then** an account is created and the visitor
   is informed the account is ready to use.
2. **Given** an already-registered email, **When** the visitor submits the
   registration form, **Then** the request is rejected with a clear
   "email already in use" message and no account is created.
3. **Given** a registered user with correct credentials, **When** they log in,
   **Then** they receive a valid session and are routed to the chat experience.
4. **Given** a registered user with incorrect credentials, **When** they log in,
   **Then** the request is rejected with a generic "invalid credentials" message
   that does not reveal whether the email exists.
5. **Given** an authenticated user, **When** they log out, **Then** their session
   is invalidated and subsequent requests are rejected.

---

### User Story 2 - Browse and Select a Model (Priority: P1)

An authenticated user opens the application and sees the list of models that the
admin has enabled. Each entry shows the model's display name. The user picks
one model and that selection becomes the active model for their chat session.
If the user has not yet picked a model and the admin has designated a
system-wide default model, that default is preselected and used as the
active model for the user's first message.

**Why this priority**: The user must be able to discover and choose a model
before any chat can happen. This story is the bridge between auth and the
chat experience.

**Independent Test**: Can be tested by seeding at least one enabled model in the
admin configuration, logging in as a user, and verifying the model appears in the
list and can be selected. Disabled models MUST NOT appear.

**Acceptance Scenarios**:

1. **Given** an authenticated user and at least one enabled model configured,
   **When** they open the model picker, **Then** they see all enabled models
   with their display names.
2. **Given** an authenticated user viewing the model picker, **When** they
   select a model, **Then** that model becomes the active model for their next
   message.
3. **Given** an authenticated user who has not explicitly chosen a model and
   the admin has set a default model, **When** they open the chat experience,
   **Then** the default model is preselected as their active model and is
   visually marked as the default in the picker.
4. **Given** an authenticated user, **When** all configured models are
   disabled (or no models have been configured), **Then** the picker shows an
   empty-state message explaining that no models are currently available.

---

### User Story 3 - Streaming Chat with the Selected Model (Priority: P1)

With a model selected, the user types a message and submits it. The system
forwards the message to the central provider that hosts the selected model and
streams the provider's response back to the user's browser token-by-token
(or chunk-by-chunk), so the user sees text appear incrementally rather than
waiting for the full response. The user can submit follow-up messages in the
same conversation, and the system preserves prior turns so the model has
context.

**Why this priority**: This is the core value proposition — a working
multi-model chat with streaming. Everything else (admin config, history) is in
service of this.

**Independent Test**: Can be tested by logging in, selecting an enabled model,
sending a message, and verifying that response text begins arriving before the
provider's full completion. A follow-up message in the same session must
include earlier turns in the request payload sent to the provider.

**Acceptance Scenarios**:

1. **Given** an authenticated user with a model selected, **When** they send a
   message, **Then** response tokens begin arriving within 1 second of the
   provider emitting them and continue streaming until the response is complete.
2. **Given** an active conversation, **When** the user sends a follow-up
   message, **Then** the prior messages in the session are included as context
   to the model.
3. **Given** the user is mid-stream, **When** they navigate away or close the
   browser, **Then** the server-side stream is terminated cleanly without
   leaving an orphaned request.
4. **Given** the streaming response completes, **When** the user reviews the
   conversation, **Then** both the user's message and the assistant's full
   response are visible in the conversation.

---

### User Story 4 - Conversation History (Priority: P2)

The user can see a list of their past conversations, open any of them to read
the full transcript, and start new conversations. They can also delete a
conversation they no longer want to keep.

**Why this priority**: Persistence and revisability are typical expectations for
a chat product and a clear upgrade over single-shot interactions, but the
application is functional without them.

**Independent Test**: Can be tested by completing two chat sessions, then
verifying both appear in the user's history list with correct titles/timestamps,
that one can be reopened to view its full transcript, and that deleting the
other removes it from the list without affecting the first.

**Acceptance Scenarios**:

1. **Given** an authenticated user with at least one completed chat,
   **When** they open the history view, **Then** they see a list of their
   conversations ordered by most recent activity.
2. **Given** an entry in the history list, **When** the user opens it,
   **Then** the full transcript of messages is displayed in order.
3. **Given** a conversation in the history list, **When** the user deletes it,
   **Then** it is removed from the list and no longer retrievable.

---

### User Story 5 - Admin Authentication and Role Separation (Priority: P1)

A separate operator accesses the admin panel using their own credentials. Admin
accounts are distinct from regular user accounts — a regular user MUST NOT be
able to access admin endpoints even with a valid session. Admin sessions are
issued only to accounts that hold the admin role.

**Why this priority**: Without role separation, regular users could read or
modify the central provider credential and model configuration. This is a hard
security boundary.

**Independent Test**: Can be tested by creating both a regular user and an
admin user, logging in as each, and verifying that admin endpoints return
"forbidden" for the regular user's session and succeed for the admin's session.

**Acceptance Scenarios**:

1. **Given** an admin user with valid credentials, **When** they log in via the
   admin login flow, **Then** they receive an admin-elevated session.
2. **Given** a regular user's session token, **When** the request targets any
   admin endpoint, **Then** the response is "forbidden" regardless of payload.
3. **Given** no session, **When** an admin endpoint is targeted, **Then** the
   response is "unauthenticated".

---

### User Story 6 - Admin Configures the Central Provider (Priority: P1)

An authenticated admin can view and edit the application's single central
provider configuration. The central provider has exactly two fields the admin
manages: a base URL and an API credential (key/token). The system MUST speak to
the configured base URL using an OpenAI-compatible `/chat/completions` request
shape. Saved credentials MUST be stored encrypted at rest and MUST NEVER appear
in API responses or logs after the initial save.

The central provider is a singleton — there is exactly one. Creating a second
provider is out of scope for the MVP.

**Why this priority**: Without a working central provider, no model can answer
requests. This is the backbone of the admin's configuration work.

**Independent Test**: Can be tested by logging in as admin, viewing the
central provider (credential is masked), updating the base URL and credential,
and verifying the new values are used on the next chat request.

**Acceptance Scenarios**:

1. **Given** an authenticated admin, **When** they open the central provider
   configuration, **Then** the base URL is shown and the credential is masked.
2. **Given** an authenticated admin editing the central provider, **When** they
   save valid credentials, **Then** the new values are persisted and the
   next chat request uses the updated base URL and credential.
3. **Given** an authenticated admin editing the central provider, **When** they
   save invalid credentials, **Then** the save fails with a clear "the
   provider rejected the credentials" message and the prior values remain in
   effect.
4. **Given** an authenticated admin, **When** they request the central provider
   details via API, **Then** the credential is masked or omitted — never
   returned in clear text.

---

### User Story 7 - Admin Manages Available Models (Priority: P1)

An authenticated admin can add, edit, enable/disable, and remove models. Each
model has two names:

- a **display name** that is shown to end users in the model picker, and
- an **actual name** that is the identifier the system sends verbatim to the
  provider (e.g., the OpenAI-compatible model identifier such as
  `gpt-4o-mini`).

Both names are independently editable. The display name is for humans; the
actual name is the value the provider expects. Disabled models MUST NOT
appear to end users; enabled models MUST appear.

**Why this priority**: Models are the unit of choice for users. The admin's
ability to curate the catalog is what makes the "multiple models" claim real.

**Independent Test**: Can be tested by logging in as admin, adding two models
with distinct display names and actual names, disabling one, then logging in
as a regular user and verifying only the enabled model's display name appears
in the model picker (the actual name is not shown to users).

**Acceptance Scenarios**:

1. **Given** an authenticated admin, **When** they add a new model with a
   display name and an actual name, **Then** the model is persisted and
   enabled by default.
2. **Given** an authenticated admin viewing the models list, **When** they
   edit a model, **Then** they can change the display name, the actual name,
   and the enabled state independently.
3. **Given** an existing model, **When** the admin disables it, **Then** it
   disappears from the user-facing model picker but remains in the admin
   view.
4. **Given** an existing model, **When** the admin deletes it, **Then** it
   is removed from both the admin view and the user-facing model picker.
5. **Given** an end user viewing the model picker, **When** they see a
   model entry, **Then** ONLY the display name is shown — the actual name
   is never exposed.

---

### User Story 8 - Admin Sets the Default Model (Priority: P1)

An authenticated admin can designate exactly one enabled model as the
**system-wide default model** that is used as the active model for any user
who has not explicitly chosen one. At any moment there is at most one
default; setting a new default replaces the prior default. Disabling the
current default removes the default (no model is then the system default).
Only one model can be the default at a time, and only enabled models are
eligible to be designated as default.

**Why this priority**: Without a default model, new users who have not yet
explored the model picker would have to make an explicit selection before
they can send their first message — turning "open the app and start
chatting" into a multi-step flow that the MVP is supposed to remove.

**Independent Test**: Can be tested by logging in as admin, designating a
model as the default, logging in as a fresh user who has never selected a
model, opening the chat, and verifying the default model is preselected and
used for the first message without an explicit user choice.

**Acceptance Scenarios**:

1. **Given** an authenticated admin and at least one enabled model, **When**
   they designate one of those models as the default, **Then** the system
   records that model as the default.
2. **Given** the system already has a default model, **When** the admin
   designates a different enabled model as the default, **Then** the prior
   default is replaced and only the newly designated model is the default.
3. **Given** the current default is an enabled model, **When** the admin
   disables that model, **Then** the system MUST remove the default (no
   model is the default) and any subsequent user selection falls back to
   the user-picker empty state until the admin designates a new default.
4. **Given** an authenticated admin attempts to designate a disabled model
   as the default, **When** they submit the change, **Then** the system
   MUST reject the action with a clear "only enabled models can be the
   default" message and leave the prior default unchanged.

### Edge Cases

- **Provider outage mid-stream**: If the central provider becomes unreachable
  while a response is streaming, the stream MUST terminate and the user MUST
  see a clear "the provider is currently unavailable" message. Partial output
  already delivered stays visible.
- **Disabled model mid-conversation**: If an admin disables the model the
  user is currently chatting with, the in-flight response finishes;
  subsequent messages in the same session use a fallback behavior (the user
  is informed the model is no longer available and is prompted to pick
  another).
- **Central provider credential compromised / rotated**: An admin can
  update the central provider's credential without restarting the service,
  and chat requests use the new credential after the change is saved.
- **Central provider not yet configured**: If the admin has not yet saved
  any central provider configuration (or has saved blank base URL / blank
  credential), the model picker MUST still be reachable but sending a
  message MUST surface a "chat is not configured yet" message rather than
  attempting an outbound request with empty values.
- **Concurrent chat sessions**: The same user may have multiple chat
  conversations open in parallel; sessions MUST be independent and not
  share context unless they are the same conversation.
- **Rate limiting from provider**: When the provider returns a rate-limit
  error, the system MUST surface a clear "rate limit reached, please retry"
  message to the user rather than crashing or hanging.
- **Empty / oversized messages**: An empty message MUST NOT be sent. A
  message exceeding the configured size limit MUST be rejected before
  reaching the provider.
- **Malformed provider responses**: A malformed response from the provider
  MUST terminate the stream cleanly with an error message rather than
  corrupting the user's view.
- **Non-OpenAI-compatible provider configured**: If the admin points the
  central provider at a URL whose `/chat/completions` endpoint does NOT
  accept OpenAI-compatible requests, the system MUST surface a clear
  "this provider is not OpenAI-compatible" error and MUST NOT corrupt the
  user-visible stream.
- **Actual name unknown to provider**: If a model's actual name is not
  recognized by the provider (e.g., a typo, or the model has been retired),
  the provider's error MUST be surfaced to the user as a clear message
  rather than as an opaque failure.
- **Default model unavailable for first-time user**: If a user opens the app
  and the admin's designated default model has been disabled or deleted, the
  system MUST NOT attempt to use that model for the user's first message;
  the user MUST be shown an empty-state picker instructing them to choose a
  model explicitly.
- **Default changes mid-session**: If the admin changes or removes the
  default while a user is in an active conversation, the conversation
  completes against the model it started with; subsequent new conversations
  resolve the active model against the new default (or against the user's
  last explicit selection if any).
- **No default designated**: If the admin has never designated a default
  model, first-time users MUST see the empty-state picker; the system MUST
  NOT silently fall back to an arbitrary enabled model.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow visitors to register an account using email
  and password, with email uniqueness enforced and passwords stored using a
  modern, salted password-hashing algorithm.
- **FR-002**: System MUST allow registered users to log in and receive an
  authenticated session, and MUST allow them to log out and invalidate the
  session.
- **FR-003**: System MUST allow authenticated users to view the list of models
  currently enabled by the admin and to select one as their active model.
- **FR-004**: System MUST accept a chat message from an authenticated user
  with an active model selected and MUST stream the model's response back to
  the user as the provider emits tokens, by calling the central provider's
  OpenAI-compatible `/chat/completions` endpoint in streaming mode.
- **FR-005**: System MUST persist each completed chat exchange (user message
  and assistant response) under the user's account and MUST present the user's
  past conversations in a history view, ordered by most recent activity.
- **FR-006**: System MUST allow users to delete their own conversations.
- **FR-007**: System MUST distinguish regular-user sessions from admin
  sessions; admin-only endpoints MUST reject regular-user sessions and
  unauthenticated requests.
- **FR-008**: System MUST allow an authenticated admin to view and edit the
  single central provider's configuration (base URL and API credential).
  Creating additional providers is out of scope.
- **FR-009**: System MUST validate the central provider's credentials against
  the configured base URL using an OpenAI-compatible probe before persisting
  a new or updated configuration, and MUST refuse to save invalid
  credentials.
- **FR-010**: System MUST store the central provider's API credential
  encrypted at rest and MUST NEVER return it in clear text in any API
  response, log entry, or client-visible error.
- **FR-011**: System MUST allow an authenticated admin to create, edit,
  enable/disable, and delete models. Each model MUST have a display name
  (shown to users) and an actual name (sent to the provider); the two MUST
  be independently editable.
- **FR-012**: System MUST expose only enabled models to end users; disabled
  models MUST NOT appear in the user-facing model picker. The display name
  is what users see; the actual name is NEVER exposed to end users.
- **FR-013**: System MUST terminate streaming responses cleanly when the
  client disconnects, the provider errors, or the provider returns malformed
  data, and MUST surface a clear error message to the user in each case.
- **FR-014**: System MUST reject empty messages and messages exceeding a
  configured size limit before they reach the provider.
- **FR-015**: System MUST include prior conversation turns as context when
  forwarding a follow-up user message to the provider.
- **FR-016**: When no central provider configuration is set (blank base URL
  or missing credential), the system MUST surface a clear "chat is not yet
  configured" message to the user and MUST NOT attempt an outbound request
  to the provider.
- **FR-017**: The system MUST treat the configured base URL as an
  OpenAI-compatible endpoint. If the configured provider does not accept
  OpenAI-shaped requests or returns non-OpenAI-shaped responses, the system
  MUST surface a clear error rather than silently corrupt the stream.
- **FR-018**: System MUST allow an authenticated admin to designate exactly
  one enabled model as the system-wide default model. Setting a new default
  replaces the prior default. Only enabled models are eligible to be the
  default; attempting to designate a disabled model MUST be rejected
  without changing the existing default.
- **FR-019**: System MUST apply the admin's designated default model as the
  active model for any user who has not made an explicit choice. If no
  default is designated, the system MUST show the empty-state picker and
  MUST NOT silently fall back to an arbitrary enabled model.
- **FR-020**: System MUST keep a user's explicit model choice sticky: once a
  user has selected a model, subsequent chat requests use that choice
  until they pick a different model, regardless of changes the admin makes
  to the default.

### Key Entities

- **User**: An account holder. Attributes: email, password hash, role
  (regular or admin), creation timestamp, last-login timestamp.
- **Conversation**: A chat session belonging to one user with one model.
  Attributes: owner user, selected model (by its internal id), title
  (derived or user-supplied), created/updated timestamps.
- **Message**: An individual turn in a conversation. Attributes: parent
  conversation, role (user or assistant), content, created timestamp.
- **CentralProvider**: A singleton configuration for the single provider
  used by the MVP. There is at most one instance. Attributes: API base
  URL, encrypted API credential, last-validated timestamp.
- **Model**: An AI model offered via the central provider. Attributes:
  display name (human-facing), actual name (identifier sent verbatim to
  the provider), enabled flag, `is_default` flag (true for at most one
  enabled model at any time), created/updated timestamps.
- **AppConfig**: A singleton system-wide configuration record that
  references the current default model (by its internal id). It holds no
  more than one reference: the id of the model currently designated as
  default (nullable when no model is the default).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new visitor can complete registration, log in, select a
  model, and send a first message that begins streaming within 3 minutes
  of landing on the site.
- **SC-002**: Response tokens from the provider reach the user's browser
  within 1 second of the provider emitting them, measured from network
  egress to client render.
- **SC-003**: The system supports at least 100 concurrent active streaming
  chat sessions without measurable degradation in token-arrival latency.
- **SC-004**: An admin can save the central provider configuration and add
  an enabled model, and have that model visible to end users, in under 5
  minutes from the start of the configuration task.
- **SC-005**: 95% of chat completions finish without error; failures
  surface a human-readable message and never expose internal details.
- **SC-006**: The central provider's API credential appears in zero API
  responses and zero log lines after the initial save (verified by
  automated test).
- **SC-007**: Regular-user sessions are rejected by every admin endpoint
  100% of the time (verified by automated test).
- **SC-008**: The user-facing model picker shows the model's display name
  and never the actual name (verified by automated test on a representative
  set of model rows).
- **SC-009**: When the admin has designated a default model and a fresh
  user has not made an explicit selection, that user's first chat request
  is sent against the default model without any required user action
  (verified by automated test seeding default = model A and observing the
  request to model A).

## Assumptions

- The "API" mentioned in the original admin configuration scope refers to
  the central provider's API credential (key or token) used to call the
  provider's models, not an internal admin API surface.
- MVP supports exactly one provider. "Multi-provider" admin features
  (creating, listing, deleting multiple providers) are deferred to a later
  phase.
- "OpenAI-compatible provider" means the central provider exposes an HTTP
  endpoint under the configured base URL that accepts POST requests in the
  OpenAI Chat Completions shape (messages array, model string, stream flag)
  and returns either NDJSON/server-sent chunks (when streaming) or a JSON
  completion object (when not streaming). Providers that require a
  vendor-specific request shape (Anthropic `/v1/messages`, Google's
  `:generateContent`, etc.) are not OpenAI-compatible under this
  definition.
- Authentication for both users and admins uses email and password with a
  modern salted hash (e.g., bcrypt, Argon2). No SSO or external identity
  provider is required for the MVP.
- Admin accounts are provisioned out-of-band (e.g., seeded at install time
  or created by another admin) rather than via self-service signup. The
  MVP does not include a self-service "become an admin" path.
- Streaming transport is server-sent events (SSE) or HTTP chunked transfer,
  both common choices for token streaming; the choice is an implementation
  detail rather than a user-facing requirement.
- The application targets modern web browsers (latest two major versions
  of Chrome, Firefox, Safari, Edge) on desktop and mobile web. Native
  mobile apps are out of scope for the MVP.
- Conversations are retained indefinitely by default; a user-initiated
  delete is the only way a conversation is removed. Bulk export and
  retention policies are out of scope for the MVP.
- Provider outages are handled with retry-and-backoff inside a single
  request; automatic cross-provider failover is out of scope for the MVP.

## Clarifications

### Session 2026-09-13

- Q: This is the MVP version — are admin user management capabilities in scope? → A: No. Admin user management (list, search, disable, re-enable regular users) is out of scope for the MVP.
- Q: Are multiple providers in scope for the MVP? → A: No. The MVP supports exactly one central provider (a single configuration with `base_url + api_key`).
- Q: What can the admin manage regarding providers and models? → A: The admin manages models only. The admin also edits the single central provider's `base_url` and `api_key`, but does not create additional providers.
- Q: What fields does a model have? → A: Each model has a display name (human-facing, shown to users) and an actual name (the identifier sent verbatim to the provider, e.g., an OpenAI model id). Both are independently editable.
- Q: Which provider compatibility class is required for the MVP? → A: OpenAI-compatible providers only for the MVP. The central provider MUST expose an OpenAI-compatible `/chat/completions` endpoint.
- Q: Spec directory naming reflects MVP scope? → A: The feature directory is `specs/001-multi-model-chatbot-mvp` (renamed by the operator).
- Q: Can admin designate a default model that applies to users? → A: Yes. Admin can designate exactly one enabled model as the system-wide default model. The default applies to users who have not made an explicit model choice. Setting a new default replaces the prior one. The default is implicitly cleared if the chosen default becomes disabled or deleted.
- Q: What scope is the default — system-wide or per-user? → A: System-wide, single default (one model is the default for all users who have not picked one). Per-user defaults are not in MVP scope.
- Q: Should the default model be visible/marked for users? → A: Yes — the user-facing model picker should visually mark the current default so users can tell which model they would get by default. The actual provider-side identifier remains hidden from users.
