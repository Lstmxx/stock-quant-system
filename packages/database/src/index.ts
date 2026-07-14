import * as schema from './schema';
import * as authSchema from './auth-schema';
import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

export const ROOT_ENV_FILE = fileURLToPath(new URL('../../../.env', import.meta.url));
config({ path: ROOT_ENV_FILE });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required; configure it in the repository root .env');
}

const queryClient = postgres(databaseUrl);
export const db = drizzle(queryClient, { schema: { ...schema, ...authSchema } });
export * from './schema';
export * from './auth-schema';
