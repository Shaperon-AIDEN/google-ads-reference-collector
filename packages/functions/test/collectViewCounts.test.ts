import { QuotaGuard } from '@adref/core';
import { describe, expect, it } from 'vitest';
import { collectViewCounts } from '../src/handlers/collectViewCounts.js';
import { FakeYouTube, makeDeps, viewCountRepos } from './fakes.js';

const NOW = new Date('2026-07-24T09:00:00Z');

describe('collectViewCounts', () => {
  it('youtube id 보유 광고의 조회수를 일별 스냅샷으로 적재', async () => {
    const repos = viewCountRepos([
      { id: 'ad1', youtubeVideoId: 'VID1' },
      { id: 'ad2', youtubeVideoId: 'VID2' },
    ]);
    const youtube = new FakeYouTube([
      { videoId: 'VID1', viewCount: 100n, likeCount: 5 },
      { videoId: 'VID2', viewCount: 200n, likeCount: 9 },
    ]);
    const deps = makeDeps({ youtube, repos: repos as never });

    const res = await collectViewCounts(deps, NOW);

    expect(res.status).toBe('success');
    expect(res.snapshots).toBe(2);
    expect(repos.snapshots).toHaveLength(2);
    expect(repos.snapshots[0]).toMatchObject({
      adId: 'ad1',
      snapshotDate: '2026-07-24',
      ytViewCount: 100n,
      ytLikeCount: 5,
    });
    expect(youtube.calls).toBe(1); // 배치 1회
  });

  it('대상 광고가 없으면 호출 없이 success/0', async () => {
    const repos = viewCountRepos([]);
    const youtube = new FakeYouTube([]);
    const deps = makeDeps({ youtube, repos: repos as never });

    const res = await collectViewCounts(deps, NOW);

    expect(res.status).toBe('success');
    expect(res.snapshots).toBe(0);
    expect(youtube.calls).toBe(0); // 조회 자체를 안 함
  });

  it('쿼터 소진 시 조회 없이 partial', async () => {
    const repos = viewCountRepos([{ id: 'ad1', youtubeVideoId: 'VID1' }]);
    const youtube = new FakeYouTube([{ videoId: 'VID1', viewCount: 1n }]);
    const quota = new QuotaGuard({ monthlyBudget: 1, throttlePct: 0.8 }); // 임계치 0
    const deps = makeDeps({ youtube, repos: repos as never, quota });

    const res = await collectViewCounts(deps, NOW);

    expect(res.status).toBe('partial');
    expect(res.throttled).toBe(true);
    expect(youtube.calls).toBe(0);
    expect(repos.snapshots).toHaveLength(0);
    expect(repos.finishedRuns[0]).toMatchObject({ status: 'partial' });
  });
});
