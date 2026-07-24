import { app, type InvocationContext, type Timer } from '@azure/functions';
import { buildDeps } from '../handlers/context.js';
import { collectAdList } from '../handlers/collectAdList.js';

/**
 * 광고 목록 수집기 (Timer Trigger, 1일 2회). CRON 은 AD_LIST_CRON 앱 설정으로 주입.
 */
export async function adListCollector(_timer: Timer, context: InvocationContext): Promise<void> {
  const deps = await buildDeps();
  try {
    const result = await collectAdList(deps);
    context.log(`[adListCollector] ${result.status} newAds=${result.newAds} apiCalls=${result.apiCalls}`);
  } finally {
    await deps.close();
  }
}

app.timer('adListCollector', {
  schedule: '%AD_LIST_CRON%',
  handler: adListCollector,
});
