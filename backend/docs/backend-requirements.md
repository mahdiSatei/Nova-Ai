# Backend Specification — Phase 1 (MVP)

**Project:** CODELESS — AI Multi-Model Chat Platform
**Target:** Days 1–2 (Codebase Bootstrap, Auth, Models Admin, Streaming Chat)
**Stack:** NestJS, TypeScript, PostgreSQL, TypeORM, Passport-JWT, OpenAI SDK

---

## 1. System Architecture & Modules

The backend must be built using **NestJS** with modular architecture:

```
src/
├── app.module.ts
├── main.ts
├── common/
│   ├── decorators/       # @GetUser(), @Roles()
│   ├── filters/          # AllExceptionsFilter
│   ├── guards/           # JwtAuthGuard, RolesGuard
│   ├── interceptors/     # TransformInterceptor (standard response wrapper)
│   └── interfaces/       # Global types, standard API responses
├── config/
│   └── configuration.ts  # Env validation & loading
├── database/
│   ├── database.module.ts
│   └── seeds/            # Initial model & admin seeding
└── modules/
    ├── auth/             # Registration, Login, JWT strategy
    ├── users/            # User entity, service, repository
    ├── models/           # AIModel entity, User list, Admin CRUD
    ├── conversations/    # Conversation & Message entities, History CRUD
    ├── llm/              # OpenAI-compatible integration service
    └── chat/             # Chat orchestration & SSE streaming controller
```

---

## 2. Environment Configuration (`.env`)

```env
PORT=3000
NODE_ENV=development

# Database
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_NAME=codeless_db
DB_SYNCHRONIZE=true

# Security
JWT_SECRET=super-secret-jwt-key-change-in-production
JWT_EXPIRATION=7d
ADMIN_EMAIL=admin@codeless.local

# LLM Provider (OpenAI Compatible)
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=your-api-key-here
```

---

## 3. Database Schema & TypeORM Entities

### 3.1. User Entity

- **Table:** `users`

```typescript
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column({ select: false })
  password: string; // bcrypt hash

  @Column({ type: 'enum', enum: ['user', 'admin'], default: 'user' })
  role: 'user' | 'admin';

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => Conversation, (conv) => conv.user)
  conversations: Conversation[];
}
```

### 3.2. AIModel Entity

- **Table:** `ai_models`

```typescript
@Entity('ai_models')
export class AIModel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  modelId: string; // e.g. "gpt-4o-mini", "deepseek-chat"

  @Column()
  displayName: string; // e.g. "GPT-4o Mini"

  @Column({ default: true })
  isActive: boolean;

  @Column({ default: false })
  isDefault: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
```

### 3.3. Conversation Entity

- **Table:** `conversations`

```typescript
@Entity('conversations')
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @ManyToOne(() => User, (user) => user.conversations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ default: 'New Chat' })
  title: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => Message, (msg) => msg.conversation)
  messages: Message[];
}
```

### 3.4. Message Entity

- **Table:** `messages`

```typescript
@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  conversationId: string;

  @ManyToOne(() => Conversation, (conv) => conv.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversationId' })
  conversation: Conversation;

  @Column({ type: 'enum', enum: ['user', 'assistant', 'system'] })
  sender: 'user' | 'assistant' | 'system';

  @Column({ type: 'text' })
  content: string;

  @CreateDateColumn()
  createdAt: Date;
}
```

---

## 4. Database Seeding Requirements

On application bootstrap (`OnApplicationBootstrap` in a dedicated `SeederService`):

1. **Models Seed:** If `ai_models` table is empty, insert:
   - `modelId: "gpt-4o-mini"`, `displayName: "GPT-4o Mini"`, `isActive: true`, `isDefault: true`
   - `modelId: "deepseek-chat"`, `displayName: "DeepSeek Chat"`, `isActive: true`, `isDefault: false`

2. **Admin Role Setup:** During registration, if the incoming email === `process.env.ADMIN_EMAIL`, set `role = 'admin'`. Otherwise, default to `'user'`.

---

## 5. API Response Convention

**Standard Success Format (Interceptors)**

```json
{
  "success": true,
  "data": {}
}
```

**Standard Error Format (Exception Filter)**

```json
{
  "success": false,
  "message": "Error message description",
  "statusCode": 400
}
```

---

## 6. Endpoints & API Contract

### 6.1. Auth Module (`/api/auth`)

**POST `/api/auth/register`**

- **Access:** Public
- **Body:**
  ```json
  {
    "email": "string (email format)",
    "password": "string (min 6 characters)"
  }
  ```
- **Status:** 201 Created
- **Response Data:**
  ```json
  {
    "user": { "id": "uuid", "email": "string", "role": "user | admin" },
    "token": "jwt-bearer-token"
  }
  ```

**POST `/api/auth/login`**

- **Access:** Public
- **Body:** Same as register.
- **Status:** 200 OK
- **Response Data:** Same as register.

**GET `/api/auth/me`**

- **Access:** Authenticated (`JwtAuthGuard`)
- **Status:** 200 OK
- **Response Data:** Current user profile (`id`, `email`, `role`).

### 6.2. Models Module (`/api/models` & `/api/admin/models`)

**GET `/api/models`**

- **Access:** Authenticated (`JwtAuthGuard`)
- **Status:** 200 OK
- **Logic:** Returns all models where `isActive === true`.
- **Response Data:** Array of `{ id, modelId, displayName, isDefault }`.

**GET `/api/admin/models`**

- **Access:** Admin only (`JwtAuthGuard`, `RolesGuard('admin')`)
- **Status:** 200 OK
- **Logic:** Returns all models regardless of active status.
- **Response Data:** Array of all fields.

**PATCH `/api/admin/models/:id/toggle-active`**

- **Access:** Admin only
- **Status:** 200 OK
- **Logic:** Flips `isActive` (true → false or vice-versa).
- **Validation:** If the model is default (`isDefault === true`), it cannot be deactivated. Return 400 Bad Request.

**PATCH `/api/admin/models/:id/set-default`**

- **Access:** Admin only
- **Status:** 200 OK
- **Logic:**
  1. Set target model's `isDefault = true` and `isActive = true`.
  2. Set all other models' `isDefault = false`.
  3. Execute inside a database transaction.

### 6.3. Conversations Module (`/api/conversations`)

**GET `/api/conversations`**

- **Access:** Authenticated
- **Status:** 200 OK
- **Logic:** Fetch all conversations belonging to `req.user.id`, ordered by `updatedAt DESC`.

**POST `/api/conversations`**

- **Access:** Authenticated
- **Body:**
  ```json
  {
    "title": "string (optional)"
  }
  ```
- **Status:** 201 Created
- **Response Data:** Created conversation object.

**GET `/api/conversations/:id/messages`**

- **Access:** Authenticated
- **Status:** 200 OK
- **Logic:** Validate ownership of conversation (`userId === req.user.id`). If not found or mismatch, return 404/403. Return messages ordered by `createdAt ASC`.

### 6.4. Chat & Streaming Engine (`/api/chat`)

**POST `/api/chat/stream`**

- **Access:** Authenticated (`JwtAuthGuard`)
- **Headers:**
  - `Content-Type: application/json`
  - `Accept: text/event-stream`
- **Request DTO (`SendMessageDto`):**
  ```json
  {
    "conversationId": "uuid (optional)",
    "message": "string (non-empty)",
    "modelId": "string (optional - technical modelId)"
  }
  ```
- **Response:** Direct Express Response with SSE headers (`text/event-stream`).

**Server-Side Streaming Execution Lifecycle:**

1. **Conversation Resolution:**
   - If `conversationId` is missing, create a new Conversation with `title = first 30 chars of message`.
   - If provided, verify ownership against `req.user.id`.

2. **Model Selection:**
   - If `modelId` provided, find active model with that `modelId`.
   - If not provided, query the database for the model with `isDefault === true`.
   - If no valid model is found, return 400 Bad Request.

3. **Save User Message:**
   - Insert record into `messages` (`sender: 'user'`, `content: message`).

4. **Context Window Retrieval (Memory):**
   - Fetch the last 6 messages of this conversation ordered by `createdAt ASC`.
   - Format them into an OpenAI chat completion messages array: `[{ role: "user" | "assistant", content: "..." }]`

5. **OpenAI Provider Bridge:**
   - Initialize OpenAI client pointing to `process.env.LLM_BASE_URL` with `process.env.LLM_API_KEY`.
   - Call `openai.chat.completions.create({ model: selectedModel.modelId, messages: contextMessages, stream: true })`.

6. **SSE Protocol Transmission:**
   - **Headers set:**
     ```
     Content-Type: text/event-stream
     Cache-Control: no-cache
     Connection: keep-alive
     ```
   - **Event 1:** Initial event sending metadata:
     ```
     data: {"type":"start", "conversationId":"uuid"}\n\n
     ```
   - **Event 2..N:** Every token received from the LLM stream:
     ```
     data: {"type":"chunk", "content":"token_text"}\n\n
     ```
   - **On Stream Finish:**
     - Save the accumulated assistant response into `messages` (`sender: 'assistant'`, `content: fullText`).
     - Update `conversation.updatedAt = new Date()`.
     - Send terminal event:
       ```
       data: {"type":"done", "messageId":"saved_assistant_message_uuid"}\n\n
       ```
     - Close connection (`res.end()`).
   - **On Stream Error:**
     - Send error event:
       ```
       data: {"type":"error", "message":"LLM Provider error"}\n\n
       ```
     - Close connection (`res.end()`).

---

## 7. Global Pipes & Validations

1. Enable global `ValidationPipe` in `main.ts`:
   ```typescript
   app.useGlobalPipes(
     new ValidationPipe({
       whitelist: true,
       transform: true,
       forbidNonWhitelisted: true,
     }),
   );
   ```

2. Enable CORS in `main.ts` for local development:
   ```typescript
   app.enableCors({
     origin: true,
     credentials: true,
   });
   ```

3. Prefix all routes with `/api`:
   ```typescript
   app.setGlobalPrefix('api');
   ```

---

## 8. Definition of Done (DoD) for Backend Agent

- [ ] Database connects and tables (`users`, `ai_models`, `conversations`, `messages`) are auto-created.
- [ ] Seeder creates initial models on startup.
- [ ] Register and Login issue valid JWT tokens.
- [ ] Admin guard restricts `/api/admin/*` to admin users.
- [ ] Active models can be listed by users; admins can toggle and set default.
- [ ] Conversations and historical messages can be created and queried.
- [ ] `POST /api/chat/stream` streams response via SSE and correctly persists both User and Assistant messages upon completion.