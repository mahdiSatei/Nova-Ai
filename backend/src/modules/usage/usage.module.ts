import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsageRecord } from './entities/usage-record.entity';
import { UsageService } from './usage.service';
import { UsageAdminController } from './usage.admin.controller';

@Module({
  imports: [TypeOrmModule.forFeature([UsageRecord])],
  controllers: [UsageAdminController],
  providers: [UsageService],
  exports: [UsageService],
})
export class UsageModule {}
