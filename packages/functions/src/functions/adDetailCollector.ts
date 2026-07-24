import { app, type InvocationContext } from '@azure/functions';
import type { NewAdQueueMessage } from '@adref/core';
import { buildDeps } from '../handlers/context.js';
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
  const deps = await buildDeps();
  try {
    await collectAdDetail(deps, msg);
    context.log(`[adDetailCollector] saved creativeId=${msg.creativeId}`);
  } finally {
    await deps.close();
  }
}

app.storageQueue('adDetailCollector', {
  queueName: '%AD_QUEUE_NAME%',
  connection: 'AzureWebJobsStorage',
  handler: adDetailCollector,
});
