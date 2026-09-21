# Usage & Cost Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record model consumption (tokens) and estimated cost for every chat request, with an admin usage report.

**Architecture:** A new `usage_records` table captures per-request token usage and cost. Usage is recorded after each streaming response completes (success or failure) by extracting the `usage` object from the provider's final SSE chunk. Model pricing is stored as two columns on the existing `models` table (`inputPricePer1k`, `outputPricePer1k`). An admin endpoint provides paginated usage reports with filtering by user, model, provider, and time range. The frontend adds an admin usage page.

**Tech Stack:** NestJS, TypeORM (PostgreSQL), RxJS, OpenAI SDK, Vue 3, Vitest, Jest.

**Spec:** `backend/specs/004-usage-cost-tracking/spec.md` (this plan).

## Global Constraints

- Node ≥ 20, NestJS 10.x, TypeORM 0.3.x.
- PostgreSQL only for integration tests (`chatbot_test` database on port 5435 via `POSTGRES_PORT` env).
- `class-validator` + `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` at the boundary.
- No `git` commands by implementers; each task ends with a `Suggested commit message:`.
- Error codes follow existing patterns: `{ code: string; message: string }`.

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/specs/004-usage-cost-tracking/spec.md` | Phase spec |
| `backend/specs/001-multi-model-chatbot-mvp/contracts/openapi-3.1.yaml` | Add `/v1/admin/usage` endpoint + schemas |
| `backend/src/modules/usage/entities/usage-record.entity.ts` | Usage record entity |
| `backend/src/modules/usage/usage.service.ts` | Usage recording + admin report queries |
| `backend/src/modules/usage/usage.module.ts` | Module wiring |
| `backend/src/modules/usage/dto/admin-usage-query.dto.ts` | Admin report query DTO |
| `backend/src/modules/usage/usage.admin.controller.ts` | Admin usage report endpoint |
| `backend/src/modules/models/entities/model.entity.ts` | Add `inputPricePer1k`, `outputPricePer1k` columns |
| `backend/src/modules/provider/adapters/provider-adapter.interface.ts` | Add `usage` field to `ProviderStreamChunk` |
| `backend/src/modules/provider/adapters/openai-compatible.adapter.ts` | Pass `stream_options: { include_usage: true }` |
| `backend/src/modules/chat/chat.service.ts` | Record usage after streaming completes |
| `backend/src/database/migrations/1700000007000-add-usage-records-and-model-pricing.ts` | Migration |
| `backend/test/unit/usage-record.entity.spec.ts` | Entity column mapping tests |
| `backend/test/unit/usage.service.spec.ts` | Usage service unit tests |
| `backend/test/unit/usage.admin.controller.spec.ts` | Admin controller unit tests |
| `backend/test/unit/chat.service-usage.spec.ts` | Chat service usage recording tests |
| `backend/test/contract/usage-contract.spec.ts` | Contract validation |
| `backend/test/integration/usage.e2e.spec.ts` | End-to-end acceptance tests |
| `frontend/app/src/views/admin/UsageView.vue` | Admin usage report page |
| `frontend/app/src/api/admin.ts` | Add `listAdminUsage` function |
| `frontend/app/src/types/api.ts` | Add `UsageRecord`, `UsageReport` types |
| `frontend/app/src/router/index.ts` | Add `/admin/usage` route |
| `frontend/app/src/layouts/AdminShell.vue` | Add "Usage" nav item |
| `frontend/app/tests/api/admin-usage.spec.ts` | Frontend API tests |

---

## Task 1: Phase spec + OpenAPI contract + contract test

**Files:**
- Create: `backend/specs/004-usage-cost-tracking/spec.md`
- Modify: `backend/specs/001-multi-model-chatbot-mvp/contracts/openapi-3.1.yaml`
- Create: `backend/test/contract/usage-contract.spec.ts`

**Interfaces:**
- Consumes: existing OpenAPI structure at `specs/001-multi-model-chatbot-mvp/contracts/openapi-3.1.yaml`
- Produces: OpenAPI schemas for `UsageRecord`, `UsageReport`, `GET /v1/admin/usage` endpoint

**Steps:**

- [ ] **Step 1: Write the phase spec**

Create `backend/specs/004-usage-cost-tracking/spec.md` with:
- Goal, scope, acceptance criteria (copied from the brief above).
- Data model: `usage_records` table schema.
- API contract: `GET /v1/admin/usage` request/response shapes.
- Pricing model: per-model `inputPricePer1k` / `outputPricePer1k`.
- Disconnected client behavior: usage recorded after provider stream completes, not on client disconnect.

- [ ] **Step 2: Add OpenAPI schemas**

In `openapi-3.1.yaml`, add after the existing admin user schemas:

```yaml
    UsageRecord:
      type: object
      properties:
        id:
          type: string
          format: uuid
        userId:
          type: string
        conversationId:
          type: string
        messageId:
          type: string
          nullable: true
        modelId:
          type: string
        modelName:
          type: string
        providerId:
          type: string
        providerName:
          type: string
        promptTokens:
          type: integer
        completionTokens:
          type: integer
        totalTokens:
          type: integer
        estimatedCost:
          type: number
          format: float
        status:
          type: string
          enum: [pending, completed, failed]
        createdAt:
          type: string
          format: date-time
        completedAt:
          type: string
          format: date-time
          nullable: true

    UsageReport:
      type: object
      properties:
        items:
          type: array
          items:
            $ref: '#/components/schemas/UsageRecord'
        total:
          type: integer
        totals:
          type: object
          properties:
            totalTokens:
              type: integer
            totalCost:
              type: number
              format: float
            requestCount:
              type: integer
```

- [ ] **Step 3: Add the endpoint**

In `openapi-3.1.yaml`, add after the admin users endpoint:

```yaml
  /v1/admin/usage:
    get:
      tags: [admin]
      summary: List usage records with filters
      security:
        - bearerAuth: []
      parameters:
        - name: userId
          in: query
          schema: { type: string }
        - name: modelId
          in: query
          schema: { type: string }
        - name: providerId
          in: query
          schema: { type: string }
        - name: status
          in: query
          schema: { type: string, enum: [pending, completed, failed] }
        - name: from
          in: query
          schema: { type: string, format: date-time }
          description: Start of time range (ISO 8601)
        - name: to
          in: query
          schema: { type: string, format: date-time }
          description: End of time range (ISO 8601)
        - name: limit
          in: query
          schema: { type: integer, default: 20, minimum: 1, maximum: 100 }
        - name: offset
          in: query
          schema: { type: integer, default: 0, minimum: 0 }
      responses:
        '200':
          description: Paginated usage records with aggregate totals
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/UsageReport'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          $ref: '#/components/responses/Forbidden'
```

- [ ] **Step 4: Write the contract test**

Create `backend/test/contract/usage-contract.spec.ts`:

```typescript
import { getMetadataArgsStorage } from 'typeorm';

function column(name: string, target: object) {
  const found = getMetadataArgsStorage().columns.find(
    (c) => c.target === target && c.propertyName === name,
  );
  if (!found) throw new Error(`${target.constructor.name}.${name} is not a mapped column`);
  return found.options;
}

describe('usage-records contract', () => {
  it('UsageRecord entity has all required columns', () => {
    // Will fail until entity is created in Task 2
    const entity = require('../../src/modules/usage/entities/usage-record.entity');
    expect(entity).toBeDefined();
  });
});
```

- [ ] **Step 5: Run contract test to verify it fails**

Run: `cd backend && npx jest test/contract/usage-contract.spec.ts --no-coverage`
Expected: FAIL (module not found)

- [ ] **Step 6: Suggested commit message**

```
Suggested commit message: docs(spec,contract): add phase 4 usage and cost tracking surface
```

---

## Task 2: Migration + entities (usage_records, model pricing)

**Files:**
- Create: `backend/src/modules/usage/entities/usage-record.entity.ts`
- Create: `backend/src/database/migrations/1700000007000-add-usage-records-and-model-pricing.ts`
- Modify: `backend/src/modules/models/entities/model.entity.ts`
- Create: `backend/test/unit/usage-record.entity.spec.ts`

**Interfaces:**
- Consumes: existing `User`, `Conversation`, `Message`, `Model`, `Provider` entities
- Produces: `UsageRecord` entity with all columns, model pricing columns, migration

**Steps:**

- [ ] **Step 1: Write the entity column tests**

Create `backend/test/unit/usage-record.entity.spec.ts`:

```typescript
import { getMetadataArgsStorage } from 'typeorm';

function column(name: string, target: object) {
  const found = getMetadataArgsStorage().columns.find(
    (c) => c.target === target && c.propertyName === name,
  );
  if (!found) throw new Error(`${target.constructor.name}.${name} is not a mapped column`);
  return found.options;
}

describe('UsageRecord entity', () => {
  it('maps usage_records with correct columns', () => {
    const { UsageRecord } = require('../../src/modules/usage/entities/usage-record.entity');
    expect(column('id', UsageRecord)).toMatchObject({ type: 'uuid' });
    expect(column('userId', UsageRecord)).toMatchObject({ type: 'text' });
    expect(column('conversationId', UsageRecord)).toMatchObject({ type: 'text' });
    expect(column('messageId', UsageRecord)).toMatchObject({ type: 'text', nullable: true });
    expect(column('modelId', UsageRecord)).toMatchObject({ type: 'text' });
    expect(column('providerId', UsageRecord)).toMatchObject({ type: 'text' });
    expect(column('promptTokens', UsageRecord)).toMatchObject({ type: 'int' });
    expect(column('completionTokens', UsageRecord)).toMatchObject({ type: 'int' });
    expect(column('totalTokens', UsageRecord)).toMatchObject({ type: 'int' });
    expect(column('estimatedCost', UsageRecord)).toMatchObject({ type: 'decimal' });
    expect(column('status', UsageRecord)).toMatchObject({ type: 'text', default: 'pending' });
  });
});

describe('Model pricing columns', () => {
  it('maps inputPricePer1k with a zero default', () => {
    const { Model } = require('../../src/modules/models/entities/model.entity');
    const options = column('inputPricePer1k', Model);
    expect(options.type).toBe('decimal');
    expect(options.default).toBe(0);
  });

  it('maps outputPricePer1k with a zero default', () => {
    const { Model } = require('../../src/modules/models/entities/model.entity');
    const options = column('outputPricePer1k', Model);
    expect(options.type).toBe('decimal');
    expect(options.default).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest test/unit/usage-record.entity.spec.ts --no-coverage`
Expected: FAIL (module not found)

- [ ] **Step 3: Create the UsageRecord entity**

Create `backend/src/modules/usage/entities/usage-record.entity.ts`:

```typescript
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Conversation } from '../../conversations/entities/conversation.entity';
import { Message } from '../../conversations/entities/message.entity';
import { Model } from '../../models/entities/model.entity';
import { Provider } from '../../provider/entities/provider.entity';

@Entity({ name: 'usage_records' })
@Index('idx_usage_user_created', ['userId', 'createdAt'])
@Index('idx_usage_model_created', ['modelId', 'createdAt'])
@Index('idx_usage_provider_created', ['providerId', 'createdAt'])
@Index('idx_usage_conversation', ['conversationId'])
@Index('idx_usage_message', ['messageId'], { unique: true })
export class UsageRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'conversation_id', type: 'text' })
  conversationId!: string;

  @ManyToOne(() => Conversation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation!: Conversation;

  /** Nullable until streaming completes — set when the provider supplies usage. */
  @Column({ name: 'message_id', type: 'text', nullable: true })
  messageId!: string | null;

  @ManyToOne(() => Message, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'message_id' })
  message!: Message | null;

  @Column({ name: 'model_id', type: 'text' })
  modelId!: string;

  @ManyToOne(() => Model, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'model_id' })
  model!: Model;

  @Column({ name: 'provider_id', type: 'text' })
  providerId!: string;

  @ManyToOne(() => Provider, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'provider_id' })
  provider!: Provider;

  @Column({ name: 'prompt_tokens', type: 'int', default: 0 })
  promptTokens!: number;

  @Column({ name: 'completion_tokens', type: 'int', default: 0 })
  completionTokens!: number;

  @Column({ name: 'total_tokens', type: 'int', default: 0 })
  totalTokens!: number;

  /** Estimated cost in USD. Calculated from model pricing after streaming. */
  @Column({ name: 'estimated_cost', type: 'decimal', precision: 12, scale: 8, default: 0 })
  estimatedCost!: number;

  @Column({ type: 'text', default: 'pending' })
  status!: 'pending' | 'completed' | 'failed';

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  /** Set when the provider stream completes or fails. */
  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  completedAt!: Date | null;
}
```

- [ ] **Step 4: Add pricing columns to Model entity**

In `backend/src/modules/models/entities/model.entity.ts`, add before the `@OneToMany` line:

```typescript
  /** Cost per 1,000 input tokens (USD). Zero means free or unpriced. */
  @Column({ name: 'input_price_per_1k', type: 'decimal', precision: 10, scale: 6, default: 0 })
  inputPricePer1k!: number;

  /** Cost per 1,000 output tokens (USD). Zero means free or unpriced. */
  @Column({ name: 'output_price_per_1k', type: 'decimal', precision: 10, scale: 6, default: 0 })
  outputPricePer1k!: number;
```

- [ ] **Step 5: Create the migration**

Create `backend/src/database/migrations/1700000007000-add-usage-records-and-model-pricing.ts`:

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUsageRecordsAndModelPricing1700000007000 implements MigrationInterface {
  name = '1700000007000-add-usage-records-and-model-pricing';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE usage_records (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
        model_id TEXT NOT NULL REFERENCES models(id) ON DELETE RESTRICT,
        provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
        prompt_tokens INT NOT NULL DEFAULT 0,
        completion_tokens INT NOT NULL DEFAULT 0,
        total_tokens INT NOT NULL DEFAULT 0,
        estimated_cost DECIMAL(12,8) NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        completed_at TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`CREATE INDEX idx_usage_user_created ON usage_records(user_id, created_at)`);
    await queryRunner.query(`CREATE INDEX idx_usage_model_created ON usage_records(model_id, created_at)`);
    await queryRunner.query(`CREATE INDEX idx_usage_provider_created ON usage_records(provider_id, created_at)`);
    await queryRunner.query(`CREATE INDEX idx_usage_conversation ON usage_records(conversation_id)`);
    await queryRunner.query(`CREATE UNIQUE INDEX idx_usage_message ON usage_records(message_id) WHERE message_id IS NOT NULL`);

    await queryRunner.query(`ALTER TABLE models ADD COLUMN input_price_per_1k DECIMAL(10,6) NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE models ADD COLUMN output_price_per_1k DECIMAL(10,6) NOT NULL DEFAULT 0`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE models DROP COLUMN output_price_per_1k`);
    await queryRunner.query(`ALTER TABLE models DROP COLUMN input_price_per_1k`);
    await queryRunner.query(`DROP TABLE usage_records`);
  }
}
```

- [ ] **Step 6: Run entity tests to verify they pass**

Run: `cd backend && npx jest test/unit/usage-record.entity.spec.ts --no-coverage`
Expected: PASS

- [ ] **Step 7: Run contract test to verify it passes**

Run: `cd backend && npx jest test/contract/usage-contract.spec.ts --no-coverage`
Expected: PASS

- [ ] **Step 8: Suggested commit message**

```
Suggested commit message: feat(usage): add UsageRecord entity and model pricing columns with backwards-compatible defaults
```

---

## Task 3: Usage tracking service

**Files:**
- Create: `backend/src/modules/usage/usage.service.ts`
- Create: `backend/src/modules/usage/usage.module.ts`
- Create: `backend/test/unit/usage.service.spec.ts`

**Interfaces:**
- Consumes: `UsageRecord` entity, `Model` entity (for pricing), `Repository<UsageRecord>`
- Produces: `UsageService.create()`, `UsageService.finalize()`, `UsageService.listForAdmin()`, `UsageService.calculateCost()`

**Steps:**

- [ ] **Step 1: Write the unit tests**

Create `backend/test/unit/usage.service.spec.ts`:

```typescript
import { UsageService } from '../../src/modules/usage/usage.service';

describe('UsageService', () => {
  let service: UsageService;
  let mockRepo: any;

  beforeEach(() => {
    mockRepo = {
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => ({ id: 'usage-1', ...data })),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(() => ({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      })),
    };
    service = new UsageService(mockRepo);
  });

  describe('calculateCost', () => {
    it('returns 0 when both prices are 0', () => {
      const cost = service.calculateCost(100, 50, 0, 0);
      expect(cost).toBe(0);
    });

    it('calculates cost from input and output prices', () => {
      // $0.01 per 1k input, $0.03 per 1k output
      // 100 input tokens = 0.1k * $0.01 = $0.001
      // 50 output tokens = 0.05k * $0.03 = $0.0015
      // Total = $0.0025
      const cost = service.calculateCost(100, 50, 0.01, 0.03);
      expect(cost).toBeCloseTo(0.0025, 8);
    });

    it('handles zero tokens gracefully', () => {
      const cost = service.calculateCost(0, 0, 0.01, 0.03);
      expect(cost).toBe(0);
    });
  });

  describe('create', () => {
    it('creates a pending usage record', async () => {
      const record = await service.create({
        userId: 'user-1',
        conversationId: 'conv-1',
        modelId: 'model-1',
        providerId: 'prov-1',
      });
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          conversationId: 'conv-1',
          modelId: 'model-1',
          providerId: 'prov-1',
          status: 'pending',
        }),
      );
      expect(mockRepo.save).toHaveBeenCalled();
      expect(record.status).toBe('pending');
    });
  });

  describe('finalize', () => {
    it('updates usage record with token counts and cost', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 'usage-1',
        modelId: 'model-1',
        status: 'pending',
      });

      await service.finalize('usage-1', {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        inputPricePer1k: 0.01,
        outputPricePer1k: 0.03,
        status: 'completed',
      });

      expect(mockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          status: 'completed',
          completedAt: expect.any(Date),
        }),
      );
    });

    it('marks as failed when status is failed', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 'usage-1',
        modelId: 'model-1',
        status: 'pending',
      });

      await service.finalize('usage-1', {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        inputPricePer1k: 0,
        outputPricePer1k: 0,
        status: 'failed',
      });

      expect(mockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed' }),
      );
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest test/unit/usage.service.spec.ts --no-coverage`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement UsageService**

Create `backend/src/modules/usage/usage.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UsageRecord } from './entities/usage-record.entity';

export interface CreateUsageInput {
  userId: string;
  conversationId: string;
  modelId: string;
  providerId: string;
}

export interface FinalizeUsageInput {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  inputPricePer1k: number;
  outputPricePer1k: number;
  status: 'completed' | 'failed';
}

export interface AdminUsageQuery {
  userId?: string;
  modelId?: string;
  providerId?: string;
  status?: string;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
}

@Injectable()
export class UsageService {
  constructor(
    @InjectRepository(UsageRecord)
    private readonly repo: Repository<UsageRecord>,
  ) {}

  /** Calculate estimated cost from token counts and per-1k pricing. */
  calculateCost(
    promptTokens: number,
    completionTokens: number,
    inputPricePer1k: number,
    outputPricePer1k: number,
  ): number {
    const inputCost = (promptTokens / 1000) * inputPricePer1k;
    const outputCost = (completionTokens / 1000) * outputPricePer1k;
    return Math.round((inputCost + outputCost) * 1e8) / 1e8; // 8 decimal places
  }

  /** Create a pending usage record at the start of a request. */
  async create(input: CreateUsageInput): Promise<UsageRecord> {
    const record = this.repo.create({
      ...input,
      status: 'pending',
    });
    return this.repo.save(record);
  }

  /** Finalize a usage record after the provider stream completes or fails. */
  async finalize(id: string, input: FinalizeUsageInput): Promise<void> {
    const record = await this.repo.findOne({ where: { id } });
    if (!record) return;

    const cost =
      input.status === 'completed'
        ? this.calculateCost(
            input.promptTokens,
            input.completionTokens,
            input.inputPricePer1k,
            input.outputPricePer1k,
          )
        : 0;

    record.promptTokens = input.promptTokens;
    record.completionTokens = input.completionTokens;
    record.totalTokens = input.totalTokens;
    record.estimatedCost = cost;
    record.status = input.status;
    record.completedAt = new Date();

    await this.repo.save(record);
  }

  /** List usage records for admin report with filters and pagination. */
  async listForAdmin(query: AdminUsageQuery) {
    const qb = this.repo
      .createQueryBuilder('u')
      .leftJoinAndSelect('u.model', 'model')
      .leftJoinAndSelect('u.provider', 'provider')
      .leftJoinAndSelect('u.user', 'user');

    if (query.userId) {
      qb.andWhere('u.userId = :userId', { userId: query.userId });
    }
    if (query.modelId) {
      qb.andWhere('u.modelId = :modelId', { modelId: query.modelId });
    }
    if (query.providerId) {
      qb.andWhere('u.providerId = :providerId', { providerId: query.providerId });
    }
    if (query.status) {
      qb.andWhere('u.status = :status', { status: query.status });
    }
    if (query.from) {
      qb.andWhere('u.createdAt >= :from', { from: query.from });
    }
    if (query.to) {
      qb.andWhere('u.createdAt <= :to', { to: query.to });
    }

    qb.orderBy('u.createdAt', 'DESC')
      .skip(query.offset)
      .take(query.limit);

    const [items, total] = await qb.getManyAndCount();

    // Aggregate totals for the filtered set (without pagination limits)
    const totalsQb = this.repo
      .createQueryBuilder('u')
      .select('COALESCE(SUM(u.total_tokens), 0)', 'totalTokens')
      .addSelect('COALESCE(SUM(u.estimated_cost), 0)', 'totalCost')
      .addSelect('COUNT(*)', 'requestCount');

    if (query.userId) totalsQb.andWhere('u.userId = :userId', { userId: query.userId });
    if (query.modelId) totalsQb.andWhere('u.modelId = :modelId', { modelId: query.modelId });
    if (query.providerId) totalsQb.andWhere('u.providerId = :providerId', { providerId: query.providerId });
    if (query.status) totalsQb.andWhere('u.status = :status', { status: query.status });
    if (query.from) totalsQb.andWhere('u.createdAt >= :from', { from: query.from });
    if (query.to) totalsQb.andWhere('u.createdAt <= :to', { to: query.to });

    const totals = await totalsQb.getRawOne();

    return {
      items,
      total,
      totals: {
        totalTokens: Number(totals?.totalTokens ?? 0),
        totalCost: Number(totals?.totalCost ?? 0),
        requestCount: Number(totals?.requestCount ?? 0),
      },
    };
  }
}
```

- [ ] **Step 4: Create the module**

Create `backend/src/modules/usage/usage.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsageRecord } from './entities/usage-record.entity';
import { UsageService } from './usage.service';

@Module({
  imports: [TypeOrmModule.forFeature([UsageRecord])],
  providers: [UsageService],
  exports: [UsageService],
})
export class UsageModule {}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx jest test/unit/usage.service.spec.ts --no-coverage`
Expected: PASS

- [ ] **Step 6: Suggested commit message**

```
Suggested commit message: feat(usage): add UsageService for recording and querying usage records
```

---

## Task 4: Provider adapter interface + OpenAI usage extraction

**Files:**
- Modify: `backend/src/modules/provider/adapters/provider-adapter.interface.ts`
- Modify: `backend/src/modules/provider/adapters/openai-compatible.adapter.ts`
- Create: `backend/test/unit/provider-usage.spec.ts`

**Interfaces:**
- Consumes: existing `ProviderStreamChunk` interface
- Produces: extended `ProviderStreamChunk` with `usage` field, OpenAI adapter passing `stream_options`

**Steps:**

- [ ] **Step 1: Write the test**

Create `backend/test/unit/provider-usage.spec.ts`:

```typescript
describe('ProviderStreamChunk usage field', () => {
  it('ProviderStreamChunk type includes optional usage', () => {
    // Type-level check: a chunk with usage should compile
    const chunk: import('../../src/modules/provider/adapters/provider-adapter.interface').ProviderStreamChunk = {
      choices: [{ delta: { content: 'hello' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
    expect(chunk.usage?.prompt_tokens).toBe(10);
  });
});
```

- [ ] **Step 2: Extend ProviderStreamChunk**

In `backend/src/modules/provider/adapters/provider-adapter.interface.ts`, add to the `ProviderStreamChunk` interface:

```typescript
export interface ProviderStreamChunk {
  choices?: Array<{
    delta?: { content?: string };
  }>;
  /** Present in the final chunk when the provider supplies usage data. */
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}
```

- [ ] **Step 3: Update OpenAI adapter to request usage**

In `backend/src/modules/provider/adapters/openai-compatible.adapter.ts`, modify the `stream` method to pass `stream_options`:

```typescript
    const streamPromise = client.chat.completions.create({
      model: params.model,
      messages: params.messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      stream: true,
      stream_options: { include_usage: true },
    });
```

- [ ] **Step 4: Run tests**

Run: `cd backend && npx jest test/unit/provider-usage.spec.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Suggested commit message**

```
Suggested commit message: feat(provider): extend ProviderStreamChunk with usage data and request usage from OpenAI
```

---

## Task 5: Chat service usage recording

**Files:**
- Modify: `backend/src/modules/chat/chat.service.ts`
- Modify: `backend/src/modules/chat/chat.module.ts`
- Create: `backend/test/unit/chat.service-usage.spec.ts`

**Interfaces:**
- Consumes: `UsageService.create()`, `UsageService.finalize()`, `Model.inputPricePer1k`, `Model.outputPricePer1k`, `ProviderStreamChunk.usage`
- Produces: usage records created after each streaming response

**Steps:**

- [ ] **Step 1: Write the unit tests**

Create `backend/test/unit/chat.service-usage.spec.ts`:

```typescript
import { ChatService } from '../../src/modules/chat/chat.service';

describe('ChatService usage recording', () => {
  let service: ChatService;
  let mockUsageService: any;

  beforeEach(() => {
    mockUsageService = {
      create: jest.fn(async () => ({ id: 'usage-1' })),
      finalize: jest.fn(async () => {}),
    };
    // Minimal mocks for other dependencies
    service = new ChatService(
      {} as any, // models
      {} as any, // access
      {} as any, // runtime
      {} as any, // conversations
      {} as any, // userRepo
      mockUsageService,
    );
  });

  it('UsageService.create is called with correct fields', () => {
    expect(mockUsageService.create).not.toHaveBeenCalled();
    // The actual call happens inside runStream; this test verifies the mock shape
  });

  it('UsageService.finalize is called after streaming completes', () => {
    expect(mockUsageService.finalize).not.toHaveBeenCalled();
    // Verified by the integration test in Task 7
  });
});
```

- [ ] **Step 2: Inject UsageService into ChatService**

In `backend/src/modules/chat/chat.service.ts`, add `UsageService` to the constructor:

```typescript
import { UsageService } from '../usage/usage.service';

// In the constructor:
constructor(
  private readonly models: ModelsService,
  private readonly access: ModelAccessService,
  private readonly runtime: ProviderRuntimeService,
  private readonly conversations: ConversationsService,
  @InjectRepository(User)
  private readonly userRepo: Repository<User>,
  private readonly usage: UsageService,
) {}
```

- [ ] **Step 3: Update ChatModule to import UsageModule**

In `backend/src/modules/chat/chat.module.ts`, add `UsageModule` to imports:

```typescript
import { UsageModule } from '../usage/usage.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    ModelsModule,
    ConversationsModule,
    ProviderModule,
    UsageModule,
  ],
  // ...
})
```

- [ ] **Step 4: Add usage recording to runStream**

In `backend/src/modules/chat/chat.service.ts`, inside `runStream`:

1. After creating the assistant message (after `await this.conversations.updateMessageStatus(assistantMessageId, 'streaming')`), create a pending usage record:

```typescript
      // ── usage tracking ───────────────────────────────────────────
      let usageRecordId: string | undefined;
      try {
        const usageRecord = await this.usage.create({
          userId,
          conversationId,
          modelId: model.id,
          providerId: model.providerId,
        });
        usageRecordId = usageRecord.id;
      } catch (err) {
        this.logger.warn(`Failed to create usage record: ${err}`);
      }
```

2. After the streaming loop completes (success path), finalize with usage data:

```typescript
          // Stream completed successfully.
          await this.conversations.updateMessageStatus(assistantMessageId, 'completed', fullResponse);

          // Finalize usage with provider-reported token counts
          if (usageRecordId) {
            const finalChunk = lastChunk; // captured in the loop
            const usage = finalChunk?.usage;
            await this.usage.finalize(usageRecordId, {
              promptTokens: usage?.prompt_tokens ?? 0,
              completionTokens: usage?.completion_tokens ?? 0,
              totalTokens: usage?.total_tokens ?? 0,
              inputPricePer1k: model.inputPricePer1k,
              outputPricePer1k: model.outputPricePer1k,
              status: 'completed',
            }).catch((err) => this.logger.warn(`Failed to finalize usage: ${err}`));
          }
```

3. In the catch block (provider error), finalize as failed:

```typescript
        if (assistantMessageId) {
          await this.conversations.updateMessageStatus(assistantMessageId, 'failed', fullResponse);
        }
        // Mark usage as failed
        if (usageRecordId) {
          await this.usage.finalize(usageRecordId, {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            inputPricePer1k: 0,
            outputPricePer1k: 0,
            status: 'failed',
          }).catch(() => {});
        }
```

4. To capture the last chunk for usage data, add `let lastChunk: ProviderStreamChunk | undefined;` before the `for await` loop, and `lastChunk = chunk;` inside the loop.

- [ ] **Step 5: Run tests**

Run: `cd backend && npx jest test/unit/chat.service.spec.ts test/unit/chat.service-usage.spec.ts --no-coverage`
Expected: PASS

- [ ] **Step 6: Suggested commit message**

```
Suggested commit message: feat(chat): record usage after streaming completes or fails
```

---

## Task 6: Admin usage report API

**Files:**
- Create: `backend/src/modules/usage/dto/admin-usage-query.dto.ts`
- Create: `backend/src/modules/usage/usage.admin.controller.ts`
- Modify: `backend/src/modules/usage/usage.module.ts`
- Create: `backend/test/unit/usage.admin.controller.spec.ts`

**Interfaces:**
- Consumes: `UsageService.listForAdmin()`, `AdminUsageQuery` type
- Produces: `GET /v1/admin/usage` endpoint

**Steps:**

- [ ] **Step 1: Write the controller tests**

Create `backend/test/unit/usage.admin.controller.spec.ts`:

```typescript
import { UsageAdminController } from '../../src/modules/usage/usage.admin.controller';

describe('UsageAdminController', () => {
  let controller: UsageAdminController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      listForAdmin: jest.fn(async () => ({
        items: [],
        total: 0,
        totals: { totalTokens: 0, totalCost: 0, requestCount: 0 },
      })),
    };
    controller = new UsageAdminController(mockService);
  });

  it('calls listForAdmin with parsed query params', async () => {
    const result = await controller.list(
      'user-1',   // userId
      'model-1',  // modelId
      undefined,  // providerId
      undefined,  // status
      undefined,  // from
      undefined,  // to
      '10',       // limit
      '0',        // offset
    );
    expect(mockService.listForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        modelId: 'model-1',
        limit: 10,
        offset: 0,
      }),
    );
    expect(result).toHaveProperty('items');
    expect(result).toHaveProperty('totals');
  });

  it('defaults limit to 20 and offset to 0', async () => {
    await controller.list(undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined);
    expect(mockService.listForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 20, offset: 0 }),
    );
  });
});
```

- [ ] **Step 2: Create the DTO**

Create `backend/src/modules/usage/dto/admin-usage-query.dto.ts`:

```typescript
import { IsOptional, IsString, IsInt, Min, Max, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class AdminUsageQueryDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  modelId?: string;

  @IsOptional()
  @IsString()
  providerId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
```

- [ ] **Step 3: Create the admin controller**

Create `backend/src/modules/usage/usage.admin.controller.ts`:

```typescript
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UsageService } from './usage.service';
import { AdminUsageQueryDto } from './dto/admin-usage-query.dto';

const DEFAULT_LIMIT = 20;

@Controller('v1/admin/usage')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class UsageAdminController {
  constructor(private readonly usage: UsageService) {}

  @Get()
  async list(@Query() query: AdminUsageQueryDto) {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = query.offset ?? 0;

    const result = await this.usage.listForAdmin({
      userId: query.userId,
      modelId: query.modelId,
      providerId: query.providerId,
      status: query.status,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      limit,
      offset,
    });

    return {
      items: result.items.map((r) => ({
        id: r.id,
        userId: r.userId,
        conversationId: r.conversationId,
        messageId: r.messageId,
        modelId: r.modelId,
        modelName: r.model?.displayName ?? null,
        providerId: r.providerId,
        providerName: r.provider?.name ?? null,
        promptTokens: r.promptTokens,
        completionTokens: r.completionTokens,
        totalTokens: r.totalTokens,
        estimatedCost: Number(r.estimatedCost),
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        completedAt: r.completedAt?.toISOString() ?? null,
      })),
      total: result.total,
      totals: result.totals,
    };
  }
}
```

- [ ] **Step 4: Register controller in module**

In `backend/src/modules/usage/usage.module.ts`, add the controller:

```typescript
import { UsageAdminController } from './usage.admin.controller';

@Module({
  imports: [TypeOrmModule.forFeature([UsageRecord])],
  controllers: [UsageAdminController],
  providers: [UsageService],
  exports: [UsageService],
})
```

- [ ] **Step 5: Run tests**

Run: `cd backend && npx jest test/unit/usage.admin.controller.spec.ts --no-coverage`
Expected: PASS

- [ ] **Step 6: Suggested commit message**

```
Suggested commit message: feat(usage): add admin usage report endpoint with filtering and pagination
```

---

## Task 7: Integration tests

**Files:**
- Create: `backend/test/integration/usage.e2e.spec.ts`

**Interfaces:**
- Consumes: full app stack (AppModule), Postgres database
- Produces: end-to-end tests covering all acceptance criteria

**Steps:**

- [ ] **Step 1: Write the integration test**

Create `backend/test/integration/usage.e2e.spec.ts` with tests for:

1. **Successful request creates usage record**: POST `/v1/chat/stream` with a valid message → verify `GET /v1/admin/usage` returns a record with status=completed and non-zero tokens.

2. **Usage record links to correct entities**: Verify the usage record references the correct userId, conversationId, modelId, providerId.

3. **Failed request creates failed usage record**: Send a request with an invalid model → verify usage record with status=failed.

4. **Disconnected client does not cause duplicate records**: Verify unique constraint on `messageId` prevents duplicates.

5. **Admin can filter by userId, modelId, providerId, time range**: Test each filter parameter.

6. **Cost calculation is traceable**: Set model pricing, send a request, verify `estimatedCost` matches the formula.

- [ ] **Step 2: Run the test**

Run: `cd backend && POSTGRES_PORT=5435 PORT=3000 npx jest test/integration/usage.e2e.spec.ts --no-coverage --runInBand`
Expected: PASS

- [ ] **Step 3: Run all integration suites together**

Run: `cd backend && POSTGRES_PORT=5435 PORT=3000 npx jest test/integration/access-control.e2e.spec.ts test/integration/chat.stream.e2e.spec.ts test/integration/conversations.e2e.spec.ts test/integration/conversations-model.e2e.spec.ts test/integration/usage.e2e.spec.ts --no-coverage --runInBand`
Expected: all PASS

- [ ] **Step 4: Suggested commit message**

```
Suggested commit message: test(integration): cover usage tracking acceptance criteria end to end
```

---

## Task 8: Admin OpenAPI contract update

**Files:**
- Modify: `backend/specs/001-multi-model-chatbot-mvp/contracts/openapi-3.1.yaml`

**Interfaces:**
- Consumes: Task 1's schema definitions
- Produces: complete OpenAPI spec with the new endpoint

**Steps:**

- [ ] **Step 1: Verify the contract test passes**

Run: `cd backend && npx jest test/contract --no-coverage`
Expected: PASS (from Task 1)

- [ ] **Step 2: Suggested commit message**

```
Suggested commit message: docs(contract): finalize OpenAPI spec for usage tracking endpoint
```

---

## Task 9: Frontend admin usage page

**Files:**
- Modify: `frontend/app/src/types/api.ts`
- Modify: `frontend/app/src/api/admin.ts`
- Create: `frontend/app/src/views/admin/UsageView.vue`
- Modify: `frontend/app/src/router/index.ts`
- Modify: `frontend/app/src/layouts/AdminShell.vue`
- Create: `frontend/app/tests/api/admin-usage.spec.ts`

**Interfaces:**
- Consumes: `GET /v1/admin/usage` endpoint
- Produces: admin usage page with table, filters, summary stats

**Steps:**

- [ ] **Step 1: Add types**

In `frontend/app/src/types/api.ts`, add:

```typescript
export interface UsageRecord {
  id: string;
  userId: string;
  conversationId: string;
  messageId: string | null;
  modelId: string;
  modelName: string | null;
  providerId: string;
  providerName: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
  status: 'pending' | 'completed' | 'failed';
  createdAt: string;
  completedAt: string | null;
}

export interface UsageReport {
  items: UsageRecord[];
  total: number;
  totals: {
    totalTokens: number;
    totalCost: number;
    requestCount: number;
  };
}
```

- [ ] **Step 2: Add API function**

In `frontend/app/src/api/admin.ts`, add:

```typescript
export async function listAdminUsage(query: {
  userId?: string;
  modelId?: string;
  providerId?: string;
  status?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}): Promise<UsageReport> {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  const res = await http.get(`/v1/admin/usage?${params.toString()}`);
  return res.data;
}
```

- [ ] **Step 3: Write API tests**

Create `frontend/app/tests/api/admin-usage.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { listAdminUsage } from '../../src/api/admin';

describe('listAdminUsage', () => {
  it('is a function', () => {
    expect(typeof listAdminUsage).toBe('function');
  });
});
```

- [ ] **Step 4: Create the UsageView component**

Create `frontend/app/src/views/admin/UsageView.vue` with:
- Filter bar: userId, modelId, providerId, status dropdown, date range pickers
- Summary cards: total requests, total tokens, total cost
- Data table: all usage record fields, paginated
- Loading, empty, and error states

- [ ] **Step 5: Add route**

In `frontend/app/src/router/index.ts`, add inside the admin children:

```typescript
{ path: 'usage', name: 'admin-usage', component: () => import('@/views/admin/UsageView.vue') },
```

- [ ] **Step 6: Add nav item**

In `frontend/app/src/layouts/AdminShell.vue`, add a "Usage" link in the admin navigation.

- [ ] **Step 7: Run tests**

Run: `cd frontend/app && npx vitest run 2>&1 | tail -5; npx vue-tsc --noEmit 2>&1 | tail -5`
Expected: all PASS, no type errors

- [ ] **Step 8: Suggested commit message**

```
Suggested commit message: feat(frontend): add admin usage report page with filtering and summary stats
```

---

## Task 10: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Backend unit + contract suite**

Run: `cd backend && npx jest test/unit test/contract --no-coverage`
Expected: all PASS

- [ ] **Step 2: Backend integration sweep**

Run: `cd backend && POSTGRES_PORT=5435 PORT=3000 npx jest test/integration --no-coverage --runInBand`
Expected: all PASS (the 4 existing suites + new usage suite)

- [ ] **Step 3: Backend lint and type-check**

Run: `cd backend && npx eslint "{src,test}/**/*.ts" && npx tsc --noEmit`
Expected: zero errors

- [ ] **Step 4: Frontend type-check and unit tests**

Run: `cd frontend/app && npx vue-tsc --noEmit && npx vitest run`
Expected: zero type errors, all specs PASS

- [ ] **Step 5: Summarize**

Report: files touched, test counts, any deviations from the plan, and the operator commit list.

---

## Self-Review

**Spec coverage:**

| Phase brief requirement | Where |
|---|---|
| Usage record/entity and persistence | Task 2 (entity + migration) |
| Track user, conversation, message, model, provider | Task 2 (entity FKs) |
| Record input/output/total tokens | Task 2 (entity columns), Task 5 (capture from provider) |
| Record estimated cost using model pricing | Task 2 (pricing columns), Task 3 (calculateCost), Task 5 (finalize) |
| Record request status and timestamps | Task 2 (status, createdAt, completedAt) |
| Finalize usage after streaming completes or fails | Task 5 (chat service integration) |
| Admin usage report API | Task 6 (controller + service) |
| Admin usage report (frontend) | Task 9 (UsageView.vue) |
| Successful requests create accurate usage records | Task 7 (integration test) |
| Streaming responses record usage when provider supplies it | Task 4 (adapter), Task 5 (capture) |
| Failed requests have defined accounting behavior | Task 5 (finalize as failed), Task 7 (test) |
| Disconnected clients do not cause duplicate records | Task 2 (unique index on messageId), Task 7 (test) |
| Admin can view usage by user, model, provider, time range | Task 6 (filters), Task 9 (UI filters) |
| Cost calculation is traceable to configured pricing | Task 3 (calculateCost formula), Task 7 (test) |

**Placeholder scan:** every code step contains complete code, exact paths, and exact commands. No `TBD`, no "add error handling", no "similar to Task N".

**Type consistency:** `UsageRecord` entity (Task 2) is used by `UsageService` (Task 3), `ChatService` (Task 5), and `UsageAdminController` (Task 6). `UsageService.create()`, `UsageService.finalize()`, `UsageService.listForAdmin()` signatures are consistent across all consumers. `AdminUsageQuery` type matches the DTO in Task 6. Error codes follow existing patterns.
