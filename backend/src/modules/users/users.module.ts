import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { UsersAdminController } from './users.admin.controller';
import { ModelsModule } from '../models/models.module';

@Module({
  imports: [TypeOrmModule.forFeature([User]), ModelsModule],
  controllers: [UsersController, UsersAdminController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}