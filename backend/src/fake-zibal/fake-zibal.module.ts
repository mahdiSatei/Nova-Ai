import { Module } from '@nestjs/common';
import { FakeZibalController } from './fake-zibal.controller';
import { FakeZibalAdminController, FakeZibalResetController } from './fake-zibal.admin.controller';
import { FakeZibalStore } from './fake-zibal.store';

/**
 * The fake needs no configuration of its own: it answers `/v1/request` with a
 * `trackId`, and every redirect is built from the `callbackUrl` the backend
 * actually sent with that transaction.
 */
@Module({
  controllers: [FakeZibalController, FakeZibalAdminController, FakeZibalResetController],
  providers: [FakeZibalStore],
  exports: [FakeZibalStore],
})
export class FakeZibalModule {}
