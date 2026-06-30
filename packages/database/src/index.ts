import * as schema from './schema';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const queryClient = postgres(process.env.DATABASE_URL || "postgres://postgres:password@localhost:5432/stock_quant");
export const db = drizzle(queryClient, { schema });
export * from './schema';
