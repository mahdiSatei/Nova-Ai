import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CreditPurchase } from './entities/credit-purchase.entity';
import { Payment } from './entities/payment.entity';
import { FakeZibalProvider } from './providers/fake-zibal.provider';
import { PAYMENT_PROVIDER } from './payment-provider.interface';
import { PaymentsAdminController } from './payments.admin.controller';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [TypeOrmModule.forFeature([Payment, CreditPurchase]), WalletModule],
  controllers: [PaymentsController, PaymentsAdminController],
  providers: [
    PaymentsService,
    // The Zibal adapter is bound directly: the base URL decides whether it talks
    // to the bundled fake or to production, so there is nothing to switch on.
    { provide: PAYMENT_PROVIDER, useClass: FakeZibalProvider },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
