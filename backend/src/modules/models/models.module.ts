import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Model } from './entities/model.entity';
import { ModelsService } from './models.service';
import { ModelsPublicController } from './models.public.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Model])],
  controllers: [ModelsPublicController],
  providers: [ModelsService],
  exports: [ModelsService],
})
export class ModelsModule {}
