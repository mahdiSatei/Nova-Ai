# Frontend-Ready Product Specification

> **Multi-Model Chatbot — MVP**
>
> This document is a behavior-level specification for the frontend
> product. It is intentionally **technology-agnostic**: it describes
> what users see, do, and experience — not how the backend implements
> it. The companion machine-readable artifacts live alongside:
>
> - `spec.md` — feature-level requirements
> - `api-contract.md` — narrative API contract (reference)
> - `contracts/openapi-3.1.yaml` — machine-readable contract (reference)
>
> When this document and the references disagree on **product
> behavior**, this document is the winner. When they disagree on
> **technical contract shape**, the OpenAPI YAML is the winner.

---

## 1. Product Context

### 1.1 Product Name

**Multi-Model Chatbot** (web application, MVP scope).

### 1.2 Problem Statement

Users want to converse with different AI models through a single
interface, without registering separately with each provider. Operators
want to curate which models are available and pre-select a sensible
default so first-time users can start chatting immediately.

### 1.3 Target Users

| Role | Description |
|---|---|
| **User** | A registered person who wants to chat with AI models. They want a low-friction chat experience with the ability to switch models. |
| **Admin** | A privileged operator who configures the single AI provider used by the product and curates which models the user sees. Admin accounts are provisioned out-of-band (no self-service signup). |

Anonymous (unauthenticated) visitors are not yet users — they only see
the login and registration screens.

### 1.4 Product Goals

- **G1** — Let any visitor create an account in under three minutes and send their first message to an AI model without manual setup.
- **G2** — Stream model responses so the user sees output as it is generated, not after a long pause.
- **G3** — Persist each user's conversations so they can return, continue, and review past chats.
- **G4** — Give a single operator (admin) full control over which AI models are available and which is the default.
- **G5** — Make switching between AI models trivial from the user side.

### 1.5 Scope (MVP)

In scope for the first release:

- Visitor registration and login.
- Browsing the list of available models.
- Selecting a model and starting a chat.
- Streaming chat with prior-turn context preserved within a conversation.
- Listing, opening, and deleting the user's past conversations.
- Admin login and role separation.
- Admin configuration of the single AI provider.
- Admin management of the model catalog (add, edit, enable/disable, delete).
- Admin selection of the system-wide default model.

### 1.6 Non-Goals (Explicitly Out of MVP Scope)

The following are deferred and MUST NOT be assumed available:

- Multiple AI providers (the MVP supports exactly one configured provider).
- Provider protocols other than OpenAI-compatible chat completions.
- Admin management of regular user accounts (list, search, disable, re-enable).
- Self-service admin provisioning (admins are seeded out-of-band).
- Password reset, email verification, two-factor authentication, single sign-on.
- Real-time cross-device conversation sync.
- File attachments, image inputs, or rich media in chat.
- Voice input/output.
- Cost tracking, token quotas, billing.
- Notifications (in-app, email, push).
- Search or full-text lookup across conversations.
- Analytics, telemetry dashboards, or exportable conversation archives.
- Native mobile applications.
- Multi-language / localization of UI strings.
- Public unauthenticated demo or guest mode.

### 1.7 Assumptions and Constraints

The following are **assumed** to make the specification implementable.
Each is low-risk and reversible; see §9 if any should be raised with
the product owner.

- A1 — Users access the product via modern desktop or mobile web browsers (latest two major versions of Chrome, Firefox, Safari, Edge).
- A2 — The product exposes a stable, versioned contract surface. The frontend relies only on contract-stable data shapes, not internal table layouts.
- A3 — Conversations are retained indefinitely until the user deletes them. There is no global retention timer.
- A4 — There is exactly one admin account per deployment in the MVP (the spec defers multi-admin concerns).
- A5 — User interface text is English in the MVP.
- A6 — The product is a single-page web app; auth and chat history are loaded after sign-in.
- A7 — Streaming connections are short-lived per turn (open during generation, close at completion or error); the frontend opens a fresh streaming request per user message.

### 1.8 Hard Constraints

These are non-negotiable and come from governance:

- **C1** — No provider API credential, in cleartext or masked form, is ever returned to the end-user surface. The mask that *admins* see is for admin eyes only.
- **C2** — Provider API credentials are stored encrypted at rest.
- **C3** — User passwords are never stored in cleartext and never returned in any response. Password reset / recovery is not in MVP.
- **C4** — All client-visible error messages are sanitized. Stack traces and internal details appear only in server logs.
- **C5** — Regular users cannot reach admin surfaces; auth enforcement is mandatory.
- **C6** — The actual model identifier sent to the AI provider is **never** shown to end users. Only the human-facing model name is visible in the picker.

---

## 2. Features & User Stories

Each feature groups a related user journey. Numbering follows the
priority order in the source spec; P1 = must-ship for MVP, P2 = also
must-ship for MVP.

### Feature F1 — Account Registration and Login (P1)

**Description:** Visitors create an account, log in, and log out. The
identity boundary is the prerequisite for every other user-facing
feature.

**User Stories:**
- US1.1 — As a visitor, I want to create an account with email and password so that I have a persistent identity for saving conversations.
- US1.2 — As a registered user, I want to log in with email and password so that I can access my account from any browser session.
- US1.3 — As a logged-in user, I want to log out so that subsequent use of the device is not attributed to me.
- US1.4 — As a registered user, I want the system to react identically whether I typed a wrong password or a wrong email so that no one can probe whether a given email is registered.

**Requirements:**
- FR-001 — The system shall let visitors submit a registration request with an email and a password; on success, an account is created with the "user" role, and the visitor is signed in.
- FR-002 — The system shall reject a registration whose email is already in use, without creating anything.
- FR-003 — The system shall reject registrations with a malformed email or a password that does not meet the rules listed in §3 (BR-001, BR-002).
- FR-004 — The system shall let registered users submit a login with email and password; on success, the user receives an authenticated session.
- FR-005 — The system shall treat any login failure (wrong email, wrong password, disabled account) as the same error, with the same wording, so email enumeration is impossible.
- FR-006 — The system shall let an authenticated user end their session; subsequent requests from that session are rejected.

### Feature F2 — Browse and Select a Model (P1)

**Description:** An authenticated user sees the list of models the
admin has made available and picks one as the model that drives their
next message.

**User Stories:**
- US2.1 — As a user, I want to see all available models so that I can choose one.
- US2.2 — As a user, I want to know which model is the system default so that I understand which model my first message will go to without picking.
- US2.3 — As a user, I want the default model preselected automatically so that I can start chatting without making a choice.
- US2.4 — As a user, I want the picker to tell me when no models are available so that I do not think the product is broken.

**Requirements:**
- FR-007 — The system shall show an authenticated user only models whose status is "enabled by the admin"; disabled models are not visible.
- FR-008 — The system shall mark which model is the current system default in the picker.
- FR-009 — The system shall preselect the current system default for any user who has not made an explicit selection.
- FR-010 — The system shall show an empty-state message in the picker when no enabled model exists.

### Feature F3 — Streaming Chat with the Selected Model (P1)

**Description:** The user types a message and sees the model's
response appear progressively. Earlier turns in the same conversation
are sent to the model as context so it can continue the discussion.

**User Stories:**
- US3.1 — As a user, I want to type a message and see the model's response appear as it is generated so that I do not wait for a long pause.
- US3.2 — As a user, I want my prior messages in the conversation to be remembered so that the model can continue from where we left off.
- US3.3 — As a user, I want to see clearly when a response begins and when it ends so that I know what the assistant produced.
- US3.4 — As a user, I want the streaming to terminate cleanly when I leave the page so that resources are not wasted.

**Requirements:**
- FR-011 — The system shall accept a user message and stream the model's response incrementally as text, so the user sees output before the model has finished generating.
- FR-012 — The system shall include prior turns of the same conversation as context to the model when the user sends a follow-up.
- FR-013 — The system shall persist both the user's message and the assistant's full response once the response is complete.
- FR-014 — The system shall terminate the streaming generation cleanly if the client disconnects mid-stream.
- FR-015 — When the selected model is unavailable for any reason (provider not configured, default changed mid-session, model disabled), the system shall tell the user clearly that no model is currently available, rather than attempting an undefined fallback.

### Feature F4 — Conversation History (P2)

**Description:** Users can list, open, and delete their past
conversations.

**User Stories:**
- US4.1 — As a user, I want to see a list of my past conversations so that I can find one I want to revisit.
- US4.2 — As a user, I want to open a past conversation and read its full transcript so that I can review it.
- US4.3 — As a user, I want to delete a conversation I no longer need so that it no longer appears in my history.

**Requirements:**
- FR-016 — The system shall show a user a list of their conversations, ordered by most recent activity first.
- FR-017 — The system shall let a user open one of their conversations and see its full ordered transcript.
- FR-018 — The system shall let a user permanently delete one of their conversations, along with all its messages.

### Feature F5 — Admin Role Separation (P1)

**Description:** Admin accounts are distinct from regular user
accounts. Admin surfaces are inaccessible to regular users.

**User Stories:**
- US5.1 — As an admin, I want to log in with my admin credentials so that I can configure the system.
- US5.2 — As a regular user, I want to be unable to reach admin surfaces so that I cannot accidentally or intentionally change configuration.

**Requirements:**
- FR-019 — The system shall distinguish admin sessions from regular user sessions; the same login form is used, but only accounts with the "admin" role receive an admin session.
- FR-020 — The system shall reject any request from a non-admin or unauthenticated session to any admin surface.

### Feature F6 — Admin Configures the Central Provider (P1)

**Description:** An admin enters the AI provider's base URL and
credential. The system validates the credential before persisting it
and never returns the cleartext credential afterward.

**User Stories:**
- US6.1 — As an admin, I want to provide a base URL and a credential for the AI provider so that the system can talk to it.
- US6.2 — As an admin, I want the system to verify my credential before saving so that I do not end up with a broken configuration.
- US6.3 — As an admin, I want the saved credential to be hidden from me in subsequent reads so that it is not sitting around in plain view.

**Requirements:**
- FR-021 — The system shall let an admin view and edit the central provider's base URL and credential.
- FR-022 — Before persisting, the system shall verify the supplied credential against the configured base URL with a minimal non-streaming call; on failure, nothing is saved.
- FR-023 — The saved credential shall be visible to the admin only in masked form (last few characters prefixed with a known marker); the cleartext credential shall not appear in any response or admin-facing read.

### Feature F7 — Admin Manages Available Models (P1)

**Description:** Admins add, edit, enable/disable, and delete models
in the catalog. Each model has a human-facing name and an
AI-provider-side name.

**User Stories:**
- US7.1 — As an admin, I want to add a new model with a display name and a provider-side name so that it becomes available to users.
- US7.2 — As an admin, I want to disable a model temporarily so that it stops appearing to users without being deleted.
- US7.3 — As an admin, I want to re-enable a disabled model so that it reappears in the user picker.
- US7.4 — As an admin, I want to edit a model's display name or provider-side name so that I can correct mistakes.
- US7.5 — As an admin, I want to delete a model permanently when it is no longer offered.

**Requirements:**
- FR-024 — The system shall let an admin create a model with a display name and a provider-side identifier; only enabled models are offered to users.
- FR-025 — Each model shall carry two independent names: a display name (human-facing) shown to end users, and an actual name (provider-side identifier) sent verbatim to the provider; the two are not interchangeable.
- FR-026 — The display name shall be unique across all models.
- FR-027 — The system shall let an admin change a model's display name, provider-side identifier, or enabled state independently.
- FR-028 — The system shall let an admin disable and re-enable a model at any time.
- FR-029 — The system shall let an admin delete a model, subject to the constraint in BR-008.
- FR-030 — The provider-side identifier shall never appear in any end-user surface (FR-007 fulfillment).

### Feature F8 — Admin Sets the Default Model (P1)

**Description:** Admins designate exactly one enabled model as the
system-wide default. New users without an explicit choice use this
model.

**User Stories:**
- US8.1 — As an admin, I want to set a model as the system default so that new users have something to talk to without configuration.
- US8.2 — As an admin, I want to replace the current default with another so that I can change the recommendation as models change.
- US8.3 — As an admin, I want the default to be removed if the chosen model becomes disabled so that the system never silently routes to a disabled model.

**Requirements:**
- FR-031 — The system shall let an admin designate exactly one enabled model as the system default at any time.
- FR-032 — The system shall reject any attempt to designate a disabled model as default, leaving the prior default unchanged.
- FR-033 — Setting a new default shall atomically replace the prior default.
- FR-034 — Disabling the current default shall remove the default entirely until a new one is designated.

---

## 3. Business Rules

Rules are normative and cannot be relaxed without an amendment.

| ID | Rule |
|---|---|
| BR-001 | Email addresses must be syntactically valid (RFC 5322 shape), unique across all accounts, and stored in a case-insensitive canonical form. |
| BR-002 | Passwords must be at least 12 characters and at most 128 characters. Passwords are stored only after being passed through a modern salted one-way function; plaintext is never persisted. |
| BR-003 | The actual AI model identifier (the string sent to the provider) is confidential end-user information and MUST NOT appear in any end-user-facing UI, network response, or log line that an end user could see. |
| BR-004 | The display name of a model is the only name end users see. |
| BR-005 | Display names must be 1–80 characters and unique across all models. |
| BR-006 | The actual model identifier must be 1–200 characters and may repeat across rows (two display aliases can map to the same identifier if intentionally desired). |
| BR-007 | The system supports exactly one central AI provider; there is no UI to add, remove, or switch providers at runtime. |
| BR-008 | A model referenced by the system's default-model setting or by any existing conversation cannot be deleted until the reference is removed. |
| BR-009 | At most one model may be designated as the system default at any moment. |
| BR-010 | The system default must reference an enabled model; referencing a disabled or deleted model is invalid. |
| BR-011 | The provider credential is stored encrypted at rest. The cleartext credential appears nowhere except inside the server at the moment of an outbound call to the provider. The admin sees only a masked form. |
| BR-012 | Authentication has two roles: "user" and "admin". Admin actions require an admin session; the absence of a session is distinct from a wrong-role session (BR-013). |
| BR-013 | An authenticated regular user attempting an admin action is rejected with a "forbidden" outcome; an unauthenticated request is rejected with an "unauthenticated" outcome. The two are visible distinctions in the product surface. |
| BR-014 | When the system has no central provider configured, or no default model designated, the user side shows a clear "chat is not yet configured" / "no models available" state — never a generic failure. |
| BR-015 | User-supplied input is validated at the system boundary; unsolicited fields in a request are rejected, not silently dropped. |
| BR-016 | Conversations are owned by exactly one user; no other user (including admins) can read or delete them. |
| BR-017 | All client-visible error messages are sanitized; they identify the problem in user-friendly terms and reference a stable, machine-readable code so the frontend can branch on it. |

---

## 4. User Flows

### Flow 4.1 — First-Time User: Register, See Default, First Chat

1. Visitor opens the application for the first time.
2. Visitor chooses to register and provides email + password.
3. System creates the account, signs the visitor in, and routes them
   into the chat experience.
4. If the admin has configured a default model, that model is
   preselected and visibly marked as the default in the picker.
5. User types their first message and submits.
6. Response tokens appear progressively in the chat window.
7. On completion, the user's message and the assistant's reply are
   persisted as the first turn of a new conversation.
8. The conversation appears in the user's conversation history.

Failure and alternative paths:
- If registration fails (email taken, weak password), the user is
  returned to the registration form with the error code from §3 / §7
  visible and the relevant field highlighted.
- If no models are available, sending a message is impossible — the
  UI must surface this as an empty picker state per FR-010, not as a
  generic error.
- If the central provider is not configured, the chat input is
  disabled with an explanatory message ("chat is not yet configured by
  the administrator").

### Flow 4.2 — Returning User: Open History, Continue Conversation

1. Returning user opens the application.
2. The system shows the user's most recent conversations in a list.
3. User picks one and views its full transcript in `createdAt` order.
4. User types a follow-up message and submits.
5. The full prior transcript is sent to the provider as context
   alongside the new message.
6. Streaming response appears inline below the new message.
7. The new user/assistant turn is appended to the transcript and
   persisted.

Failure paths:
- If the conversation was attached to a model that has since been
  deleted or disabled, sending a new message returns a "model no longer
  available" state, and the UI prompts the user to start a new chat.

### Flow 4.3 — Admin: First-Time Provider & Model Setup

1. Admin signs in with their admin credentials.
2. Provider not yet configured → admin lands on the provider
   configuration screen.
3. Admin enters the base URL and the credential.
4. System validates the credential against the provider with a minimal
   non-streaming call.
5. On validation success, the configuration is saved and the
   credential is stored encrypted.
6. Admin now adds at least one model with a display name and a
   provider-side name.
7. Admin enables the model and optionally designates it as the
   default.
8. From this point, the model is visible to all users.

Failure paths:
- On credential validation failure, nothing is saved and the admin
  sees a "credentials rejected by the provider" message.
- On attempting to designate a disabled model as default, the
  request is rejected with a "only enabled models can be the default"
  message.

### Flow 4.4 — Admin: Disable a Model Mid-Operation

1. Admin disables a currently enabled model.
2. The model disappears from the user-facing picker immediately for
   subsequent loads.
3. Any user with an in-flight response receives the rest of that
   response; their NEXT message cannot be sent against the disabled
   model and they are prompted to pick a different one.
4. If the disabled model was the default, the system has no default
   until a new one is chosen. Users without an explicit choice see an
   empty picker with an explanatory message.

### Flow 4.5 — Logout and Session Expiry

1. User clicks "log out" or the browser is left idle past the
   session-lifetime threshold.
2. The session is invalidated.
3. Subsequent attempts to perform any action requiring authentication
   redirect the user to the login screen with the return address
   preserved.

---

## 5. UI/UX Requirements

### 5.1 Screen Inventory

#### User side

| Screen | Purpose | Access |
|---|---|---|
| Registration | Collect email + password and create a user account. | Anonymous |
| Login | Authenticate an existing user and obtain a session. | Anonymous |
| Chat | Default landing for authenticated users; pick a model and send messages with streaming responses. | User |
| Model picker (component) | List available models and let the user pick one or accept the default. | User |
| Conversation list | Browse past conversations, ordered by most recent activity. | User |
| Conversation detail | Read the full ordered transcript of a conversation. | User |

#### Admin side

| Screen | Purpose | Access |
|---|---|---|
| Admin login | Authenticate an admin. | Anonymous (same form as user login; only admin credentials succeed). |
| Provider configuration | View and edit the central provider's base URL and credential. | Admin |
| Model catalog (list + edit) | Add, edit, enable/disable, and delete models. | Admin |
| Default-model selector | Set or clear the system default model. | Admin |

#### Cross-cutting

| Surface | Purpose | Access |
|---|---|---|
| Empty state (models) | "No models available" with explanation. | User |
| Empty state (conversation list) | "You have no conversations yet" with a prompt to start one. | User |
| Error surface | Display sanitized error message + stable code. | All |
| Loading state | Show a clear non-blocking indicator. | All |
| Sign-out trigger | Available on every authenticated screen. | User, Admin |

### 5.2 Screen Specifications

#### Screen: Registration

**Purpose:** Convert a visitor into an authenticated user.

**Content:**
- Email input.
- Password input.
- Submit button.
- Link to "Already have an account? Log in".
- (Optional but recommended) Inline hint for password rules (12+
  characters).

**Actions:**
- Submit → validates locally for shape, sends the create-account
  request, on success authenticates the user and routes to the chat.
- Navigate to Login.

**States:**
- *Idle*: ready to accept input.
- *Submitting*: disable the submit button and show a non-blocking
  progress indicator on the button.
- *Email-taken*: surface the error at the email field, do NOT clear
  the password.
- *Validation-failed*: surface field-level errors (BR-001, BR-002) at
  the relevant fields.
- *Unknown-error*: surface a generic "couldn't create your account"
  message; never reveal whether the email exists.

**Validation feedback rules:**
- The email field validates format on blur, not on every keystroke.
- The password field shows a strength hint but does not impose a real-
  time complexity meter (BR-002 is a constraint, not a UI feature).

**Navigation:**
- Successful submit → Chat screen.
- Tap "Log in" → Login screen.

**Responsive behavior:**
- Single-column on mobile, max-width centered on desktop.

---

#### Screen: Login

**Purpose:** Authenticate an existing user.

**Content:**
- Email input.
- Password input.
- Submit button.
- Link to "No account yet? Register".

**Actions:** Submit; navigate to Registration.

**States:**
- Idle / Submitting / Generic-failure / Unknown-error.
- The generic-failure state is intentionally identical for "wrong
  password", "unknown email", "disabled account" (BR-005).

**Navigation:** Successful submit → Chat screen.

**Responsive behavior:** Single column on all viewport sizes.

---

#### Screen: Chat

**Purpose:** Primary user surface — pick a model, send messages, read
the streaming reply.

**Content:**
- Conversation transcript area (top to bottom, oldest at the top).
- Model picker control (header or sidebar).
- Message input area (multi-line text, char counter, send button).
- Sign-out trigger.

**Actions:**
- Type and submit a message.
- Pick a different model from the picker.
- Start a new conversation (explicit "New chat" action).
- View conversation history.
- Delete a conversation from the detail view.
- Sign out.

**States:**
- *Empty chat, default present*: the transcript area is empty and the
  picker shows the default preselected; the input is enabled.
- *Empty chat, no models available*: the picker shows the empty-state
  message (BR-014); the input is disabled with an explanation.
- *Mid-stream*: the input is disabled (or accepts only cancellation,
  per OQ-002); the new response accumulates inline.
- *Streaming finished*: the input becomes enabled again; the new
  assistant turn is the last item in the transcript.
- *Provider not configured*: show BR-014 message; input disabled.
- *Authentication-expired*: redirect to Login with the current
  address as the post-login destination.

**Navigation:**
- Conversation list (tap any past conversation → Conversation detail,
  which functions as a chat surface for that conversation).
- Sign-out → Login.

**Streaming-display requirements:**
- Tokens appear in the chat transcript as they arrive; no full-
  response "jump".
- A visible boundary marks when the response started and when it
  ended (e.g., a "● Generating…" indicator while in progress and a
  timestamp / stop cursor when complete).
- If the response was cut short by an error, the partial text is
  retained and an inline error tag is shown above the cut.

**Responsive behavior:**
- Desktop: transcript area fills the central column; picker + sign-out
  in a sidebar or header.
- Mobile: stacked layout — picker collapses into a header chip; sign-out
  in a menu.

---

#### Screen: Conversation List

**Purpose:** Browse past conversations to reopen or delete them.

**Content:** Ordered list of conversations. Each row shows title,
model used, last-activity timestamp.

**Actions:**
- Open a conversation → Conversation detail.
- Delete a conversation (with confirmation per OQ-001).

**States:**
- *Empty*: "You have no conversations yet. Start one from the chat
  screen."
- *Loading*: skeleton rows or a non-blocking spinner.
- *Pagination*: see §7.

**Navigation:** Back to Chat (or the app's primary navigation root).

**Responsive behavior:** Card list on mobile, dense table on desktop.

---

#### Screen: Conversation Detail

**Purpose:** Read the full ordered transcript of a conversation.

**Content:**
- Header (model used, created/updated timestamps).
- Ordered list of messages (user and assistant entries, each with
  author and timestamp).
- "Continue chat" affordance for sending a follow-up (lands the user
  in a chat-with-this-conversation mode).
- Delete conversation action.

**Actions:**
- Continue chat → enters Chat in the context of this conversation.
- Delete conversation (confirmation → removes from list and returns to
  list).

**States:**
- *Empty (a brand-new conversation has just been created but has no
  messages)*: the chat area in "Continue chat" mode shows an empty
  transcript with the input enabled.
- *Model-deleted (the conversation's model is no longer available)*:
  the header shows a "model no longer available" tag; the chat input
  for this conversation is disabled with an explanatory message; the
  transcript remains readable.
- *Loading / Error*: same as other lists.

**Navigation:** Back to Conversation List.

---

#### Screen: Admin Login

**Purpose:** Authenticate an admin.

**Content, Actions, States:** Same as Login (BR-012).

**Navigation:** Successful submit → Provider configuration (if not yet
configured) or Model catalog.

---

#### Screen: Provider Configuration

**Purpose:** View and edit the central AI provider's base URL and
credential.

**Content:**
- Base URL input (with format hint).
- Credential input (treated as a password field; not pre-filled on
  subsequent visits; show a masked preview of the previously saved
  credential when one exists).
- Save button.
- Read-only "last validated at" timestamp.
- Read-only status (configured / not configured).

**Actions:**
- Save → triggers validation; on success, returns the saved masked
  view; on failure, surfaces the error.
- Discard changes.

**States:**
- *Not-configured*: show an empty form with a "first-time setup"
  callout.
- *Configured*: show the current base URL and a masked credential
  preview; offer an "Update credential" affordance.
- *Saving*: disabled form, non-blocking progress.
- *Validation-failed*: show the error message at the credential field;
  do NOT save anything.
- *Saved-successfully*: show the masked credential preview and the
  updated "last validated at" timestamp.

**Navigation:** Side panel with links to Model catalog and Default-
model selector.

**Responsive behavior:** Single-column on all sizes.

---

#### Screen: Model Catalog (admin)

**Purpose:** Add, edit, enable/disable, and delete models.

**Content:**
- Table of models with columns: Display name, Provider-side name,
  Enabled, Is default.
- "Add model" action.
- Per-row: Edit, Toggle enabled, Delete actions.

**Actions:**
- Add → opens an empty form.
- Edit → opens a populated form.
- Toggle enabled → flips the row's enabled state in place; if it
  WAS the default, the default is cleared automatically.
- Delete → opens a confirmation. If the model is referenced anywhere
  (BR-008), the deletion is refused and the user sees an explanatory
  message.

**States:**
- *Empty*: "No models yet. Add one to make the product usable by
  users."
- *Loading / Error*.

**Add/Edit form fields:**
- Display name (1–80 chars, unique, BR-005).
- Provider-side identifier (1–200 chars, BR-006).
- Enabled (default true).

**Navigation:** Side panel with links to Provider configuration and
Default-model selector.

---

#### Screen: Default-Model Selector

**Purpose:** Set or clear the system default model.

**Content:**
- List of enabled models (only enabled are eligible).
- Per-model radio/select.
- "Clear default" action.
- Save button.

**Actions:**
- Pick a model → set as default; the prior default (if any) is cleared
  atomically.
- Clear default → no model is the default until a new one is chosen.
- Save → persist; on success, the UI reflects the new default.

**States:**
- *No default set*: form is unchecked / shows "No default".
- *Validation-failed*: if a disabled model was somehow submitted, the
  rejection per FR-032 is shown.

**Navigation:** Side panel with links to Model catalog and Provider
configuration.

---

### 5.3 Cross-Cutting UI Behavior

- **Loading state**: every async surface shows a non-blocking progress
  indicator. Avoid full-screen blockers except where unavoidable (chat
  mid-stream).
- **Error state**: every actionable surface must be able to surface an
  error. Errors are displayed as `[icon] [human message]` with a
  stable code visible to support. Errors are sanitized (BR-017).
- **Empty state**: every list-shaped surface has an explicit empty
  state, not a blank.
- **Confirmation**: destructive actions (delete conversation, delete
  model, clear default-model) require explicit confirmation.
- **Optimistic UI**: none. The product's value comes from correctness,
  not from optimistic writes. Write actions wait for server
  confirmation before reflecting in the UI.

---

## 6. Domain & Data

The following entities are conceptual. The frontend needs to model
them in its state, but the exact storage form is the backend's
concern.

### 6.1 User Account

**Purpose:** An identity that can chat and own conversations.

**Fields (frontend-visible):**
- `id`: stable identifier (opaque string).
- `email`: the user's email address.
- `role`: `"user"` or `"admin"`.
- `createdAt`: when the account was created.
- `lastLoginAt`: most recent successful login (or null).

**Lifecycle:**
- Created via registration.
- Status: implicitly active. (Account disable by admin is out of scope
  in MVP but the entity must permit adding a `disabled` status without
  breaking the frontend — see OQ-005.)

**Rules:**
- Email is the unique identifier.
- Only the user themselves and the system ever see the account's
  details; admins do not view or edit regular-user accounts in MVP.

### 6.2 Conversation

**Purpose:** A user's chat session with one model.

**Fields (frontend-visible):**
- `id`: stable identifier (opaque string).
- `modelId`: which model the conversation is attached to.
- `title`: short label shown in the history list (defaulted from the
  first message; user may rename later — out of MVP scope).
- `createdAt`, `updatedAt`: timestamps used for ordering.

**Relationships:**
- Belongs to exactly one user.
- References exactly one model.
- Has many messages.

**Rules:**
- The modelId is set at conversation creation and does not change for
  the lifetime of the conversation (BR-016 / OQ-006).
- Deleting a conversation removes all its messages.

### 6.3 Message

**Purpose:** A single turn in a conversation, produced either by the
user or by the AI.

**Fields (frontend-visible):**
- `id`: stable identifier (opaque string).
- `conversationId`: parent conversation.
- `role`: `"user"` or `"assistant"`.
- `content`: the full text of the message.
- `createdAt`: timestamp.

**Rules:**
- Immutable once persisted.
- The role value is exactly one of the two strings — no other values
  exist.

### 6.4 Provider (singleton)

**Purpose:** The single AI provider used by the MVP.

**Fields (frontend-visible to admins only):**
- `baseUrl`: the provider's endpoint URL.
- `credentialMasked`: last few characters of the credential, with a
  visible marker prefix.
- `lastValidatedAt`: when the credential was last successfully probed.
- `isConfigured`: whether a provider row exists.

**Rules:**
- Exactly one provider exists; the system provides no UI to create or
  remove providers (BR-007).
- The cleartext credential is never returned in any admin response
  (BR-011).

### 6.5 Model

**Purpose:** An AI model the admin offers to users.

**Fields (frontend-visible to admins):**
- `id`: stable identifier.
- `displayName`: human-facing name (1–80 chars, unique).
- `actualName`: provider-side identifier (1–200 chars).
- `enabled`: whether users can see and pick the model.
- `isDefault`: whether the model is the system default (true for at
  most one row at any moment).

**Fields (frontend-visible to regular users — **only these**):**
- `id`, `displayName`, `isDefault`.

**Rules:**
- BR-003, BR-004: end users see only `displayName` and `isDefault`.
- BR-009: at most one `isDefault: true` at any moment.
- BR-008: cannot delete while referenced by default or by a
  conversation.

### 6.6 System Configuration (singleton)

**Purpose:** A single read/write record holding the current default-
model reference (and, in the future, other system-wide settings).

**Fields (frontend-visible to admins):**
- `defaultModelId`: the id of the currently-designated default model,
  or null when no default is set.

**Rules:**
- BR-009, BR-010: at most one default; if set, the referenced model
  must exist and be enabled.

### 6.7 Entity relationship summary

```
User Account  (1) ──< (N) Conversation
Conversation  (1) ──< (N) Message
Model        (1) ──< (N) Conversation
Model        (1) >── (0..1) System Configuration.defaultModelId
Provider      (1 row total — singleton, no FK)
System Config (1 row total — singleton, no FK)
```

---

## 7. System Behavior

The frontend depends on the following observable behaviors. None of
this prescribes HOW the backend implements them — only what the
frontend can rely on.

### 7.1 Authentication and Sessions

- **Inputs:** email + password (login and registration).
- **Outputs:** on success, a session is established that survives
  page reload; on failure, a stable error code and a sanitized
  message.
- **Session validity:** finite lifetime; sessions expire
  independently of the user's actions. The frontend must handle a
  session-expiry outcome at any time and route the user to login.
- **Two roles:** user and admin. The same login form accepts both;
  the role emerges from the account's record. Logging in as a user
  produces a user session; logging in as an admin produces an admin
  session.
- **Sessions can be ended by the user at any time** via a sign-out
  action; subsequent requests fail until a new session is established.
- **Sessions are extension points:** the user side and the admin side
  never share surfaces — requesting an admin resource as a regular
  user fails as `forbidden`, distinct from `unauthenticated`.

### 7.2 Streaming Chat Responses

- **Inputs:** a user message, an optional conversation id (continue
  existing or start new), and an optional explicit model id (else the
  system picks per BR-014).
- **Outputs:** a streaming response that delivers partial text to the
  client as it is generated by the model.
- **Streaming lifecycle:**
  - The output begins within ~1 second of the user submitting
    (latency target, not promise).
  - Partial text is delivered to the client as it is generated, in
    the order in which the model produces it.
  - The stream has explicit start and end markers the frontend can
    detect.
  - On success, the assistant's full response is persisted.
  - On error or malformed data from the upstream, the stream
    terminates with a sanitized error, and any partial text already
    shown stays visible.
  - The user closing the browser mid-stream causes the backend to
    cleanly terminate its outbound call (no orphaned requests, no
    client-visible "ghost" state).
- **Cancellation:** see OQ-002. Default assumption: cancellation is
  supported by the user navigating away; a manual cancel button is
  out of MVP scope but the data model should permit it.

### 7.3 Model Picker Resolution

For any user action that needs to know "which model is this?", the
resolution order is:

1. Explicit model id from the user (highest priority).
2. The user's last explicit choice for this session, if any.
3. The admin's default model, if set and currently enabled.
4. None — the user is shown an empty model state (BR-014).

### 7.4 List Pagination

- All lists (conversations, admin model catalog) are paginated.
- Pagination is by **offset and limit** (count + position), with a
  default page size and a maximum page size enforced by the system.
- The system returns a result envelope with the page items and a
  total count when feasible.

### 7.5 Validation and Error Surfacing

- All write requests are validated at the boundary. Fields the system
  does not recognize are rejected, not silently dropped (BR-015).
- Field-level validation errors arrive with a stable error code and
  per-field message; the frontend can highlight the offending field.
- All errors include:
  - A stable, machine-readable `code`.
  - A sanitized, human-readable `message`.
  - A `requestId` the frontend can show for support.
- The frontend MUST NOT show technical detail (stack traces, internal
  identifiers) to the user; if it appears, it is a backend bug.

### 7.6 Configuration Invalidation

- Admin configuration changes (provider, models, default) take effect
  for users on the next data refresh, not retroactively. The current
  open chat of a user is not interrupted mid-stream.
- When a model becomes unavailable to a user, the next user-initiated
  action is the one that surfaces the new state — earlier in-flight
  responses continue to completion.

### 7.7 Caching

- No surface is cached by intermediaries. The frontend should assume
  every request is live.

### 7.8 Time and Dates

- All timestamps are ISO 8601 UTC with a `Z` suffix. The frontend
  renders them in the user's local timezone for display but must not
  rely on timezone in any business logic.

### 7.9 Identifiers

- All entity identifiers are opaque strings. The frontend MUST NOT
  parse them. They are stable for the entity's lifetime.

### 7.10 Cross-Origin and Headers

- The frontend sends a correlation id with each request; if absent,
  the backend generates one and returns it in the response. The
  frontend SHOULD pass a correlation id for support diagnostics.

---

## 8. Acceptance Criteria

Criteria are grouped by feature. Each is observable: given a context
and an action, an outcome follows. No criterion prescribes
implementation.

### F1 — Account Registration and Login

- **AC-001** — Given a visitor with an unused email and a 12+
  character password, when they submit registration, then they are
  signed in and routed to the chat screen.
- **AC-002** — Given an email that is already registered, when a
  visitor submits registration, then the request is rejected with a
  field-level error on the email field and no account is created.
- **AC-003** — Given a registered user, when they submit login with
  correct credentials, then they receive an authenticated session.
- **AC-004** — Given any login failure (wrong password, unknown
  email, disabled account), when the user submits, then the same
  generic error is shown (no enumeration).
- **AC-005** — Given an authenticated user, when they trigger sign-
  out, then subsequent requests from that session are rejected.

### F2 — Browse and Select a Model

- **AC-006** — Given an authenticated user and at least one enabled
  model configured, when the chat screen loads, then the picker
  shows every enabled model and the default (if any) is preselected
  and visually marked.
- **AC-007** — Given no enabled models, when the chat screen loads,
  then the picker shows the empty-state message and the message
  input is disabled.
- **AC-008** — Given a user who has selected a model explicitly and
  later opens the app again, when the picker loads, then their last
  explicit choice is preselected (until they change it).

### F3 — Streaming Chat

- **AC-009** — Given an authenticated user with a model selected,
  when they submit a message, then the response text begins appearing
  in the transcript within ~1 second of provider emission.
- **AC-010** — Given an active conversation with prior turns, when the
  user submits a follow-up message, then the prior turns are sent to
  the provider as context (verifiable by the model referencing earlier
  content).
- **AC-011** — Given a streaming response in progress, when the user
  closes the browser, then no backend resource remains tied up (the
  user can re-open the app and immediately send another message).
- **AC-012** — Given a completed streaming response, when the user
  opens conversation history, then the user message and the full
  assistant response are both present in the transcript.
- **AC-013** — Given an admin who disables the model a user is
  currently chatting with, when the user's next message is sent,
  then the system surfaces the "model no longer available" state
  and prompts the user to pick a different model.

### F4 — Conversation History

- **AC-014** — Given a user with completed conversations, when they
  open the history view, then they see all their conversations
  ordered by most recent activity first.
- **AC-015** — Given a conversation in the history list, when the user
  opens it, then the full ordered transcript is displayed.
- **AC-016** — Given a conversation, when the user deletes it, then
  it disappears from the list and is unrecoverable.

### F5 — Admin Role Separation

- **AC-017** — Given a regular user's session, when they request any
  admin surface, then the request is rejected with a forbidden
  outcome (distinct from unauthenticated).
- **AC-018** — Given no session, when the user requests an admin
  surface, then the request is rejected with an unauthenticated
  outcome and the user is redirected to login.

### F6 — Admin Configures the Central Provider

- **AC-019** — Given an admin and a working credential, when they
  save provider configuration, then the system validates the
  credential and saves; subsequent reads show a masked credential.
- **AC-020** — Given an admin and an invalid credential, when they
  save, then nothing is saved and they see a "credentials rejected"
  message.
- **AC-021** — Given a saved provider, when the admin opens the read
  view, then the credential appears only in masked form (last few
  characters with a marker prefix), never in cleartext.

### F7 — Admin Manages Available Models

- **AC-022** — Given an admin, when they add a model with a unique
  display name and a provider-side identifier, then the model
  appears as enabled and is offered to users.
- **AC-023** — Given an enabled model, when the admin disables it,
  then it disappears from the user-facing picker on the next
  refresh and remains in the admin view.
- **AC-024** — Given a model referenced by the system's default or by
  any conversation, when the admin attempts to delete it, then the
  deletion is refused with an explanatory message.
- **AC-025** — Given any list of models on the user side, when it
  renders, then only the display name appears — the provider-side
  identifier is never visible to end users.

### F8 — Admin Sets the Default Model

- **AC-026** — Given at least one enabled model, when the admin sets
  a default, then subsequent loads show that model preselected for
  users who have not chosen.
- **AC-027** — Given an existing default, when the admin chooses a
  different enabled model as default, then the prior default is
  cleared and the new one becomes the only default.
- **AC-028** — Given a current default model, when the admin
  disables it, then the system has no default until one is chosen.
- **AC-029** — Given an attempt to set a disabled model as default,
  when the admin submits, then the request is rejected with a clear
  message and the prior default (if any) is unchanged.

---

## 9. Open Questions

Items that materially affect the product behavior or the frontend
implementation but are not currently decided. Defaults given here are
**assumed**, not confirmed.

- **OQ-001** — **Delete confirmation UX.** Do we use a modal, an
  inline confirm row, or an undo toast? *Default: modal for
  conversations and models, undo-toast for clearing the default
  model.*
- **OQ-002** — **Cancel mid-stream.** Is there an explicit "Stop
  generating" button, or is closing the tab the only way to cancel?
  *Default: no explicit button in MVP; closing the tab cancels.*
- **OQ-003** — **Rename conversation.** Can users rename
  conversation titles, or are they always derived from the first
  message? *Default: titles are derived only in MVP; no rename UI.*
- **OQ-004** — **First-user empty-state discoverability.** When a
  first-time user lands in chat and the admin hasn't configured the
  product yet, what do we show beyond "no models available"? *Default:
  a single explanatory line and no upsell flow.*
- **OQ-005** — **Account disable behavior.** Self-disabled accounts
  aren't a feature, but admin-driven disable is in the entity model
  for future use. In MVP, is there ANY way an account becomes
  inaccessible? *Default: no — all registered accounts are always
  usable.*
- **OQ-006** — **Switching model mid-conversation.** If a user
  explicitly chose model A and starts a chat, can they switch to
  model B for their next message within the same conversation?
  *Default: no — the model is fixed for a conversation; switching
  starts a new conversation.*
- **OQ-007** — **Pagination on conversation list.** What is the
  default page size and maximum page size? *Default: 20 per page, max
  100.*
- **OQ-008** — **Token / cost display.** Do we surface any model-
  side metadata (tokens used, latency, etc.) to end users? *Default:
  no — out of MVP scope.*
- **OQ-009** — **Internationalization.** MVP is English-only per A5.
  If/when i18n is added, this surface expands accordingly. *Not
  blocking for MVP.*
- **OQ-010** — **Accessibility level.** What conformance target do
  we aim at (WCAG 2.1 AA, AAA, none)? *Default: keyboard navigation
  works for all primary actions; visual accessibility is best-effort
  in MVP.*

---

## Frontend Readiness Checklist

Self-applied before finalizing:

- [x] What screens must exist? — §5.1 inventory, user and admin sides
- [x] Who can access each screen? — §5.1 access column
- [x] What can users do? — §2 user stories and §4 flows
- [x] What data is displayed? — §6 entity field lists (with end-user
  filters per BR-003)
- [x] What actions are available? — §5.2 actions per screen
- [x] What are the business rules? — §3 rules list
- [x] What happens during loading? — §5.3 cross-cutting loading
- [x] What happens when something fails? — §5.2 states per screen,
  §7.5 error surfacing
- [x] What happens in empty states? — §5.2 per screen, BR-014
- [x] What happens when data changes? — §7.6 invalidation rules
- [x] How does the frontend know an operation succeeded? — §2
  requirements; success criteria per feature; stable error codes
  (BR-017)
- [x] What remains undecided? — §9 open questions

---

**Version**: 1.0.0 (MVP) | **Created**: 2026-09-13

Companion artifacts (reference only, not authoritative for product
behavior): `spec.md`, `api-contract.md`, `contracts/openapi-3.1.yaml`.
