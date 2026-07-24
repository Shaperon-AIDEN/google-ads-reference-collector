import { QuotaGuard, type AdListItem } from '@adref/core';
import { describe, expect, it } from 'vitest';
import { collectAdList } from '../src/handlers/collectAdList.js';
import { FakeAdsSource, FakeQueue, fakeRepos, makeDeps } from './fakes.js';

function item(id: string): AdListItem {
  return { creativeId: id, advertiserId: 'AR1', format: 'video', daysShown: 11 };
}

describe('collectAdList', () => {
  it('신규 creative 만 큐에 적재하고 기존은 건너뛴다', async () => {
    const queue = new FakeQueue();
    const ads = new FakeAdsSource({ AR1: [item('CR1'), item('CR2'), item('CR3')] });
    const repos = fakeRepos({
      competitors: [{ id: 'c1', advertiserId: 'AR1', region: 'KR' }],
      existing: new Set(['CR2']), // CR2 는 이미 저장됨
    });
    const deps = makeDeps({ queue, ads, repos: repos as never });

    const result = await collectAdList(deps);

    expect(result.status).toBe('success');
    expect(result.newAds).toBe(2); // CR1, CR3
    expect(queue.messages.map((m) => (m.body as { creativeId: string }).creativeId)).toEqual([
      'CR1',
      'CR3',
    ]);
    expect(repos.finishedRuns[0]).toMatchObject({ status: 'success', newAdsCount: 2 });
  });

  it('쿼터 임계치 도달 시 이후 경쟁사를 건너뛰고 partial', async () => {
    const queue = new FakeQueue();
    const ads = new FakeAdsSource({ AR1: [item('CR1')], AR2: [item('CR2')] });
    const repos = fakeRepos({
      competitors: [
        { id: 'c1', advertiserId: 'AR1', region: 'KR' },
        { id: 'c2', advertiserId: 'AR2', region: 'KR' },
      ],
    });
    // 예산 1, 임계치 floor(1*0.8)=0 → 첫 호출부터 차단
    const quota = new QuotaGuard({ monthlyBudget: 1, throttlePct: 0.8 });
    const deps = makeDeps({ queue, ads, repos: repos as never, quota });

    const result = await collectAdList(deps);

    expect(result.throttled).toBe(true);
    expect(result.status).toBe('partial');
    expect(queue.messages).toHaveLength(0);
  });
});
