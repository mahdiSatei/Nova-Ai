import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Quota } from './entities/quota.entity';
import { QuotaRule } from './entities/quota-rule.entity';
import { QuotaService } from './quotas.service';
import { QuotasAdminController } from './quotas.admin.controller';
import { QuotasUserController } from './quotas.user.controller';
import { User } from '../users/entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Quota, QuotaRule, User])],
  controllers: [QuotasAdminController, QuotasUserController],
  providers: [QuotaService],
  exports: [QuotaService],
})
export class QuotasModule {}
