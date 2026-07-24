import { describe, expect, it, vi } from 'vitest';
import { YouTubeDataApiClient } from '../src/adapters/youtube/youtubeDataApi.js';

/** id 파라미터를 읽어 각 id 에 대한 statistics 아이템을 돌려주는 mock */
function statsFetch(perId: Record<string, { view?: string; like?: string }>): typeof fetch {
  return vi.fn(async (url: string | URL | Request) => {
    const u = new URL(String(url));
    const ids = (u.searchParams.get('id') ?? '').split(',').filter(Boolean);
    const items = ids
      .filter((id) => perId[id])
      .map((id) => ({ id, statistics: { viewCount: perId[id]!.view, likeCount: perId[id]!.like } }));
    return new Response(JSON.stringify({ items }), { status: 200 });
  }) as unknown as typeof fetch;
}

describe('YouTubeDataApiClient', () => {
  it('viewCount 는 bigint, likeCount 는 number 로 파싱', async () => {
    const yt = new YouTubeDataApiClient({
      apiKey: 'k',
      fetchImpl: statsFetch({ VID1: { view: '12634049', like: '220' } }),
    });
    const { stats, apiCalls } = await yt.getVideoStats(['VID1']);
    expect(apiCalls).toBe(1);
    expect(stats[0]).toEqual({ videoId: 'VID1', viewCount: 12634049n, likeCount: 220 });
  });

  it('50개 초과 시 배치로 분할 호출', async () => {
    const perId: Record<string, { view: string }> = {};
    const ids: string[] = [];
    for (let i = 0; i < 120; i++) {
      const id = `V${i}`;
      ids.push(id);
      perId[id] = { view: String(i) };
    }
    const fetchImpl = statsFetch(perId);
    const yt = new YouTubeDataApiClient({ apiKey: 'k', fetchImpl });

    const { stats, apiCalls } = await yt.getVideoStats(ids);
    expect(apiCalls).toBe(3); // 50 + 50 + 20
    expect(stats).toHaveLength(120);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('중복 id 는 제거, 응답에 없는 id 는 결과에서 빠짐', async () => {
    const yt = new YouTubeDataApiClient({
      apiKey: 'k',
      fetchImpl: statsFetch({ VID1: { view: '10' } }), // VID2 는 응답 없음
    });
    const { stats } = await yt.getVideoStats(['VID1', 'VID1', 'VID2']);
    expect(stats).toHaveLength(1);
    expect(stats[0]!.videoId).toBe('VID1');
  });

  it('좋아요 숨김(likeCount 없음) 처리', async () => {
    const yt = new YouTubeDataApiClient({
      apiKey: 'k',
      fetchImpl: statsFetch({ VID1: { view: '100' } }), // like 없음
    });
    const { stats } = await yt.getVideoStats(['VID1']);
    expect(stats[0]!.viewCount).toBe(100n);
    expect(stats[0]!.likeCount).toBeUndefined();
  });

  it('apiKey 누락 시 예외', () => {
    expect(() => new YouTubeDataApiClient({ apiKey: '' })).toThrow(/YOUTUBE_API_KEY/);
  });
});
