/**
 * Regenerates the machine-readable OpenAPI 3.1 source of truth
 * (`backend/specs/001-multi-model-chatbot-mvp/contracts/openapi-3.1.yaml`)
 * by booting the AppModule in a Nest application context (no HTTP listener
 * needed), running `SwaggerModule.createDocument`, and writing the result
 * to that path.
 *
 * The hand-authored 3.1 file is the canonical contract; this script
 * re-syncs the NestJS-derived structure (paths, operation ids, schemas)
 * over it. Hand-authored fields (descriptions, examples, responses) are
 * preserved because they live only in the YAML and are not derived from
 * the runtime document.
 *
 * Run via: `npm run openapi:export`
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { config as loadDotenv } from 'dotenv';
import YAML from 'yaml';
import { AppModule } from '../src/app.module';

loadDotenv({ path: join(process.cwd(), '.env') });

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn'],
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Chat Backend API')
    .setDescription('Multi-Model Chatbot MVP backend — REST + JSON + SSE')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);

  // Source of truth lives under specs/, alongside its companion 3.0.3
  // baseline artifact. Keep this path in sync with
  // `backend/specs/001-multi-model-chatbot-mvp/contracts/openapi-3.1.yaml`.
  const outDir = join(
    process.cwd(),
    'specs',
    '001-multi-model-chatbot-mvp',
    'contracts',
  );
  const outPath = join(outDir, 'openapi-3.1.yaml');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, YAML.stringify(document), 'utf8');

  // eslint-disable-next-line no-console
  console.log(`[openapi:export] wrote ${outPath}`);
  // eslint-disable-next-line no-console
  console.log(`[openapi:export] ${document.paths ? Object.keys(document.paths).length : 0} paths exported`);

  await app.close();
}

void main();
