import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger as NestLogger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';
import { mkdirSync } from 'fs';
import { join } from 'path';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  // Use nestjs-pino for structured logging. Bootstrap happens before
  // ConfigModule is fully wired for logging, so we read directly.
  const logDir = process.env.LOG_DIR ?? './logs';
  const logLevel = process.env.LOG_LEVEL ?? 'info';
  try {
    mkdirSync(logDir, { recursive: true });
  } catch {
    /* ignore — dev fallback to stdout */
  }
  app.useLogger(
    app.get(PinoLogger) ??
      new NestLogger(),
  );

  app.use(helmet());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  // Swagger / OpenAPI at /api/docs (read-only contract surface).
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Chat Backend API')
    .setDescription('Multi-Model Chatbot MVP backend — REST + JSON + SSE')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);

  // Best-effort log of boot state (the pino logger is already active).
  // eslint-disable-next-line no-console
  console.log(`[boot] listening on http://localhost:${port} (log level=${logLevel}, log dir=${logDir})`);
}

void bootstrap();
