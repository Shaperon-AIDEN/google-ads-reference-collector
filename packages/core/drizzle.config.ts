import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit generate 로 packages/core/drizzle/*.sql (순수 SQL) 을 생성한다.
 * 생성된 SQL 은 로컬·Azure PostgreSQL 에 동일하게 적용된다.
 */
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://adref:adref@localhost:5432/adref',
  },
  strict: true,
  verbose: true,
});
