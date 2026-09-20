import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { FakeZibalModule } from './fake-zibal.module';

/**
 * Standalone bootstrap: `node dist/fake-zibal/fake-zibal.main.js`.
 *
 * Runs as its own process so a developer (or a docker-compose service) can
 * point the backend at it via `ZIBAL_BASE_URL=http://127.0.0.1:3010`.
 */
async function bootstrap(): Promise<void> {
  const port = Number(process.env.FAKE_ZIBAL_PORT ?? 3010);

  const app = await NestFactory.create(FakeZibalModule, {
    logger: ['error', 'warn', 'log'],
  });
  // The payment page posts classic form-encoded bodies.
  app.use(json());
  app.use(urlencoded({ extended: true }));

  await app.listen(port, '127.0.0.1');
  // eslint-disable-next-line no-console
  console.log(`Fake Zibal listening on http://127.0.0.1:${port}`);
}

void bootstrap();
