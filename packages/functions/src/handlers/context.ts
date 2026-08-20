import {
  AdMetricRepository,
  AdRepository,
  AdVariationRepository,
  CollectionRunRepository,
  CompetitorRepository,
  createAdsSource,
  createBlobStore,
  createQueueClient,
  createDb,
  createYouTubeClient,
  loadEnv,
  QuotaGuard,
  type AdsSource,
  type BlobStore,
  type Db,
  type DbHandle,
  type Env,
  type QueueClient,
  type YouTubeClient,
} from '@adref/core';

type Pool = DbHandle['pool'];

/**
 * 핸들러가 받는 의존성 묶음. 트리거(얇은 층)가 env→어댑터를 배선해 넘긴다.
 * 테스트에서는 목/실제 Azurite·PG 를 주입해 동일 핸들러를 실행한다.
 */
export interface HandlerDeps {
  env: Env;
  db: Db;
  pool: Pool;
  ads: AdsSource;
  queue: QueueClient;
  blob: BlobStore;
  youtube: YouTubeClient;
  repos: {
    competitors: CompetitorRepository;
    ads: AdRepository;
    adMetrics: AdMetricRepository;
    adVariations: AdVariationRepository;
    runs: CollectionRunRepository;
  };
  quota: QuotaGuard;
}

/** 이번 달 1일 0시 (UTC) — 쿼터 누적 집계 기준 */
function startOfMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

// ── 프로세스 공유 컨텍스트 ──────────────────────────────────────────────
// ⚠️ 큐 메시지/HTTP 요청마다 buildDeps()로 새 PG 풀을 만들고 닫으면 연결 생성(TLS 포함)
// 비용이 누적돼 B1ms 버스터블 크레딧을 태운다(실측: 연결 30개·CPU 94%·크레딧 고갈, 2026-08).
// 풀·어댑터는 프로세스에서 1회만 만들고 재사용한다. 쿼터 사용량만 5분 주기로 재집계.
let shared: (HandlerDeps & { close: () => Promise<void> }) | undefined;
let quotaRefreshedAt = 0;
const QUOTA_TTL_MS = 5 * 60_000;

export async function getDeps(): Promise<HandlerDeps> {
  if (!shared) {
    shared = await buildDeps();
    quotaRefreshedAt = Date.now();
    return shared;
  }
  if (Date.now() - quotaRefreshedAt > QUOTA_TTL_MS) {
    quotaRefreshedAt = Date.now();
    const usedThisMonth = await shared.repos.runs.apiCallsSince(startOfMonth(new Date()));
    shared.quota = new QuotaGuard({
      monthlyBudget: shared.env.QUOTA_MONTHLY_BUDGET,
      throttlePct: shared.env.QUOTA_THROTTLE_PCT,
      usedThisMonth,
    });
  }
  return shared;
}

/**
 * 운영 트리거용 컨텍스트 빌더. env 로부터 실제 어댑터를 생성하고, 이번 달 누적
 * API 사용량으로 쿼터 가드를 초기화한다. 사용 후 close() 로 풀을 정리한다.
 */
export async function buildDeps(env: Env = loadEnv(), now: Date = new Date()): Promise<HandlerDeps & { close: () => Promise<void> }> {
  const { db, pool } = createDb(env.DATABASE_URL);
  const runs = new CollectionRunRepository(db);
  const usedThisMonth = await runs.apiCallsSince(startOfMonth(now));

  return {
    env,
    db,
    pool,
    ads: createAdsSource(env),
    queue: createQueueClient(env),
    blob: createBlobStore(env),
    youtube: createYouTubeClient(env),
    repos: {
      competitors: new CompetitorRepository(db),
      ads: new AdRepository(db),
      adMetrics: new AdMetricRepository(db),
      adVariations: new AdVariationRepository(db),
      runs,
    },
    quota: new QuotaGuard({
      monthlyBudget: env.QUOTA_MONTHLY_BUDGET,
      throttlePct: env.QUOTA_THROTTLE_PCT,
      usedThisMonth,
    }),
    close: () => pool.end(),
  };
}
