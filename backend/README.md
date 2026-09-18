# Chat Backend — Multi-Model Chatbot MVP

NestJS 10 backend for a multi-model chatbot. Provides user auth (JWT), model browsing, streaming chat (SSE), conversation history, and admin configuration for the central OpenAI-compatible provider and model catalog.

## Prerequisites

- Node.js 20 LTS
- npm 10+
- OpenSSL (for generating secrets)
- PostgreSQL 14+

## Quick Start

```bash
# From the backend/ directory
npm install

# Generate secrets
export JWT_SECRET=$(openssl rand -hex 32)
export JWT_REFRESH_SECRET=$(openssl rand -hex 32)
export PROVIDER_ENCRYPTION_KEY=$(openssl rand -base64 32)

# Persist to .env (gitignored)
cat > .env <<EOF
PORT=3000
NODE_ENV=development
JWT_SECRET=$JWT_SECRET
JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=chatbot_db
LOG_LEVEL=info
LOG_DIR=./logs
PROVIDER_ENCRYPTION_KEY=$PROVIDER_ENCRYPTION_KEY
EOF

# Run migrations
npm run migration:run

# Start the server
npm run start:dev
```

The service listens on `http://localhost:3000`.

## NPM Scripts

| Script | Purpose |
|---|---|
| `npm run start:dev` | Start with auto-reload (development) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run start:prod` | Run compiled output |
| `npm test` | Run unit + integration tests (Jest) |
| `npm run test:e2e` | Run end-to-end tests |
| `npm run lint` | Lint with ESLint (auto-fix) |
| `npm run format` | Format with Prettier |
| `npm run migration:generate` | Generate a new TypeORM migration |
| `npm run migration:run` | Apply pending migrations |
| `npm run migration:revert` | Revert last migration |
| `npm run openapi:export` | Regenerate `specs/001-multi-model-chatbot-mvp/contracts/openapi-3.1.yaml` from live routes |
| `npm run seed:admin` | Seed an admin user (see below) |

## Seeding an Admin User

```bash
SEED_ADMIN_EMAIL=admin@example.com \
SEED_ADMIN_PASSWORD=your-strong-password \
npm run seed:admin
```

Log in at `POST /v1/auth/login` with these credentials to access admin endpoints.

## API Documentation

Swagger UI is served at `http://localhost:3000/api/docs` when the server is running.

The machine-readable OpenAPI contract is at [`specs/001-multi-model-chatbot-mvp/contracts/openapi-3.1.yaml`](../../specs/001-multi-model-chatbot-mvp/contracts/openapi-3.1.yaml) (the canonical source of truth) and is regenerated via `npm run openapi:export`.

## Running Tests

```bash
# All tests
npm test

# With coverage
npm run test:cov
```

## Project Structure

```
src/
  common/          # Filters, interceptors, guards, decorators, pipes, crypto
  config/          # Typed configuration (env validation)
  database/        # TypeORM DataSource + migrations
  modules/
    auth/          # JWT auth, login, register, refresh, logout
    users/         # User entity + user service
    chat/          # SSE streaming chat + OpenAI-compatible client
    conversations/ # Conversation history CRUD
    models/        # Model listing (public) + admin CRUD
    provider/      # Central provider config (admin)
    app-config/    # Default model config (admin)
    health/        # /healthz and /readyz
```

## Environment Variables

See `validateEnv()` in `src/config/env.validation.ts` for the full list. Key variables:

| Variable | Default | Description |
|---|---|---|
| `PORT` | 3000 | HTTP listen port |
| `NODE_ENV` | development | Runtime mode |
| `JWT_SECRET` | *(required)* | HS256 signing secret for access tokens |
| `JWT_REFRESH_SECRET` | *(required)* | HS256 signing secret for refresh tokens |
| `JWT_ACCESS_TTL` | 15m | Access token TTL |
| `JWT_REFRESH_TTL` | 7d | Refresh token TTL |
| `POSTGRES_URL` | *(empty)* | Full PostgreSQL connection URL (alternative to individual vars below) |
| `POSTGRES_HOST` | localhost | PostgreSQL host |
| `POSTGRES_PORT` | 5432 | PostgreSQL port |
| `POSTGRES_USER` | postgres | PostgreSQL user |
| `POSTGRES_PASSWORD` | *(empty)* | PostgreSQL password |
| `POSTGRES_DB` | chatbot_db | PostgreSQL database name |
| `LOG_LEVEL` | info | Pino log level |
| `LOG_DIR` | ./logs | Log file directory |
| `PROVIDER_ENCRYPTION_KEY` | *(required)* | AES-256-GCM key for encrypting the provider API key |

## Logs

Structured JSON logs are written to `backend/logs/app-YYYY-MM-DD.log` (14-day retention via `pino-roll`). Each entry includes `req.id` for correlation; the same value is returned to clients in the `x-request-id` response header.

## Database

PostgreSQL only. Set either `POSTGRES_URL` or the individual
`POSTGRES_HOST`/`POSTGRES_PORT`/`POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB`
variables, then run `npm run migration:run`.

Recreate the schema from scratch:
```bash
dropdb chatbot_db && createdb chatbot_db
npm run migration:run
```
