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

  const outDir = join(process.cwd(), 'contracts');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'openapi.yaml');
  writeFileSync(outPath, YAML.stringify(document), 'utf8');

  // eslint-disable-next-line no-console
  console.log(`[openapi:export] wrote ${outPath}`);
  // eslint-disable-next-line no-console
  console.log(`[openapi:export] ${document.paths ? Object.keys(document.paths).length : 0} paths exported`);

  await app.close();
}

void main();
