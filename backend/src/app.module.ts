import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

/**
 * Root application module for Phase 1 (T001) — carries only the config
 * loader. Phase 2 (T002) wires in TypeORM, the auth/users/chat/etc.
 * modules, the global filter and logger interceptor, the JWT guard
 * scaffold, and the OpenAPI bootstrap.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env'],
    }),
  ],
})
export class AppModule {}
