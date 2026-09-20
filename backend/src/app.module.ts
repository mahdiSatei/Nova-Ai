import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, type TypeOrmModuleOptions } from '@nestjs/typeorm';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { LoggerModule } from 'nestjs-pino';
const migrationsGlob = join(__dirname, 'database', 'migrations', '*.{ts,js}');
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { RequestIdInterceptor } from './common/interceptors/logging.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import configuration, { AppConfig } from './config/configuration';
import { validateEnv } from './config/env.validation';
import { User } from './modules/users/entities/user.entity';
import { RefreshToken } from './modules/auth/entities/refresh-token.entity';
import { CentralProvider } from './modules/provider/entities/central-provider.entity';
import { Model } from './modules/models/entities/model.entity';
import { AppConfig as AppConfigEntity } from './modules/app-config/entities/app-config.entity';
import { Conversation } from './modules/conversations/entities/conversation.entity';
import { Message } from './modules/conversations/entities/message.entity';
import { FileRecord } from './modules/files/entities/file.entity';
import { Wallet } from './modules/wallet/entities/wallet.entity';
import { ChatModule } from './modules/chat/chat.module';
import { FilesModule } from './modules/files/files.module';
import { ModelsModule } from './modules/models/models.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { HealthModule } from './modules/health/health.module';
import { ProviderModule } from './modules/provider/provider.module';
import { AppConfigModule } from './modules/app-config/app-config.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { BillingModule } from './modules/billing/billing.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { SharingModule } from './modules/sharing/sharing.module';
import { AuditModule } from './modules/audit/audit.module';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validate: validateEnv,
      envFilePath: ['.env'],
    }),
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const level = config.get('log.level', { infer: true });
        const dir = config.get('log.dir', { infer: true });
        try {
          mkdirSync(dir, { recursive: true });
        } catch {
          /* dev fallback to stdout-only */
        }
        return {
          pinoHttp: {
            level,
            transport: {
              targets: [
                {
                  target: 'pino-roll',
                  options: {
                    file: join(dir, 'app'),
                    frequency: 'daily',
                    mkdir: true,
                    dateFormat: 'yyyy-MM-dd',
                    extension: '.jsonl',
                  },
                  level,
                },
              ],
            },
            customProps: () => ({ context: 'HTTP' }),
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.body.password',
                'req.body.apiKey',
                'req.body.api_key',
                'res.body.apiKey',
                'res.body.api_key',
                'res.body.centralProvider.apiKeyEncrypted',
              ],
              censor: '[REDACTED]',
            },
          },
        };
      },
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>): TypeOrmModuleOptions => {
        const pg = config.get('db.postgres', { infer: true });
        const url =
          config.get('db.postgresUrl', { infer: true }) ||
          `postgres://${encodeURIComponent(pg.user)}:${encodeURIComponent(pg.password)}@${pg.host}:${pg.port}/${pg.db}`;
        return {
          type: 'postgres',
          url,
          autoLoadEntities: true,
          synchronize: false,
          migrations: [migrationsGlob],
          migrationsRun: false,
        };
      },
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const redis = config.get('redis', { infer: true });
        return { connection: { host: redis.host, port: redis.port } };
      },
    }),
    TypeOrmModule.forFeature([
      User,
      RefreshToken,
      CentralProvider,
      Model,
      AppConfigEntity,
      Conversation,
      Message,
      FileRecord,
      Wallet,
    ]),
    ChatModule,
    FilesModule,
    ModelsModule,
    AuthModule,
    UsersModule,
    HealthModule,
    ProviderModule,
    AppConfigModule,
    WalletModule,
    BillingModule,
    PaymentsModule,
    SharingModule,
    AuditModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: RequestIdInterceptor },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
