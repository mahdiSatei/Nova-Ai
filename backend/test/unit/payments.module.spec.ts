import { ConfigModule } from '@nestjs/config';
import { Global, Module } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import configuration from '../../src/config/configuration';
import { PaymentsModule } from '../../src/modules/payments/payments.module';
import { PaymentsService } from '../../src/modules/payments/payments.service';
import { PaymentsController } from '../../src/modules/payments/payments.controller';
import { PaymentsAdminController } from '../../src/modules/payments/payments.admin.controller';
import { PAYMENT_PROVIDER } from '../../src/modules/payments/payment-provider.interface';
import { FakeZibalProvider } from '../../src/modules/payments/providers/fake-zibal.provider';
import { Payment } from '../../src/modules/payments/entities/payment.entity';
import { CreditPurchase } from '../../src/modules/payments/entities/credit-purchase.entity';
import { Wallet } from '../../src/modules/wallet/entities/wallet.entity';

/**
 * Verifies that `PaymentsModule` actually resolves.
 *
 * Booting the whole app needs PostgreSQL, so a mistake here (a missing module
 * export, an unbound token) would otherwise only surface on a real start-up —
 * which is precisely how the Phase 5 plan's `exports: [WalletService, Wallet]`
 * was caught before shipping. The repositories are stubbed, so no connection is
 * needed while the wiring itself is real.
 */
const fakeRepo = {
  findOne: jest.fn(),
  findAndCount: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  query: jest.fn(),
};

// `PaymentsService` opens the finalization transaction through this handle.
const fakeDataSource = {
  options: {},
  getRepository: jest.fn(() => fakeRepo),
  transaction: jest.fn(),
};

/**
 * Stands in for the global `TypeOrmCoreModule` that `TypeOrmModule.forRoot()`
 * installs in the real app. It has to be global for the same reason: a module
 * that only registered it locally would not be visible from `PaymentsModule`.
 */
@Global()
@Module({
  providers: [{ provide: getDataSourceToken(), useValue: fakeDataSource }],
  exports: [getDataSourceToken()],
})
class TestDataSourceModule {}

const build = async () => {
  const builder: TestingModuleBuilder = Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      TestDataSourceModule,
      PaymentsModule,
    ],
  });

  for (const entity of [Payment, CreditPurchase, Wallet]) {
    builder.overrideProvider(getRepositoryToken(entity)).useValue(fakeRepo);
  }

  return builder.compile();
};

describe('PaymentsModule wiring', () => {
  it('resolves its service, controllers and provider binding', async () => {
    const moduleRef = await build();

    expect(moduleRef.get(PaymentsService)).toBeInstanceOf(PaymentsService);
    expect(moduleRef.get(PaymentsController)).toBeInstanceOf(PaymentsController);
    expect(moduleRef.get(PaymentsAdminController)).toBeInstanceOf(PaymentsAdminController);
    expect(moduleRef.get(PAYMENT_PROVIDER)).toBeInstanceOf(FakeZibalProvider);

    await moduleRef.close();
  });

  it('binds the provider at construction time, not per request', async () => {
    const moduleRef = await build();

    const first = moduleRef.get(PAYMENT_PROVIDER);
    const second = moduleRef.get(PAYMENT_PROVIDER);

    expect(first).toBe(second);
    await moduleRef.close();
  });
});
