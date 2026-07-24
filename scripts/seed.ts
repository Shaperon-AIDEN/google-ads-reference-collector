/**
 * 로컬 개발용 시드 — 활성 경쟁사 몇 곳을 등록한다.
 * 실행: pnpm seed   (DATABASE_URL 필요, .env 로드)
 * advertiser_id 는 실제 값으로 교체 필요 (Phase 0 실측).
 */
import 'dotenv/config';
import { CompetitorRepository, createDb, loadEnv } from '@adref/core';

const SEED = [
  { name: '경쟁사 A (예시)', advertiserId: 'AR00000000000000001', domain: 'example-a.com', region: 'KR' },
  { name: '경쟁사 B (예시)', advertiserId: 'AR00000000000000002', domain: 'example-b.com', region: 'KR' },
  { name: '경쟁사 C (예시)', advertiserId: 'AR00000000000000003', domain: 'example-c.com', region: 'KR' },
];

async function main() {
  const env = loadEnv();
  const { db, pool } = createDb(env.DATABASE_URL);
  const repo = new CompetitorRepository(db);
  try {
    for (const c of SEED) {
      const saved = await repo.upsert({ ...c, isActive: true });
      console.log(`seeded: ${saved.name} (${saved.advertiserId})`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
