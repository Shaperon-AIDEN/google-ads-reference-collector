import type { VideoStats, YouTubeClient } from './types.js';

const YT_BASE = 'https://www.googleapis.com/youtube/v3/videos';
const BATCH = 50; // videos.list id 최대 개수

export interface YouTubeConfig {
  apiKey: string;
  fetchImpl?: typeof fetch;
}

type Json = Record<string, unknown>;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * YouTube Data API v3 구현. videos.list?part=statistics 로 조회수·좋아요를 배치 조회.
 */
export class YouTubeDataApiClient implements YouTubeClient {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(cfg: YouTubeConfig) {
    if (!cfg.apiKey) throw new Error('YOUTUBE_API_KEY 가 필요합니다.');
    this.apiKey = cfg.apiKey;
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  async getVideoStats(ids: string[]): Promise<{ stats: VideoStats[]; apiCalls: number }> {
    const unique = [...new Set(ids.filter(Boolean))];
    const stats: VideoStats[] = [];
    let apiCalls = 0;

    for (const group of chunk(unique, BATCH)) {
      const url = new URL(YT_BASE);
      // snippet(게시일) + statistics(조회수·좋아요)를 한 번에 조회. 둘 다 1유닛(무료).
      url.searchParams.set('part', 'snippet,statistics');
      url.searchParams.set('id', group.join(','));
      url.searchParams.set('key', this.apiKey);

      const res = await this.fetchImpl(url.toString());
      apiCalls += 1;
      if (!res.ok) {
        throw new Error(`YouTube API 요청 실패 (${res.status}): ${await res.text()}`);
      }

      const json = (await res.json()) as Json;
      const items = (json.items as Json[] | undefined) ?? [];
      for (const item of items) {
        const s = (item.statistics as Json | undefined) ?? {};
        const snippet = (item.snippet as Json | undefined) ?? {};
        const viewCount = typeof s.viewCount === 'string' ? BigInt(s.viewCount) : undefined;
        const likeCount = typeof s.likeCount === 'string' ? Number(s.likeCount) : undefined;
        const publishedAt = typeof snippet.publishedAt === 'string' ? snippet.publishedAt : undefined;
        stats.push({ videoId: String(item.id), viewCount, likeCount, publishedAt });
      }
    }

    return { stats, apiCalls };
  }
}
