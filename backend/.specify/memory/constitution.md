<!--
Sync Impact Report
==================
Version change: N/A (initial ratification) → 1.0.0
Modified principles: none (initial scaffold)
Added sections:
  - Core Principles (5 principles)
  - Technology Stack & Conventions
  - Development Workflow
  - Security & Compliance
  - Governance
Removed sections: none
Deferred TODOs:
  - None at this time. All placeholders were resolved from user input.
-->

# Chat Backend Constitution

## Core Principles

### I. Monorepo Backend Isolation
All source files, configuration, scripts, and documentation produced for this backend
MUST live under the `backend/` folder of the repository. No edits to sibling top-level
folders (frontend, infra, docs root, etc.) are permitted from backend-agent runs.
If the working directory is already `backend/`, treat that path as the project root for
all file operations. Cross-cutting changes that legitimately affect other monorepo
packages MUST be deferred to the human operator and proposed as a follow-up task.

### II. Agent Workflow Constraints
Automated agents (Claude, subagents, scripts) MUST NOT execute any git operations on
the user's behalf — no `git add`, `git commit`, `git push`, `git checkout`,
`git reset`, branch creation, tagging, or remote interaction. For every change that
would normally warrant a commit, the agent MUST append a `Suggested commit message:`
block at the end of its response, derived from the diff being introduced, so the
human operator can review and commit manually. Agents MUST treat the local working
tree as read-with-intent-to-modify, never as state to be persisted to history.

### III. API-First Design
Every feature that exposes functionality over the network MUST be designed
contract-first. The default contract style is REST with JSON request and response
bodies, documented in the feature's `spec.md`. Alternative styles (GraphQL, gRPC,
WebSocket, server-sent events) MAY be adopted for a specific feature when the
specification explicitly justifies the deviation; the rationale MUST be recorded in
the spec's "Design Decisions" section. Contracts MUST be versioned; breaking changes
MUST increment the contract version and follow the Versioning & Breaking Changes
guidance below.

### IV. Test-Alongside Quality
Tests MUST be authored in the same change set as the implementation they cover and
MUST pass before the change is considered mergeable. The Red-Green-Refactor cycle is
recommended but not strictly mandatory — pragmatic test-after for trivial fixes is
acceptable when explicitly noted in the commit message. The following MUST always
have tests:
- Public API endpoints (contract tests)
- Business logic in domain services
- Cross-service integration boundaries
- Authentication and authorization code paths
Coverage targets are advisory; absence of a test on a non-listed path is not a
violation but MUST be justifiable.

### V. Language & Stack Agnosticism
The constitution MUST NOT mandate a specific programming language, web framework,
database engine, or runtime. Each feature spec MAY select a stack appropriate to the
problem, and that selection MUST be recorded in the spec's "Technical Choices"
section with a short rationale. Once a stack is chosen for a feature, subsequent
amendments to that feature MUST preserve stack consistency unless a migration is
explicitly documented. Cross-feature shared libraries (when introduced) MUST
declare their target language(s) in their package metadata.

## Technology Stack & Conventions

The project is intentionally stack-agnostic at the constitutional level. The following
binding rules apply regardless of the chosen stack:

- Source code, tests, and configuration MUST live under `backend/`. No exceptions.
- All persistent configuration (environment-specific values, secrets references) MUST
  be loaded from environment variables or a `.env` file listed in `.gitignore`. No
  secrets MUST be committed to the repository.
- API contracts MUST be machine-readable and versioned (OpenAPI for REST, schema
  files for GraphQL/gRPC, `.proto` for gRPC).
- Database access MUST go through a dedicated data-access layer; raw SQL embedded in
  HTTP handlers or business logic is a violation.
- Logs MUST be structured (JSON or key=value) and MUST include at minimum: timestamp,
  log level, request/correlation ID, and message.
- Errors exposed to clients MUST be sanitized. Stack traces and internal details
  MUST NOT leak to API responses; they belong in server logs only.

## Development Workflow

Every feature MUST move through the Spec Kit pipeline in order:
1. `/speckit-specify` — produce `spec.md` describing user-facing behavior.
2. `/speckit-clarify` — resolve underspecified areas in the spec.
3. `/speckit-plan` — produce `plan.md` with technical decisions and architecture.
4. `/speckit-tasks` — produce dependency-ordered `tasks.md`.
5. `/speckit-implement` — execute tasks in order.
6. `/speckit-analyze` — cross-artifact consistency check (post-implementation).

Skipping a stage is a violation unless explicitly approved and recorded in the
relevant artifact with rationale.

Quality gates that MUST pass before a feature is considered complete:
- All tasks in `tasks.md` marked complete.
- Test suite passes locally.
- Lint and type-check (when applicable) pass with zero errors.
- API contract updated and committed alongside the implementation.
- `Suggested commit message:` block appended to the implementing agent's output.

Review expectations:
- Specs and plans MUST be reviewed by the human operator before implementation begins.
- Implementations MUST be reviewed against their originating spec and plan.
- Drift between code and spec MUST trigger either a spec amendment or a follow-up
  task — silent drift is not acceptable.

## Security & Compliance

- All HTTP endpoints that handle authenticated state MUST declare their auth
  requirements in the spec; missing auth declarations are a violation.
- Secrets MUST be loaded from the runtime environment, never hard-coded.
- User-supplied input MUST be validated at the system boundary before reaching
  domain logic.
- Dependency updates MUST be reviewed for known vulnerabilities before merge.
- Personally identifiable information (PII) handling MUST be documented in the
  feature spec when applicable.

## Governance

This constitution supersedes all other practices for backend development in this
project. Any code, spec, plan, or workflow that conflicts with the principles above
is non-compliant and MUST be brought into alignment before merge.

Amendments:
- Amendments require a written rationale and the proposed diff.
- MAJOR changes (principle removal, principle redefinition, governance change)
  require explicit human approval and a migration plan for existing work.
- MINOR changes (new principle, new section, materially expanded guidance) require
  human approval.
- PATCH changes (clarifications, wording fixes, typo corrections) may be applied
  directly with a brief note in the Sync Impact Report.
- Each amendment MUST update the version, `Last Amended` date, and Sync Impact
  Report at the top of this file.

Versioning policy:
- MAJOR: backward-incompatible governance or principle changes.
- MINOR: new principle or section, or materially expanded guidance.
- PATCH: clarifications, wording, non-semantic refinements.

Compliance review:
- Every PR or change set MUST be checked against this constitution before merge.
- Non-compliance MUST be resolved or explicitly waived with documented rationale.
- Use `.specify/memory/constitution.md` as the single source of truth for governance
  at runtime; do not fork governance rules into feature-level docs.

**Version**: 1.0.0 | **Ratified**: 2026-09-13 | **Last Amended**: 2026-09-13
