# CLAUDE.md — Chat Backend (Multi-Model Chatbot MVP)

> **Authoritative governance source**: `.specify/memory/constitution.md` v1.0.0.
> This file distills the constitution into agent-facing rules. When this
> file and the constitution disagree, the constitution wins — open an
> issue and amend both.

---

## What this project is

A backend for a multi-model chatbot web app. End users register, log in,
pick a model, and chat with it (streaming). Admins configure a single
central OpenAI-compatible provider and curate the model catalog. This
repo contains the **backend portion only**; the frontend lives in a
sibling monorepo package.

Current MVP stack (recorded under "Technical Choices" in
`specs/001-multi-model-chatbot-mvp/plan.md`):

| Layer | Choice |
|---|---|
| Runtime | Node.js 20 LTS |
| Framework | NestJS 10 (TypeScript) |
| ORM | TypeORM 0.3 (mandatory) |
| DB | PostgreSQL via TypeORM 0.3 entities (connection from `POSTGRES_*` env vars) |
| Auth | JWT (HS256) access + refresh, DB-tracked refresh tokens |
| Logging | `nestjs-pino` → JSON files in `backend/logs/` via `pino-roll` |
| Validation | `class-validator` with strict whitelist |
| API contract | OpenAPI 3.1 at `specs/001-multi-model-chatbot-mvp/contracts/openapi-3.1.yaml` (source of truth) |

---

## Non-negotiable rules (must follow)

These are the constitution principles rewritten as "do this / don't do that"
for fast scanning. The full text and rationale live in the constitution.

### 1. Everything lives under `backend/`

- All source, tests, config, docs produced by backend agents MUST live under
  this folder.
- No edits to sibling monorepo folders (frontend, infra, root docs).
- Cross-cutting changes that legitimately affect other packages MUST be
  deferred to the human operator as a follow-up task.

### 2. Agents do not touch git

- **NEVER** run `git add`, `git commit`, `git push`, `git checkout`,
  `git reset`, branch creation, tagging, or any remote interaction.
- For every change that would normally warrant a commit, append a
  `Suggested commit message:` block at the end of the response, derived
  from the diff being introduced. The human operator commits manually.
- Read-only git (e.g., `git status` to confirm staged state) is fine.

### 3. API-first design

- Every networked feature is designed contract-first.
- Default contract style: REST + JSON, OpenAPI document.
- Non-REST styles (GraphQL, gRPC, SSE, WebSocket) are allowed only when
  the spec's "Design Decisions" section justifies the deviation.
- Contracts MUST be versioned (`/v1/...`). Breaking changes bump the
  contract version per the constitution's versioning policy.

### 4. Test-alongside quality

- Tests MUST be authored in the same change set as the implementation they
  cover and MUST pass before the change is mergeable.
- Tests are MANDATORY for: public API endpoints (contract tests),
  business logic in domain services, cross-service integration boundaries,
  auth/authz code paths.
- TDD is recommended but not strictly required; pragmatic test-after for
  trivial fixes is acceptable when noted in the commit message.
- No coverage gate, but missing tests on the listed paths is a violation.

### 5. Stack agnostic at the constitution level

- The constitution does not mandate a language/framework/DB.
- Stack choices are recorded in each feature's `plan.md` under
  "Technical Choices" with rationale.
- Once chosen for a feature, stack consistency MUST be preserved unless
  a migration is explicitly documented.

---

## Cross-cutting conventions

These apply to every change regardless of feature.

- **Configuration**: persistent config from environment variables or a
  `.env` file listed in `.gitignore`. **Never commit secrets.**
- **API contracts**: machine-readable and versioned (OpenAPI for REST).
  Regenerate via `npm run openapi:export` after controller changes.
- **Database access**: only via the dedicated data-access layer (TypeORM
  repositories). No raw SQL in HTTP handlers or domain logic.
- **Logging**: structured (JSON) with at minimum `timestamp`,
  `log level`, `request/correlation ID`, `message`. Use `nestjs-pino`.
- **Error envelopes**: sanitized for clients. No stack traces or
  internal details leak to API responses — they belong in server logs.
  See `specs/001-multi-model-chatbot-mvp/api-contract.md` §4.1.
- **Input validation**: at the system boundary via `class-validator`
  with `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`.

---

## Spec Kit pipeline (development workflow)

Every feature moves through the pipeline in order. Skipping a stage is a
violation unless explicitly approved and recorded in the artifact.

1. `/speckit-constitution` — governance baseline (done; v1.0.0).
2. `/speckit-specify` — write `spec.md` for the feature.
3. `/speckit-clarify` — resolve underspecified areas.
4. `/speckit-plan` — produce `plan.md`, `research.md`, `data-model.md`,
   `specs/.../contracts/openapi-3.1.yaml`, `quickstart.md`.
5. `/speckit-tasks` — produce dependency-ordered `tasks.md`.
6. `/speckit-implement` — execute tasks in order.
7. `/speckit-analyze` — cross-artifact consistency check.

Custom `/speckit-checklist` is also available for requirements-quality
review artifacts (see `specs/001-multi-model-chatbot-mvp/checklists/mvp.md`
for the current comprehensive example).

**Quality gates** that MUST pass before a feature is complete:
- All tasks in `tasks.md` marked complete (`[x]`).
- Test suite passes locally (`npm test`).
- Lint and type-check pass with zero errors (`npm run lint`, `tsc --noEmit`).
- API contract updated and committed alongside the implementation.
- `Suggested commit message:` block appended to the implementing agent's output.

**Drift handling**: silent drift between code and spec is not acceptable.
Either amend the spec or add a follow-up task.

---

## Agent do / don't list

### Do

- Read the relevant spec/plan/data-model/contract BEFORE writing code.
- Append a `Suggested commit message:` block to every response that
  introduces a change worth committing.
- Run `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`
  before declaring a task complete.
- Update the corresponding `tasks.md` (toggle `[ ]` → `[x]`) when a
  task is finished.
- Reference spec sections (`Spec §FR-001`, `plan.md §Architecture`) in
  comments and commit messages when behavior is non-obvious.
- Use `rg` (or `Grep`) instead of `grep`/`find` for content/file searches.

### Don't

- Don't run `git add`, `git commit`, `git push`, `git checkout`,
  `git reset`, or any remote git interaction. The human operator commits.
- Don't edit files outside `backend/`.
- Don't put secrets in source code, `.env.example`, or test fixtures.
  `.env.example` is committed; `.env` is gitignored.
- Don't skip the Spec Kit pipeline. If you think a stage is unnecessary,
  document why in the relevant artifact and continue.
- Don't write raw SQL in HTTP handlers — go through TypeORM repositories.
- Don't leak stack traces to API responses — sanitize in the global
  exception filter.
- Don't publish anything via the `Artifact` tool to public URLs without
  explicit operator approval; this is the backend MVP and there is no
  marketing surface.
- Don't run `npx skills add` or install third-party skills without
  reviewing content first; follow the skill-installation review process
  (fetch + review SKILL.md + companion files before installing).

---

## Quick reference

| What | Where |
|---|---|
| Constitution (authoritative) | `.specify/memory/constitution.md` |
| Active feature spec | `specs/001-multi-model-chatbot-mvp/spec.md` |
| Implementation plan | `specs/001-multi-model-chatbot-mvp/plan.md` |
| Data model | `specs/001-multi-model-chatbot-mvp/data-model.md` |
| OpenAPI contract (source of truth) | `specs/001-multi-model-chatbot-mvp/contracts/openapi-3.1.yaml` |
| Human-readable API contract | `specs/001-multi-model-chatbot-mvp/api-contract.md` |
| Tasks (decomposition) | `specs/001-multi-model-chatbot-mvp/tasks.md` |
| Quickstart validation | `specs/001-multi-model-chatbot-mvp/quickstart.md` |
| `.env.example` | `backend/.env.example` (real `.env` is gitignored) |
| NestJS manifest | `backend/package.json` |
| TypeScript config | `backend/tsconfig.json`, `backend/tsconfig.build.json` |
| Test runner | `backend/jest.config.ts` |
| Gitignore | `backend/.gitignore` |

---

**Version**: 1.0.0 | **Created**: 2026-09-13 | **Constitution**: v1.0.0 (2026-09-13)

Amendments to this file MUST update the constitution in the same change
set per the constitution's governance rules.
