import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import { join } from 'path';
import { config as loadDotenv } from 'dotenv';
import { User } from '../modules/users/entities/user.entity';
import { RefreshToken } from '../modules/auth/entities/refresh-token.entity';
import { CentralProvider } from '../modules/provider/entities/central-provider.entity';
import { Model } from '../modules/models/entities/model.entity';
import { AppConfig } from '../modules/app-config/entities/app-config.entity';
import { Conversation } from '../modules/conversations/entities/conversation.entity';
import { Message } from '../modules/conversations/entities/message.entity';

// Load .env if present so CLI scripts (migration:run etc.) see the same
// environment variables as the running app.
loadDotenv({ path: join(process.cwd(), '.env') });

const driver = (process.env.DB_DRIVER ?? 'sqlite') as 'sqlite' | 'postgres';

export const dataSourceOptions: DataSourceOptions =
  driver === 'postgres'
    ? {
        type: 'postgres',
        url: process.env.POSTGRES_URL,
        entities: [User, RefreshToken, CentralProvider, Model, AppConfig, Conversation, Message],
        migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
        synchronize: false,
        logging: process.env.NODE_ENV === 'development',
      }
    : {
        type: 'sqlite',
        database: process.env.SQLITE_FILE ?? './data/app.sqlite',
        entities: [User, RefreshToken, CentralProvider, Model, AppConfig, Conversation, Message],
        migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
        synchronize: false,
        logging: process.env.NODE_ENV === 'development',
      };

export default new DataSource(dataSourceOptions);
