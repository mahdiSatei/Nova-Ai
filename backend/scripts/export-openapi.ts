/**
 * Generates the OpenAPI document by booting the AppModule in a Nest
 * application context (no HTTP listener needed), running
 * `SwaggerModule.createDocument`, and writing the result to
 * `backend/contracts/openapi.yaml`.
 *
 * Run via: `npm run openapi:export`
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { config as loadDotenv } from 'dotenv';
import { AppModule } from '../src/app.module';

loadDotenv({ path: join(process.cwd(), '.env') });

async function main(): Promise<void> {
  // Use a Nest application context (no HTTP server) — SwaggerModule
  // works without `listen()`.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Chat Backend API')
    .setDescription('Multi-Model Chatbot MVP backend — REST + JSON + SSE')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);

  // Write a JSON document (YAML conversion is left to other tooling
  // since the contracts/ directory is the canonical source of truth).
  const outDir = join(process.cwd(), 'contracts');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'openapi.generated.json');
  writeFileSync(outPath, JSON.stringify(document, null, 2), 'utf8');

  // eslint-disable-next-line no-console
  console.log(`[openapi:export] wrote ${outPath}`);
  // eslint-disable-next-line no-console
  console.log(`[openapi:export] ${document.paths ? Object.keys(document.paths).length : 0} paths exported`);

  await app.close();
}

void main();
