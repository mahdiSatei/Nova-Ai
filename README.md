# Multi-Model Chatbot Platform

A web-based chatbot application with support for multiple AI models, streaming responses, user authentication, and an admin panel for managing providers and models.

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | NestJS 10, TypeScript, TypeORM, SQLite / PostgreSQL |
| Frontend | Vue 3, Vite, Pinia, Vue Router, TailwindCSS 4 |
| Auth | JWT (HS256), Argon2 password hashing |
| Streaming | Server-Sent Events (SSE) |

## Project Structure

```
├── backend/          # NestJS API server
│   ├── src/          # Application source code
│   ├── test/         # Unit and integration tests
│   ├── specs/        # Feature specifications and contracts
│   └── scripts/      # Admin seeding, OpenAPI export
├── frontend/
│   ├── app/          # Vue 3 SPA (Vite)
│   └── specs/        # Frontend specifications
└── .gitignore
```

## Prerequisites

- Node.js >= 20

## Getting Started

### Backend

```bash
cd backend
cp .env.example .env
npm install
npm run build
npm start
```

For development with hot-reload:

```bash
npm run start:dev
```

To seed the initial admin account:

```bash
npm run seed:admin
```

### Frontend

```bash
cd frontend/app
npm install
npm run dev
```

For production build:

```bash
npm run build
npm run preview
```

## Features

- User registration and login with JWT authentication
- Model selection from admin-enabled AI models
- Real-time streaming chat via SSE
- Conversation history with create and delete support
- Admin panel for configuring the central OpenAI-compatible provider
- Admin management of models (add, edit, enable/disable, delete)
- System-wide default model configuration
- Role-based access control (user / admin)
- Encrypted provider credentials at rest
