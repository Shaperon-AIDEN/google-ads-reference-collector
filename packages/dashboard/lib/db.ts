import { createDb, type Db, type DbHandle } from '@adref/core';
import { env } from './env';

// Next.js dev 의 HMR 로 연결이 누적되지 않도록 전역 싱글턴으로 풀 재사용
const globalForDb = globalThis as unknown as { __adrefDb?: DbHandle };

export function db(): Db {
  if (!globalForDb.__adrefDb) {
    globalForDb.__adrefDb = createDb(env().DATABASE_URL);
  }
  return globalForDb.__adrefDb.db;
}
