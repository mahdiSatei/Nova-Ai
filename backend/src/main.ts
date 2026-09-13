import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';

/**
 * NestJS bootstrap. Phase 1 keeps this minimal — full cross-cutting
 * concerns (sanitized AllExceptionsFilter, request-id correlation,
 * Pino logger middleware, OpenAPI export) are wired in during Phase 2
 * (Foundational, T002) per plan.md §Architecture.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Security headers
  app.use(helmet());

  // Global validation pipe (strict whitelist; per Constitution §Security & Compliance)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
