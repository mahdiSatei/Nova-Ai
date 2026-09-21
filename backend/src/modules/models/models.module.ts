import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Model } from './entities/model.entity';
import { Provider } from '../provider/entities/provider.entity';
import { User } from '../users/entities/user.entity';
import { ModelAccessService } from './model-access.service';
import { ModelsService } from './models.service';
import { ModelsPublicController } from './models.public.controller';
import { ModelsAdminController } from './models.admin.controller';
import { ProviderAdaptersModule } from '../provider/adapters/provider-adapters.module';
import { ReasoningCapabilityService } from './reasoning-capability.service';

@Module({
  imports: [TypeOrmModule.forFeature([Model, Provider, User]), ProviderAdaptersModule],
  controllers: [ModelsPublicController, ModelsAdminController],
  providers: [ModelsService, ModelAccessService, ReasoningCapabilityService],
  exports: [ModelsService, ModelAccessService, ReasoningCapabilityService],
})
export class ModelsModule {}
