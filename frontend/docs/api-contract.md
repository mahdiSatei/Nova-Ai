# API Contract — Phase 1 (MVP)
**Project:** CODELESS — AI Multi-Model Chat Platform  
**Base URL:** `http://localhost:3000/api`  
**Protocol:** REST + Server-Sent Events (SSE)  
**Encoding:** UTF-8 / JSON  

---

## 1. Global Conventions & Standards

### 1.1. Common Headers

#### Standard JSON Requests
```http
Content-Type: application/json
Accept: application/json
Authorization: Bearer <jwt_token>   # Required for protected routes

Streaming SSE Requests

Content-Type: application/json
Accept: text/event-stream
Authorization: Bearer <jwt_token>

1.2. Envelope Format

Success Response Envelope (Non-Streaming)

All standard 2xx responses return this JSON envelope:

{
  "success": true,
  "data": {} // Object, Array, or primitive
}

Error Response Envelope

All 4xx/5xx responses return this JSON structure:

{
  "success": false,
  "statusCode": 400,
  "message": "Detailed error message or validation errors array"
}

1.3. HTTP Status Codes

  - 200 OK: Request succeeded.
  - 201 Created: Resource successfully created.
  - 400 Bad Request: Validation failure or business logic violation.
  - 401 Unauthorized: Missing, invalid, or expired JWT token.
  - 403 Forbidden: Insufficient permissions (e.g., non-admin accessing admin
    route).
  - 404 Not Found: Target resource does not exist.
  - 500 Internal Server Error: Server or upstream provider failure.

2. Authentication Module (/api/auth)

2.1. Register User

Creates a new account and returns a JWT token immediately.

  - Endpoint: POST /api/auth/register
  - Access: Public
  - Request Body:
    {
      "email": "user@example.com",     // Required, valid email format
      "password": "secretPassword123"  // Required, string, min 6 chars
    }
  - Success Response (201 Created):
    {
      "success": true,
      "data": {
        "user": {
          "id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
          "email": "user@example.com",
          "role": "user" // or "admin" if matched ADMIN_EMAIL
        },
        "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
      }
    }
  - Error Response (400 Bad Request):
    {
      "success": false,
      "statusCode": 400,
      "message": "Email already exists"
    }

2.2. Login User

Authenticates credentials and returns a JWT token.

  - Endpoint: POST /api/auth/login
  - Access: Public
  - Request Body:
    {
      "email": "user@example.com",
      "password": "secretPassword123"
    }
  - Success Response (200 OK):
    {
      "success": true,
      "data": {
        "user": {
          "id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
          "email": "user@example.com",
          "role": "user"
        },
        "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
      }
    }
  - Error Response (401 Unauthorized):
    {
      "success": false,
      "statusCode": 401,
      "message": "Invalid email or password"
    }

2.3. Current User Profile

Fetches the session of the authenticated user.

  - Endpoint: GET /api/auth/me
  - Access: Authenticated (Bearer Token)
  - Success Response (200 OK):
    {
      "success": true,
      "data": {
        "id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        "email": "user@example.com",
        "role": "user"
      }
    }

3. AI Models Module (/api/models & /api/admin/models)

3.1. List Active Models (For Regular Users)

Used by the chat header model selector.

  - Endpoint: GET /api/models
  - Access: Authenticated
  - Success Response (200 OK):
    {
      "success": true,
      "data": [
        {
          "id": "1d234567-e89b-12d3-a456-426614174000",
          "modelId": "gpt-4o-mini",
          "displayName": "GPT-4o Mini",
          "isDefault": true
        },
        {
          "id": "2e345678-e89b-12d3-a456-426614174001",
          "modelId": "deepseek-chat",
          "displayName": "DeepSeek Chat",
          "isDefault": false
        }
      ]
    }

3.2. List All Models (Admin Panel)

  - Endpoint: GET /api/admin/models
  - Access: Admin only (role === 'admin')
  - Success Response (200 OK):
    {
      "success": true,
      "data": [
        {
          "id": "1d234567-e89b-12d3-a456-426614174000",
          "modelId": "gpt-4o-mini",
          "displayName": "GPT-4o Mini",
          "isActive": true,
          "isDefault": true,
          "createdAt": "2025-02-23T08:00:00.000Z"
        },
        {
          "id": "2e345678-e89b-12d3-a456-426614174001",
          "modelId": "deepseek-chat",
          "displayName": "DeepSeek Chat",
          "isActive": false,
          "isDefault": false,
          "createdAt": "2025-02-23T08:00:00.000Z"
        }
      ]
    }

3.3. Toggle Model Active Status (Admin)

  - Endpoint: PATCH /api/admin/models/:id/toggle-active
  - Access: Admin only
  - URL Params: id (UUID of the model)
  - Success Response (200 OK):
    {
      "success": true,
      "data": {
        "id": "2e345678-e89b-12d3-a456-426614174001",
        "modelId": "deepseek-chat",
        "displayName": "DeepSeek Chat",
        "isActive": true,
        "isDefault": false
      }
    }
  - Error Response (400 Bad Request):
    {
      "success": false,
      "statusCode": 400,
      "message": "Cannot deactivate the default model"
    }

3.4. Set Model As Default (Admin)

Sets this model as default and resets all other models to isDefault: false.

  - Endpoint: PATCH /api/admin/models/:id/set-default
  - Access: Admin only
  - URL Params: id (UUID of the model)
  - Success Response (200 OK):
    {
      "success": true,
      "data": {
        "id": "2e345678-e89b-12d3-a456-426614174001",
        "modelId": "deepseek-chat",
        "displayName": "DeepSeek Chat",
        "isActive": true,
        "isDefault": true
      }
    }

4. Conversations Module (/api/conversations)

4.1. List User Conversations

  - Endpoint: GET /api/conversations
  - Access: Authenticated
  - Success Response (200 OK):
    {
      "success": true,
      "data": [
        {
          "id": "b1b2b3b4-c5c6-d7d8-e9e0-f1f2f3f4f5f6",
          "title": "Quantum Computing Intro",
          "createdAt": "2025-02-23T10:15:30.000Z",
          "updatedAt": "2025-02-23T10:18:12.000Z"
        }
      ]
    }

4.2. Create New Conversation (Manual)

  - Endpoint: POST /api/conversations
  - Access: Authenticated
  - Request Body:
    {
      "title": "New Chat" // Optional, string, max 100 chars
    }
  - Success Response (201 Created):
    {
      "success": true,
      "data": {
        "id": "b1b2b3b4-c5c6-d7d8-e9e0-f1f2f3f4f5f6",
        "title": "New Chat",
        "userId": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        "createdAt": "2025-02-23T10:15:30.000Z",
        "updatedAt": "2025-02-23T10:15:30.000Z"
      }
    }

4.3. Get Conversation Messages

Loads message history when selecting a conversation from the sidebar.

  - Endpoint: GET /api/conversations/:id/messages
  - Access: Authenticated (Owner only)
  - URL Params: id (UUID of the conversation)
  - Success Response (200 OK):
    {
      "success": true,
      "data": [
        {
          "id": "m1111111-2222-3333-4444-555555555555",
          "sender": "user",
          "content": "What is Python?",
          "createdAt": "2025-02-23T10:16:00.000Z"
        },
        {
          "id": "m2222222-3333-4444-5555-666666666666",
          "sender": "assistant",
          "content": "Python is a high-level programming language...",
          "createdAt": "2025-02-23T10:16:03.000Z"
        }
      ]
    }
  - Error Response (404 Not Found):
    {
      "success": false,
      "statusCode": 404,
      "message": "Conversation not found"
    }

5. Chat & Streaming Engine Protocol (/api/chat)

5.1. Send Message & Stream Response

  - Endpoint: POST /api/chat/stream
  - Access: Authenticated
  - Request Headers:
      - Content-Type: application/json
      - Accept: text/event-stream
      - Authorization: Bearer <token>
  - Request Body:
    {
      "conversationId": "b1b2b3b4-c5c6-d7d8-e9e0-f1f2f3f4f5f6", // Optional (if omitted, server creates one)
      "message": "Explain binary search in simple terms.",       // Required, non-empty string
      "modelId": "gpt-4o-mini"                                   // Optional (if omitted, server uses default)
    }

5.2. SSE Stream Events Specification

The server responds with HTTP Status 200 OK and Content-Type text/event-stream.
Each SSE message is formatted as: data: <JSON_PAYLOAD>\n\n

Event Types Breakdown:

1. start Event

Dispatched once at the start. Transmits the conversation ID (useful when a new
chat was auto-created).

data: {"type":"start","conversationId":"b1b2b3b4-c5c6-d7d8-e9e0-f1f2f3f4f5f6"}

2. chunk Event

Dispatched repeatedly for each token yielded by the LLM Provider.

data: {"type":"chunk","content":"Binary "}

data: {"type":"chunk","content":"search "}

data: {"type":"chunk","content":"is an efficient algorithm..."}

3. done Event

Dispatched once when the LLM stream completes and the full assistant message is
committed to the database.

data: {"type":"done","messageId":"m3333333-4444-5555-6666-777777777777"}

4. error Event

Dispatched if the provider or network fails midway.

data: {"type":"error","message":"Upstream provider connection timeout"}

5.3. Wire Example (Complete Stream Session)

HTTP/1.1 200 OK
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache
Connection: keep-alive

data: {"type":"start","conversationId":"b1b2b3b4-c5c6-d7d8-e9e0-f1f2f3f4f5f6"}

data: {"type":"chunk","content":"Hello"}

data: {"type":"chunk","content":"! How"}

data: {"type":"chunk","content":" can I help you today?"}

data: {"type":"done","messageId":"m2222222-3333-4444-5555-666666666666"}

(Connection closed by server)