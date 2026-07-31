import { QuotaGuard, type AdDetail, type NewAdQueueMessage } from '@adref/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectAdDetail } from '../src/handlers/collectAdDetail.js';
import { FakeBlob, FakeDetailSource, FakeYouTube, detailRepos, makeDeps } from './fakes.js';

const msg: NewAdQueueMessage = {
  competitorId: 'c1',
  advertiserId: 'AR1',
  creativeId: 'CR1',
  format: 'video',
  firstShown: '2026-07-13',
  lastShown: '2026-07-23',
  daysShown: 11,
};

const videoDetail: AdDetail = {
  creativeId: 'CR1',
  videoUrl: 'https://www.youtube.com/embed/TOnJMLfOZCs',
  landingUrl: 'https://www.tesla.com/de_de/powerwall',
  headline: 'Powerwall',
  channelName: 'Tesla',
  raw: { some: 'payload' },
};

afterEach(() => vi.unstubAllGlobals());

describe('collectAdDetail', () => {
  it('영상 광고: youtube id 파싱·썸네일 Blob 저장·목록 필드 병합 upsert', async () => {
    // 썸네일 fetch 성공 모사
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(Buffer.from('JPEGDATA'), { status: 200 })),
    );
    const blob = new FakeBlob();
    const repos = detailRepos();
    const deps = makeDeps({ ads: new FakeDetailSource(videoDetail), blob, repos: repos as never });

    await collectAdDetail(deps, msg);

    expect(repos.upserts).toHaveLength(1);
    const up = repos.upserts[0]!;
    expect(up.youtubeVideoId).toBe('TOnJMLfOZCs');
    expect(up.landingDomain).toBe('tesla.com');
    expect(up.format).toBe('video'); // msg(목록)에서 병합
    expect(up.daysShown).toBe(11);
    expect(up.thumbnailPath).toBe('CR1.jpg');
    expect(up.raw).toEqual({ some: 'payload' }); // 원본 보존
    // 썸네일이 실제로 Blob 에 저장됨
    expect(blob.puts).toHaveLength(1);
    expect(blob.puts[0]).toMatchObject({ container: 'thumbnails', path: 'CR1.jpg', contentType: 'image/jpeg' });
  });

  it('영상 광고: 수집 시점에 조회수 스냅샷도 함께 저장', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.from('J'), { status: 200 })));
    const repos = detailRepos();
    const youtube = new FakeYouTube([{ videoId: 'TOnJMLfOZCs', viewCount: 73272n, likeCount: 12 }]);
    const deps = makeDeps({ ads: new FakeDetailSource(videoDetail), blob: new FakeBlob(), repos: repos as never, youtube });

    await collectAdDetail(deps, msg);

    expect(repos.snapshots).toHaveLength(1);
    expect(repos.snapshots[0]).toMatchObject({ adId: 'ad-1', ytViewCount: 73272n, ytLikeCount: 12 });
    expect(repos.snapshots[0]!.snapshotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('썸네일 fetch 실패해도 광고는 저장된다 (베스트 에포트)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 404 })),
    );
    const blob = new FakeBlob();
    const repos = detailRepos();
    const deps = makeDeps({ ads: new FakeDetailSource(videoDetail), blob, repos: repos as never });

    await collectAdDetail(deps, msg);

    expect(repos.upserts).toHaveLength(1);
    expect(repos.upserts[0]!.thumbnailPath).toBeUndefined();
    expect(blob.puts).toHaveLength(0); // 저장 시도 없음
  });

  it('영상 없는 광고: youtube id·썸네일 없이 저장', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const textDetail: AdDetail = { creativeId: 'CR1', landingUrl: 'https://tesla.com', raw: {} };
    const repos = detailRepos();
    const deps = makeDeps({ ads: new FakeDetailSource(textDetail), blob: new FakeBlob(), repos: repos as never });

    await collectAdDetail(deps, { ...msg, format: 'text' });

    expect(repos.upserts[0]!.youtubeVideoId).toBeNull();
    expect(repos.upserts[0]!.thumbnailPath).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled(); // 썸네일 다운로드 시도 안 함
  });

  it('쿼터 소진 시 예외를 던져 재시도 대상이 된다', async () => {
    const quota = new QuotaGuard({ monthlyBudget: 1, throttlePct: 0.8 }); // 임계치 0
    const repos = detailRepos();
    const deps = makeDeps({ ads: new FakeDetailSource(videoDetail), blob: new FakeBlob(), repos: repos as never, quota });

    await expect(collectAdDetail(deps, msg)).rejects.toThrow(/쿼터/);
    expect(repos.upserts).toHaveLength(0);
  });
});

describe('크롤 페이싱 (500건 단위 + 10분 휴식)', () => {
  function pacingDeps(state: { window_count: number; pause_until: Date | null } | null, over: Partial<Record<string, unknown>> = {}) {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const enqueues: Array<{ queue: string; body: unknown; opts?: { visibilityTimeoutMs?: number } }> = [];
    const repos = detailRepos();
    const deps = makeDeps({ ads: new FakeDetailSource(videoDetail), blob: new FakeBlob(), repos: repos as never });
    (deps as never as { env: Record<string, unknown> }).env = {
      AD_QUEUE_NAME: 'new-ads',
      BLOB_CONTAINER: 'thumbnails',
      ADS_SOURCE: 'crawl',
      CRAWL_RUN_LIMIT: 3,
      CRAWL_RUN_PAUSE_MS: 600_000,
      ...over,
    };
    (deps as never as { pool: unknown }).pool = {
      query: async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        if (sql.startsWith('select')) return { rows: state ? [state] : [] };
        return { rows: [] };
      },
    };
    (deps as never as { queue: unknown }).queue = {
      enqueue: async (queue: string, body: unknown, opts?: { visibilityTimeoutMs?: number }) => {
        enqueues.push({ queue, body, opts });
      },
    };
    return { deps, queries, enqueues, repos };
  }

  it('휴식 중이면 처리하지 않고 남은 시간만큼 지연 재적재', async () => {
    const { deps, enqueues, repos } = pacingDeps({ window_count: 0, pause_until: new Date(Date.now() + 300_000) });
    await collectAdDetail(deps, msg);
    expect(repos.upserts).toHaveLength(0); // 처리 건너뜀
    expect(enqueues).toHaveLength(1);
    expect(enqueues[0]!.queue).toBe('new-ads');
    expect(enqueues[0]!.opts!.visibilityTimeoutMs).toBeGreaterThan(290_000); // ≈ 남은 휴식
  });

  it('한도(3건째) 도달 시 해당 건은 처리하고 휴식을 예약', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.from('J'), { status: 200 })));
    const { deps, queries, repos } = pacingDeps({ window_count: 2, pause_until: null });
    await collectAdDetail(deps, msg);
    expect(repos.upserts).toHaveLength(1); // 3건째 자체는 처리
    const upd = queries.find((q) => q.sql.startsWith('insert into crawl_pacing'));
    expect(upd!.params![1]).toBeInstanceOf(Date); // pause_until 설정됨
  });

  it('휴식이 끝났으면 새 윈도우로 정상 처리', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.from('J'), { status: 200 })));
    const { deps, queries, repos } = pacingDeps({ window_count: 0, pause_until: new Date(Date.now() - 1000) });
    await collectAdDetail(deps, msg);
    expect(repos.upserts).toHaveLength(1);
    const upd = queries.find((q) => q.sql.startsWith('insert into crawl_pacing'));
    expect(upd!.params![0]).toBe(1); // 새 윈도우 1건째
    expect(upd!.params![1]).toBeNull();
  });

  it('serpapi 소스는 페이싱 미적용', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.from('J'), { status: 200 })));
    const { deps, queries, repos } = pacingDeps(null, { ADS_SOURCE: 'serpapi' });
    await collectAdDetail(deps, msg);
    expect(repos.upserts).toHaveLength(1);
    expect(queries).toHaveLength(0); // 페이싱 쿼리 자체가 없음
  });
});
