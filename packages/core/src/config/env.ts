import { z } from 'zod';

/**
 * 환경 변수 스키마. 로컬(.env / local.settings.json)과 Azure(App Settings / Key Vault)가
 * 동일 키를 채우므로, 코드 변경 없이 설정만으로 클라우드 전환이 가능하다.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().url().or(z.string().startsWith('postgres')),

  // Azure Storage — 로컬은 "UseDevelopmentStorage=true" (Azurite)
  AzureWebJobsStorage: z.string().default('UseDevelopmentStorage=true'),

  // 외부 데이터 소스 — serpapi(안정, 유료) / crawl(무료, 비공식·실험적). 롤백은 이 값만 변경.
  ADS_SOURCE: z.enum(['serpapi', 'crawl']).default('serpapi'),

  // 수집·표시 스코프 — 'video'(기본, 원래 동작=비디오만) / 'all'(텍스트·이미지 포함).
  // 비디오 전용으로 되돌리려면 이 값만 'video' 로 바꾸면 됨(수집기·대시보드 공통).
  COLLECT_FORMATS: z.enum(['video', 'all']).default('video'),
  SERPAPI_KEY: z.string().optional(),
  YOUTUBE_API_KEY: z.string().optional(),

  // 큐 / Blob
  AD_QUEUE_NAME: z.string().default('new-ads'),
  COLLECT_QUEUE_NAME: z.string().default('collect-requests'),
  BLOB_CONTAINER: z.string().default('thumbnails'),

  // 크롤 페이싱 — 실행당 상세 수집 한도(기본 500)와 한도 도달 후 휴식(기본 10분).
  // "수집 대상이 한도를 넘으면 끊어서 수집" — 502건 연속 수집 시 봇 차단 실측(2026-07-31).
  CRAWL_RUN_LIMIT: z.coerce.number().int().min(0).default(500),
  CRAWL_RUN_PAUSE_MS: z.coerce.number().int().min(0).default(600_000),

  // 쿼터 가드
  QUOTA_MONTHLY_BUDGET: z.coerce.number().int().positive().default(5000),
  QUOTA_THROTTLE_PCT: z.coerce.number().min(0).max(1).default(0.8),

  // 인증
  AUTH_MODE: z.enum(['mock', 'entra']).default('mock'),

  // 대시보드가 온디맨드 수집을 위해 호출하는 Functions HTTP 엔드포인트 베이스 URL
  FUNCTIONS_BASE_URL: z.string().default('http://localhost:7071/api'),

  // 스케줄 (CRON)
  AD_LIST_CRON: z.string().default('0 0 0,12 * * *'),
  VIEW_COUNT_CRON: z.string().default('0 0 3 * * *'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * process.env 를 검증·파싱한다. Functions(local.settings.json)와 Next.js/scripts(.env)
 * 모두 process.env 로 수렴하므로 로더는 하나로 충분하다.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`환경 변수 검증 실패:\n${issues}`);
  }
  return parsed.data;
}
