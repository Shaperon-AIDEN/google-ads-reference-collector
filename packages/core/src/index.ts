// 설정
export { loadEnv, type Env } from './config/env.js';

// DB
export * as schema from './db/schema.js';
export { createDb, type Db, type DbHandle } from './db/client.js';
// applyMigrations 는 `tsx src/db/migrate.ts` CLI 로만 사용한다. import.meta 를 쓰므로
// 라이브러리 번들(CJS)에 넣지 않는다 — barrel 에서 export 하지 않음.
export {
  type Competitor,
  type NewCompetitor,
  type Ad,
  type NewAd,
  type AdMetric,
  type NewAdMetric,
  type CollectionRun,
  type NewCollectionRun,
} from './db/schema.js';

// 리포지토리
export { CompetitorRepository } from './db/repositories/competitors.js';
export { AdRepository } from './db/repositories/ads.js';
export { AdMetricRepository } from './db/repositories/adMetrics.js';
export { CollectionRunRepository } from './db/repositories/collectionRuns.js';

// 도메인
export type { AdFormat, AdPeriod, NewAdQueueMessage, CollectRequestMessage } from './domain/models.js';
export { isFormatAllowed, isRealCreativeUrl } from './domain/models.js';
export { parseYouTubeId } from './domain/parseYouTubeId.js';
export { landingDomain } from './domain/landingDomain.js';
export { QuotaGuard } from './domain/quotaGuard.js';

// 어댑터 — ads source
export {
  type AdsSource,
  type AdListItem,
  type AdDetail,
  type AdvertiserCandidate,
  type ListAdsParams,
  type GetAdDetailParams,
  type SearchAdvertisersParams,
} from './adapters/ads-source/types.js';
export { SerpApiAdsSource, type SerpApiConfig } from './adapters/ads-source/serpapi.js';
export { TransparencyCrawlAdsSource, type CrawlTransport } from './adapters/ads-source/transparencyCrawl.js';
export { createAdsSource } from './adapters/ads-source/factory.js';

// 어댑터 — queue
export { type QueueClient, type QueueMessage } from './adapters/queue/types.js';
export { AzureStorageQueueClient } from './adapters/queue/azureStorageQueue.js';
export { createQueueClient } from './adapters/queue/factory.js';

// 어댑터 — blob
export { type BlobStore } from './adapters/blob/types.js';
export { AzureBlobStore } from './adapters/blob/azureBlob.js';
export { createBlobStore } from './adapters/blob/factory.js';

// 어댑터 — youtube
export { type YouTubeClient, type VideoStats } from './adapters/youtube/types.js';
export { YouTubeDataApiClient, type YouTubeConfig } from './adapters/youtube/youtubeDataApi.js';
export { createYouTubeClient } from './adapters/youtube/factory.js';

// 어댑터 — advertiser search (광고주 이름 자동완성)
export { type AdvertiserSearch, type AdvertiserSuggestion } from './adapters/advertiser-search/types.js';
export { GoogleTransparencyAdvertiserSearch, type SuggestTransport } from './adapters/advertiser-search/googleTransparency.js';
export { createAdvertiserSearch } from './adapters/advertiser-search/factory.js';
