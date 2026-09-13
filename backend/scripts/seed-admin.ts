/**
 * One-shot admin seeder. Reads SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD
 * from the environment, hashes the password with Argon2id (falls back
 * to bcrypt), and inserts (or updates) a User row with role=admin.
 *
 * Run via: `npm run seed:admin`
 */

import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config as loadDotenv } from 'dotenv';
import { join } from 'path';
import * as argon2 from 'argon2';
import * as bcrypt from 'bcrypt';
import { dataSourceOptions } from '../src/database/data-source';
import { User } from '../src/modules/users/entities/user.entity';

loadDotenv({ path: join(process.cwd(), '.env') });

async function hash(password: string): Promise<string> {
  try {
    return await argon2.hash(password, { type: argon2.argon2id });
  } catch {
    return bcrypt.hash(password, 12);
  }
}

async function main(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set');
  }

  const ds = new DataSource(dataSourceOptions);
  await ds.initialize();
  const repo = ds.getRepository(User);
  const passwordHash = await hash(password);
  const normalizedEmail = email.toLowerCase();

  const existing = await repo.findOne({ where: { email: normalizedEmail } });
  if (existing) {
    existing.passwordHash = passwordHash;
    existing.role = 'admin';
    await repo.save(existing);
    // eslint-disable-next-line no-console
    console.log(`[seed:admin] updated admin ${normalizedEmail}`);
  } else {
    await repo.save(
      repo.create({
        email: normalizedEmail,
        passwordHash,
        role: 'admin',
      }),
    );
    // eslint-disable-next-line no-console
    console.log(`[seed:admin] created admin ${normalizedEmail}`);
  }

  await ds.destroy();
}

void main();
