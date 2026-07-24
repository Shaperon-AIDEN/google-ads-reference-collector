import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  pool: pg.Pool;
}

/**
 * DATABASE_URL 로 pg 풀을 만들고 Drizzle 인스턴스를 반환한다.
 * 로컬↔Azure 차이는 연결 문자열(sslmode 등)뿐이며 코드는 동일하다.
 */
export function createDb(databaseUrl: string): DbHandle {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });
  return { db, pool };
}
