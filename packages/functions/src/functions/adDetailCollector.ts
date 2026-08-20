import { app, type InvocationContext } from '@azure/functions';
import type { NewAdQueueMessage } from '@adref/core';
import { getDeps } from '../handlers/context.js';
import { collectAdDetail } from '../handlers/collectAdDetail.js';

/**
 * 상세 수집기 (Queue Trigger). 큐 메시지 1건을 처리한다.
 * 예외 시 런타임이 재시도(host.json maxDequeueCount=5) 후 포이즌 큐로 이동.
 */
export async function adDetailCollector(
  message: unknown,
  context: InvocationContext,
): Promise<void> {
  const msg = message as NewAdQueueMessage;
  const deps = await getDeps(); // 프로세스 공유 — 연결 재사용(크레딧 보호)
  await collectAdDetail(deps, msg);
  context.log(`[adDetailCollector] saved creativeId=${msg.creativeId}`);
}

app.storageQueue('adDetailCollector', {
  queueName: '%AD_QUEUE_NAME%',
  connection: 'AzureWebJobsStorage',
  handler: adDetailCollector,
});
