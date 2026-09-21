import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import { join } from 'path';
import { config as loadDotenv } from 'dotenv';
import { User } from '../modules/users/entities/user.entity';
import { RefreshToken } from '../modules/auth/entities/refresh-token.entity';
import { CentralProvider } from '../modules/provider/entities/central-provider.entity';
import { Provider } from '../modules/provider/entities/provider.entity';
import { ProviderApiKey } from '../modules/provider/entities/provider-api-key.entity';
import { Model } from '../modules/models/entities/model.entity';
import { AppConfig } from '../modules/app-config/entities/app-config.entity';
import { Conversation } from '../modules/conversations/entities/conversation.entity';
import { Message } from '../modules/conversations/entities/message.entity';
import { Wallet } from '../modules/wallet/entities/wallet.entity';
import { Payment } from '../modules/payments/entities/payment.entity';
import { CreditPurchase } from '../modules/payments/entities/credit-purchase.entity';
import { FileRecord } from '../modules/files/entities/file.entity';

// Load .env if present so CLI scripts (migration:run etc.) see the same
// environment variables as the running app.
loadDotenv({ path: join(process.cwd(), '.env') });

function buildPostgresUrl(): string {
  if (process.env.POSTGRES_URL) {
    return process.env.POSTGRES_URL;
  }
  const host = process.env.POSTGRES_HOST ?? 'localhost';
  const port = process.env.POSTGRES_PORT ?? '5432';
  const user = process.env.POSTGRES_USER ?? 'postgres';
  const password = encodeURIComponent(process.env.POSTGRES_PASSWORD ?? '');
  const db = process.env.POSTGRES_DB ?? 'chatbot_db';
  return `postgres://${user}:${password}@${host}:${port}/${db}`;
}

const driver = process.env.DB_DRIVER ?? 'postgres';

const entities = [
  User,
  RefreshToken,
  CentralProvider,
  Provider,
  ProviderApiKey,
  Model,
  AppConfig,
  Conversation,
  Message,
  Wallet,
  Payment,
  CreditPurchase,
  FileRecord,
];

export const dataSourceOptions: DataSourceOptions =
  driver === 'postgres'
    ? {
        type: 'postgres',
        url: buildPostgresUrl(),
        entities,
        migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
        synchronize: false,
        logging: process.env.NODE_ENV === 'development',
      }
    : {
        type: 'sqlite',
        database: process.env.SQLITE_FILE ?? './data/app.sqlite',
        entities,
        migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
        synchronize: false,
        logging: process.env.NODE_ENV === 'development',
      };

export default new DataSource(dataSourceOptions);