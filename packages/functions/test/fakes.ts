import {
  QuotaGuard,
  type AdDetail,
  type AdListItem,
  type AdsSource,
  type BlobStore,
  type NewAd,
  type QueueClient,
  type VideoStats,
  type YouTubeClient,
} from '@adref/core';
import type { HandlerDeps } from '../src/handlers/context.js';

/** 인메모리 큐 — enqueue 된 메시지를 배열에 모은다 */
export class FakeQueue implements QueueClient {
  readonly messages: Array<{ queue: string; body: unknown }> = [];
  async enqueue<T>(queue: string, body: T): Promise<void> {
    this.messages.push({ queue, body });
  }
  async receive(): Promise<never[]> {
    return [];
  }
  async delete(): Promise<void> {}
}

/** 목록만 반환하는 광고 소스 (상세는 미사용) */
export class FakeAdsSource implements AdsSource {
  readonly name = 'fake';
  private calls = 0;
  constructor(private readonly listing: Record<string, AdListItem[]>) {}
  async listAds(p: { advertiserId: string }) {
    this.calls += 1;
    return { items: this.listing[p.advertiserId] ?? [], apiCalls: 1 };
  }
  async getAdDetail() {
    throw new Error('not used');
    return { detail: null as never, apiCalls: 1 };
  }
  apiCalls(): number {
    return this.calls;
  }
}

/** 상세 응답을 주입하는 광고 소스 페이크 (상세 수집기용) */
export class FakeDetailSource implements AdsSource {
  readonly name = 'fake-detail';
  constructor(private readonly detail: AdDetail) {}
  async listAds() {
    return { items: [] as AdListItem[], apiCalls: 1 };
  }
  async getAdDetail() {
    return { detail: this.detail, apiCalls: 1 };
  }
}

/** 인메모리 Blob — put 된 항목을 배열에 기록 */
export class FakeBlob implements BlobStore {
  readonly puts: Array<{ container: string; path: string; size: number; contentType: string }> = [];
  async put(container: string, path: string, data: Buffer, contentType: string) {
    this.puts.push({ container, path, size: data.length, contentType });
    return { path, url: `memory://${container}/${path}` };
  }
  getUrl(container: string, path: string): string {
    return `memory://${container}/${path}`;
  }
}

/** 조회수 응답을 주입하는 YouTube 페이크 */
export class FakeYouTube implements YouTubeClient {
  calls = 0;
  lastIds: string[] = [];
  constructor(private readonly stats: VideoStats[]) {}
  async getVideoStats(ids: string[]) {
    this.calls += 1;
    this.lastIds = ids;
    // 요청 ID 에 해당하는 통계만 반환 (없는 ID 제외 모사)
    const set = new Set(ids);
    return { stats: this.stats.filter((s) => set.has(s.videoId)), apiCalls: 1 };
  }
}

/** competitors.listActive + ads.existingCreativeIds 만 필요한 최소 리포지토리 페이크 */
export function fakeRepos(opts: {
  competitors: Array<{ id: string; advertiserId: string; region: string }>;
  existing?: Set<string>;
}) {
  const runs: Array<{ id: string; status: string; newAdsCount?: number }> = [];
  return {
    finishedRuns: runs,
    competitors: {
      listActive: async () => opts.competitors,
    },
    ads: {
      existingCreativeIds: async (ids: string[]) =>
        new Set(ids.filter((i) => opts.existing?.has(i))),
    },
    adMetrics: {},
    runs: {
      start: async () => ({ id: `run-${runs.length}` }),
      finish: async (id: string, patch: { status: string; newAdsCount?: number }) => {
        runs.push({ id, status: patch.status, newAdsCount: patch.newAdsCount });
      },
    },
  };
}

/** 상세 수집기용 리포지토리 페이크 — upsert 된 광고를 캡처 */
export function detailRepos() {
  const upserts: NewAd[] = [];
  return {
    upserts,
    ads: {
      upsertByCreativeId: async (input: NewAd) => {
        upserts.push(input);
        return { id: `ad-${upserts.length}`, ...input };
      },
    },
  };
}

/** 조회수 수집기용 리포지토리 페이크 — 대상 광고 목록 + 스냅샷 캡처 */
export function viewCountRepos(targets: Array<{ id: string; youtubeVideoId: string | null }>) {
  const snapshots: Array<{ adId: string; snapshotDate: string; ytViewCount?: bigint; ytLikeCount?: number }> = [];
  const runs: Array<{ id: string; status: string; apiCallCount?: number }> = [];
  return {
    snapshots,
    finishedRuns: runs,
    ads: {
      withYouTubeId: async () => targets,
    },
    adMetrics: {
      insertSnapshot: async (s: { adId: string; snapshotDate: string; ytViewCount?: bigint; ytLikeCount?: number }) => {
        snapshots.push(s);
      },
    },
    runs: {
      start: async () => ({ id: `run-${runs.length}` }),
      finish: async (id: string, patch: { status: string; apiCallCount?: number }) => {
        runs.push({ id, status: patch.status, apiCallCount: patch.apiCallCount });
      },
    },
  };
}

/** 테스트용 HandlerDeps 조립 (필요한 부분만 채우고 나머지는 캐스팅) */
export function makeDeps(partial: Partial<HandlerDeps> & { quota?: QuotaGuard }): HandlerDeps {
  return {
    env: { AD_QUEUE_NAME: 'new-ads', BLOB_CONTAINER: 'thumbnails' },
    quota: partial.quota ?? new QuotaGuard({ monthlyBudget: 5000, throttlePct: 0.8 }),
    ...partial,
  } as unknown as HandlerDeps;
}
