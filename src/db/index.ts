import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { env } from '@/config/env';
import * as schema from './schema';

function createSqlClient(databaseUrl: string): SQL {
  const url = new URL(databaseUrl);
  const socketPath = url.searchParams.get('host');

  if (socketPath) {
    return new SQL({
      hostname: socketPath,
      database: url.pathname.slice(1),
      username: url.username,
      password: url.password,
    });
  }

  return new SQL(databaseUrl);
}

const client = createSqlClient(env.DATABASE_URL);

export const db = drizzle({ client, schema });

export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await client`SELECT 1`;
    return true;
  } catch (error) {
    console.error('Database connection error:', error);
    return false;
  }
}

export async function closeDatabase(): Promise<void> {
  await client.close();
}
