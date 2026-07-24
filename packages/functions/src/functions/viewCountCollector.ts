import { app, type InvocationContext, type Timer } from '@azure/functions';
import { buildDeps } from '../handlers/context.js';
import { collectViewCounts } from '../handlers/collectViewCounts.js';

/**
 * 조회수 수집기 (Timer Trigger, 일별). CRON 은 VIEW_COUNT_CRON 앱 설정으로 주입.
 */
export async function viewCountCollector(_timer: Timer, context: InvocationContext): Promise<void> {
  const deps = await buildDeps();
  try {
    const result = await collectViewCounts(deps);
    context.log(`[viewCountCollector] ${result.status} snapshots=${result.snapshots} apiCalls=${result.apiCalls}`);
  } finally {
    await deps.close();
  }
}

app.timer('viewCountCollector', {
  schedule: '%VIEW_COUNT_CRON%',
  handler: viewCountCollector,
});
