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
  SERPAPI_KEY: z.string().optional(),
  YOUTUBE_API_KEY: z.string().optional(),

  // 큐 / Blob
  AD_QUEUE_NAME: z.string().default('new-ads'),
  BLOB_CONTAINER: z.string().default('thumbnails'),

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
