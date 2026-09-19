import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Model } from '../models/entities/model.entity';
import { WalletModule } from '../wallet/wallet.module';
import { BillingAdminController } from './billing.admin.controller';
import { PricingService } from './pricing.service';
import { UsagePricingService } from './usage-pricing.service';

@Module({
  imports: [WalletModule, TypeOrmModule.forFeature([Model])],
  controllers: [BillingAdminController],
  providers: [PricingService, UsagePricingService],
  // WalletModule is re-exported so consumers (chat, future purchase flows) get
  // WalletService + the billing services from a single import.
  exports: [PricingService, UsagePricingService, WalletModule],
})
export class BillingModule {}
