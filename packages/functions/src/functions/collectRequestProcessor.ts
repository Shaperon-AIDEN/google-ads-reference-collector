import { app, type InvocationContext } from '@azure/functions';
import type { CollectRequestMessage } from '@adref/core';
import { getDeps } from '../handlers/context.js';
import { collectForCompetitor } from '../handlers/collectForCompetitor.js';

/**
 * 온디맨드 수집 처리기 (Queue Trigger, 백그라운드).
 * collect-requests 큐 메시지를 소비해 단일 경쟁사 수집을 끝까지 실행한다.
 * HTTP 요청 수명과 분리되어 있어, 사용자가 페이지를 벗어나도 수집이 완료된다.
 */
export async function collectRequestProcessor(
  message: unknown,
  context: InvocationContext,
): Promise<void> {
  const msg = message as CollectRequestMessage;
  const deps = await getDeps(); // 프로세스 공유 — 연결 재사용(크레딧 보호)
  const result = await collectForCompetitor(deps, msg.competitorId, { maxTotal: msg.maxTotal, pageToken: msg.pageToken });
  context.log(`[collectRequestProcessor] ${result.competitor} new=${result.newAds} inline=${result.processedInline}`);
}

app.storageQueue('collectRequestProcessor', {
  queueName: '%COLLECT_QUEUE_NAME%',
  connection: 'AzureWebJobsStorage',
  handler: collectRequestProcessor,
});
