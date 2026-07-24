/**
 * 로컬 수집기 수동 트리거 헬퍼 (CRON 을 기다리지 않고 테스트).
 *
 *   pnpm trigger list                          # 목록 수집기 admin 호출
 *   pnpm trigger viewcount                     # 조회수 수집기 admin 호출
 *   pnpm trigger enqueue <competitorId> <advertiserId> <creativeId>
 *
 * Timer 함수는 Functions admin 엔드포인트로, 상세 수집기는 큐 적재로 트리거한다.
 */
import 'dotenv/config';
import { createQueueClient, loadEnv, type NewAdQueueMessage } from '@adref/core';

const ADMIN_BASE = process.env.FUNC_ADMIN_BASE ?? 'http://localhost:7071/admin/functions';

async function callAdmin(fnName: string) {
  const res = await fetch(`${ADMIN_BASE}/${fnName}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input: '' }),
  });
  console.log(`admin ${fnName}: ${res.status} ${res.statusText}`);
}

async function enqueue(competitorId: string, advertiserId: string, creativeId: string) {
  const env = loadEnv();
  const queue = createQueueClient(env);
  const msg: NewAdQueueMessage = { competitorId, advertiserId, creativeId };
  await queue.enqueue(env.AD_QUEUE_NAME, msg);
  console.log(`enqueued ${env.AD_QUEUE_NAME}:`, msg);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'list':
      await callAdmin('adListCollector');
      break;
    case 'viewcount':
      await callAdmin('viewCountCollector');
      break;
    case 'enqueue': {
      const [competitorId, advertiserId, creativeId] = rest;
      if (!competitorId || !advertiserId || !creativeId) {
        console.error('usage: pnpm trigger enqueue <competitorId> <advertiserId> <creativeId>');
        process.exit(1);
      }
      await enqueue(competitorId, advertiserId, creativeId);
      break;
    }
    default:
      console.error('usage: pnpm trigger <list|viewcount|enqueue>');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
