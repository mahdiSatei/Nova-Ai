import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Model } from './entities/model.entity';
import { Provider } from '../provider/entities/provider.entity';
import { User } from '../users/entities/user.entity';
import { ModelAccessService } from './model-access.service';
import { ModelsService } from './models.service';
import { ModelsPublicController } from './models.public.controller';
import { ModelsAdminController } from './models.admin.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Model, Provider, User])],
  controllers: [ModelsPublicController, ModelsAdminController],
  providers: [ModelsService, ModelAccessService],
  exports: [ModelsService, ModelAccessService],
})
export class ModelsModule {}
