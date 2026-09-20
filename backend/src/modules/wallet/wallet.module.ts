import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Wallet } from './entities/wallet.entity';
import { WalletService } from './wallet.service';

@Module({
  imports: [TypeOrmModule.forFeature([Wallet])],
  providers: [WalletService],
  // Only services are exported: `TypeOrmModule.forFeature` does not register the
  // entity class as a provider, so listing `Wallet` here would fail module init.
  exports: [WalletService],
})
export class WalletModule {}
