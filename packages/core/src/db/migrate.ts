import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// dist 로 빌드되면 파일이 옮겨지므로, 마이그레이션 폴더는 패키지 루트 기준으로 찾는다.
const MIGRATIONS_DIR = resolve(__dirname, '../../drizzle');

/**
 * drizzle/*.sql 마이그레이션을 적용한다. 로컬·Azure 공용 — DATABASE_URL 만 다르다.
 */
export async function applyMigrations(databaseUrl: string): Promise<void> {
  const { db, pool } = createDb(databaseUrl);
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await pool.end();
  }
}

// tsx src/db/migrate.ts 로 직접 실행 시 DATABASE_URL 을 사용해 적용
const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL 이 설정되지 않았습니다.');
    process.exit(1);
  }
  applyMigrations(url)
    .then(() => {
      console.log('마이그레이션 적용 완료.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('마이그레이션 실패:', err);
      process.exit(1);
    });
}
