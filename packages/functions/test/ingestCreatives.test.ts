import { describe, expect, it } from 'vitest';
import type { NewAd } from '@adref/core';
import { ingestCreatives } from '../src/handlers/ingestCreatives.js';
import { FakeYouTube, makeDeps } from './fakes.js';

/** ingest 전용 리포지토리 페이크 — competitor 조회 + upsert/스냅샷/run 캡처 */
function ingestRepos(competitor?: { id: string; name: string }) {
  const upserts: NewAd[] = [];
  const snapshots: Array<{ adId: string; ytViewCount?: bigint; ytLikeCount?: number }> = [];
  const runs: Array<{ status: string }> = [];
  return {
    upserts,
    snapshots,
    finishedRuns: runs,
    competitors: {
      findByAdvertiserId: async (aid: string) => (competitor && aid === 'AR1' ? { ...competitor, advertiserId: aid } : undefined),
    },
    ads: {
      upsertByCreativeId: async (input: NewAd) => {
        upserts.push(input);
        return { id: `ad-${upserts.length}`, ...input };
      },
    },
    adMetrics: {
      insertSnapshot: async (s: { adId: string; ytViewCount?: bigint; ytLikeCount?: number }) => {
        snapshots.push(s);
      },
    },
    runs: {
      start: async () => ({ id: 'run-0' }),
      finish: async (_id: string, patch: { status: string }) => {
        runs.push({ status: patch.status });
      },
    },
  };
}

describe('ingestCreatives', () => {
  it('비디오 광고를 upsert 하고 게시일·조회수 스냅샷을 저장', async () => {
    const repos = ingestRepos({ id: 'c1', name: '드래프터' });
    const youtube = new FakeYouTube([
      { videoId: 'dQw4w9WgXcQ', viewCount: 100n, likeCount: 5, publishedAt: '2026-07-20T00:00:00Z' },
    ]);
    const deps = makeDeps({ repos: repos as never, youtube });

    const result = await ingestCreatives(deps, {
      advertiserId: 'AR1',
      ads: [
        {
          creativeId: 'CR1',
          format: 'video',
          firstShown: '2026-07-01',
          lastShown: '2026-07-10',
          videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
          landingUrl: 'https://example.com/land',
        },
      ],
    });

    expect(result.status).toBe('success');
    expect(result.saved).toBe(1);
    expect(result.snapshots).toBe(1);
    expect(repos.upserts).toHaveLength(1);
    expect(repos.upserts[0]!.youtubeVideoId).toBe('dQw4w9WgXcQ');
    expect(repos.upserts[0]!.publishedAt).toEqual(new Date('2026-07-20T00:00:00Z'));
    expect(repos.upserts[0]!.landingDomain).toBe('example.com');
    expect(repos.snapshots[0]).toMatchObject({ adId: 'ad-1', ytViewCount: 100n, ytLikeCount: 5 });
  });

  it('기본 스코프(video)에서는 비디오가 아닌 광고를 건너뜀', async () => {
    const repos = ingestRepos({ id: 'c1', name: '드래프터' });
    const deps = makeDeps({ repos: repos as never, youtube: new FakeYouTube([]), env: { COLLECT_FORMATS: 'video' } as never });

    const result = await ingestCreatives(deps, {
      advertiserId: 'AR1',
      ads: [
        { creativeId: 'CR_img', format: 'image' },
        { creativeId: 'CR_txt', format: 'text' },
      ],
    });

    expect(result.saved).toBe(0);
    expect(result.skipped).toBe(2);
    expect(repos.upserts).toHaveLength(0);
  });

  it('스코프 all 이면 이미지/텍스트도 저장(이미지 URL·헤드라인 포함)', async () => {
    const repos = ingestRepos({ id: 'c1', name: '드래프터' });
    const deps = makeDeps({ repos: repos as never, youtube: new FakeYouTube([]), env: { COLLECT_FORMATS: 'all' } as never });

    const result = await ingestCreatives(deps, {
      advertiserId: 'AR1',
      ads: [
        { creativeId: 'CR_img', format: 'image', imageUrl: 'https://tpc.googlesyndication.com/archive/simgad/1', headline: '헤드라인', landingUrl: 'https://shop.example.com/x' },
        { creativeId: 'CR_txt', format: 'text', headline: '텍스트 광고 문구' },
      ],
    });

    expect(result.saved).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.snapshots).toBe(0); // 비-비디오는 조회수 없음
    expect(repos.upserts.map((u) => u.format).sort()).toEqual(['image', 'text']);
    const img = repos.upserts.find((u) => u.creativeId === 'CR_img')!;
    expect(img.imageUrl).toBe('https://tpc.googlesyndication.com/archive/simgad/1');
    expect(img.headline).toBe('헤드라인');
    expect(img.landingDomain).toBe('shop.example.com');
  });

  it('서버측 안전망: 확장이 로고 URL(/simgad/, archive없음)을 보내도 imageUrl 은 null 로 저장', async () => {
    const repos = ingestRepos({ id: 'c1', name: '드래프터' });
    const deps = makeDeps({ repos: repos as never, youtube: new FakeYouTube([]), env: { COLLECT_FORMATS: 'all' } as never });

    await ingestCreatives(deps, {
      advertiserId: 'AR1',
      ads: [{ creativeId: 'CR_logo', format: 'image', imageUrl: 'https://tpc.googlesyndication.com/simgad/LOGO' }],
    });

    expect(repos.upserts[0]!.imageUrl).toBeNull(); // 로고는 거부
  });

  it('YouTube 통계가 없으면 저장은 하되 스냅샷은 없음', async () => {
    const repos = ingestRepos({ id: 'c1', name: '드래프터' });
    const deps = makeDeps({ repos: repos as never, youtube: new FakeYouTube([]) }); // 통계 없음

    const result = await ingestCreatives(deps, {
      advertiserId: 'AR1',
      ads: [{ creativeId: 'CR1', format: 'video', videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ' }],
    });

    expect(result.saved).toBe(1);
    expect(result.snapshots).toBe(0);
    expect(repos.upserts[0]!.youtubeVideoId).toBe('dQw4w9WgXcQ');
  });

  it('등록되지 않은 광고주면 실패(run=failed)', async () => {
    const repos = ingestRepos(undefined); // findByAdvertiserId → undefined
    const deps = makeDeps({ repos: repos as never, youtube: new FakeYouTube([]) });

    await expect(
      ingestCreatives(deps, { advertiserId: 'AR_unknown', ads: [{ creativeId: 'CR1', format: 'video' }] }),
    ).rejects.toThrow(/경쟁사를 찾을 수 없습니다/);
    expect(repos.finishedRuns[0]!.status).toBe('failed');
  });
});
