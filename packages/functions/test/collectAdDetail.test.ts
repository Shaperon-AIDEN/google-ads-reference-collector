import { QuotaGuard, type AdDetail, type NewAdQueueMessage } from '@adref/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectAdDetail } from '../src/handlers/collectAdDetail.js';
import { FakeBlob, FakeDetailSource, detailRepos, makeDeps } from './fakes.js';

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
