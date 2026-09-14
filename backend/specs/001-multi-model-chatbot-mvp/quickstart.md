# Quickstart: Multi-Model Chatbot MVP (Validation Guide)

**Branch**: `[001-multi-model-chatbot-mvp]` | **Date**: 2026-09-13
**Source plan**: [plan.md](plan.md)

This guide walks you through running the backend, exercising its end-to-end
flow with `curl`, and verifying that the MVP is working. It is intentionally
scriptable: every step has a copy-pastable command.

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| Node.js | 20 LTS | Runtime |
| npm | 10+ | Package manager |
| OpenSSL | any | Generate secrets |
| `curl` | any | Smoke tests below |
| `sqlite3` CLI | optional | Inspect the DB file |

## One-time setup

```bash
# From the backend/ directory
cd backend

# Install dependencies
npm install

# Generate secrets
export JWT_SECRET=$(openssl rand -hex 32)
export JWT_REFRESH_SECRET=$(openssl rand -hex 32)
export PROVIDER_ENCRYPTION_KEY=$(openssl rand -base64 32)

# Persist to a local .env file (gitignored)
cat > .env <<EOF
PORT=3000
NODE_ENV=development
JWT_SECRET=$JWT_SECRET
JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d
DB_DRIVER=sqlite
SQLITE_FILE=./data/app.sqlite
LOG_LEVEL=info
LOG_DIR=./logs
PROVIDER_ENCRYPTION_KEY=$PROVIDER_ENCRYPTION_KEY
EOF

# Run migrations
npm run migration:run
```

To turn on real provider calls, also set:

```bash
echo 'OPENAI_COMPAT_BASE_URL=https://api.openai.com/v1' >> .env
echo 'OPENAI_COMPAT_API_KEY=sk-...' >> .env
```

These env vars are read by the operator when seeding the central provider
via the admin API (see step 5 below). They are NOT read directly by the
chat code path — that path reads the encrypted credential from the DB.

## Run the service

```bash
# Development with auto-reload
npm run start:dev

# Output (in another terminal):
# [Nest] LOG [NestApplication] Nest application successfully started
# Listening on http://localhost:3000
```

## Smoke tests

These steps verify the user-side journey end-to-end. Admin steps follow.

### 1. Health

```bash
curl -s http://localhost:3000/healthz
# → "ok"

curl -s http://localhost:3000/readyz
# → "ok"
```

### 2. Register a user

```bash
curl -s -X POST http://localhost:3000/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.com","password":"correct-horse-battery-staple"}'
```

Capture the tokens for the next steps:

```bash
ACCESS=$(curl -s -X POST http://localhost:3000/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.com","password":"correct-horse-battery-staple"}' \
  | jq -r .accessToken)
```

### 3. Try to list models — should be empty before any admin config

```bash
curl -s http://localhost:3000/v1/models -H "Authorization: Bearer $ACCESS"
# → {"items":[]}
```

### 4. Create an admin user (DB seed, out-of-band per spec)

The MVP requires admin accounts to be seeded out-of-band. The simplest path
is a one-shot script that hashes a password and inserts the row. For MVP
you can do this via a TypeORM CLI script:

```bash
cat > scripts/seed-admin.ts <<'EOF'
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as argon2 from 'argon2';
import { config } from 'dotenv';
config();
import { User } from '../src/modules/users/entities/user.entity';
import { dataSourceOptions } from '../src/database/data-source';

(async () => {
  const ds = new DataSource(dataSourceOptions);
  await ds.initialize();
  const repo = ds.getRepository(User);
  const passwordHash = await argon2.hash(process.env.SEED_ADMIN_PASSWORD!);
  await repo.save(repo.create({
    email: process.env.SEED_ADMIN_EMAIL!.toLowerCase(),
    passwordHash,
    role: 'admin',
  }));
  console.log('admin seeded');
  await ds.destroy();
})();
EOF

SEED_ADMIN_EMAIL=admin@example.com \
SEED_ADMIN_PASSWORD=admin-password-very-long \
npx ts-node scripts/seed-admin.ts
```

### 5. Admin: configure central provider

```bash
ADMIN_ACCESS=$(curl -s -X POST http://localhost:3000/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"admin-password-very-long"}' \
  | jq -r .accessToken)

# Update provider
curl -s -X PUT http://localhost:3000/v1/admin/provider \
  -H "Authorization: Bearer $ADMIN_ACCESS" \
  -H 'Content-Type: application/json' \
  -d '{"baseUrl":"https://api.openai.com/v1","apiKey":"sk-..."}'

# Read it back (credential must be masked)
curl -s http://localhost:3000/v1/admin/provider -H "Authorization: Bearer $ADMIN_ACCESS"
```

### 6. Admin: add a model

```bash
MODEL_JSON=$(curl -s -X POST http://localhost:3000/v1/admin/models \
  -H "Authorization: Bearer $ADMIN_ACCESS" \
  -H 'Content-Type: application/json' \
  -d '{"displayName":"GPT-4o mini","actualName":"gpt-4o-mini","enabled":true}')

MODEL_ID=$(echo "$MODEL_JSON" | jq -r .id)
```

### 7. Admin: set the default model

```bash
curl -s -X PUT http://localhost:3000/v1/admin/config \
  -H "Authorization: Bearer $ADMIN_ACCESS" \
  -H 'Content-Type: application/json' \
  -d "{\"defaultModelId\":\"$MODEL_ID\"}"
```

### 8. User: see the model in the picker

```bash
curl -s http://localhost:3000/v1/models -H "Authorization: Bearer $ACCESS"
# → {"items":[{"id":"<MODEL_ID>","displayName":"GPT-4o mini","isDefault":true}]}
```

### 9. User: stream a chat

```bash
curl -N -X POST http://localhost:3000/v1/chat/stream \
  -H "Authorization: Bearer $ACCESS" \
  -H 'Content-Type: application/json' \
  -d '{"message":"Hello, who are you?"}'
```

Expected output (truncated):

```
data: {"delta":"Hello"}

data: {"delta"," there"}

event: done
data: {}
```

### 10. User: list conversation history

```bash
curl -s http://localhost:3000/v1/conversations -H "Authorization: Bearer $ACCESS"
```

## Verification matrix

Each row maps to a Success Criterion in `spec.md`. Run the row's command and
check the result.

| Check | Command | Expected | SC |
|---|---|---|---|
| Register-to-stream < 3 min | Steps 1 → 9 above, timed | < 180 s | SC-001 |
| Token arrival latency | `curl -N ...` then `Time:` header | < 1 s delta | SC-002 |
| 100 concurrent streams | load tool (e.g., `wrk` or `k6`) — out of scope here | < 1 s P95 | SC-003 |
| Admin config → user visible | Steps 5 → 8 | model appears in picker | SC-004 |
| 95% completion rate | scripted 100 sends; count errors | ≥ 95 succeed | SC-005 |
| Credential masked in API | Step 5 GET | no plaintext key | SC-006 |
| Admin endpoints reject user JWT | curl `/v1/admin/models` with `$ACCESS` | 403 | SC-007 |
| Display name only in picker | Step 8 | no `actualName` field | SC-008 |
| First chat hits default | fresh user, no explicit selection | response uses default | SC-009 |

## Logs

Structured JSON logs are written to `backend/logs/app-YYYY-MM-DD.log`. View
the latest:

```bash
tail -f backend/logs/app-*.log | jq .
```

Every entry includes `req.id` (request correlation id) and `time`, plus the
log level and message. The same `req.id` is returned to clients in the
`x-request-id` response header.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Provider not configured` from chat | Step 5 not done | Run step 5 |
| `no_model_available` (422) | No default set, no explicit selection | Run step 7 |
| Login returns 401 with correct creds | Account role mismatch (admin endpoint or vice versa) | Check `role` field in DB |
| SSE stream terminates early | Provider rejected the API key or model id | Check `backend/logs/` |
| Migrations fail | `data/` directory missing | `mkdir -p backend/data` |
| `argon2` build error on Windows | No C++ toolchain | Fall back to `bcrypt` (see `research.md`) |

## Stopping the service

```bash
# Ctrl-C the dev server, then
rm -f backend/data/app.sqlite   # Wipe DB; re-run migrations to start fresh
```

## Next step

When all smoke tests pass and you want to move to task decomposition, run
`/speckit-tasks`. Implementation tasks are NOT generated here.
