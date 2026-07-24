import type { Env } from '../../config/env.js';
import { SerpApiAdsSource } from './serpapi.js';
import { TransparencyCrawlAdsSource } from './transparencyCrawl.js';
import type { AdsSource } from './types.js';

/**
 * ADS_SOURCE 설정에 따라 데이터 소스 구현을 선택한다.
 * - serpapi: SerpApi (안정, 유료, 기본) — 롤백 대상
 * - crawl:   투명성 센터 직접 크롤 (무료, 비공식·실험적)
 * 롤백은 환경변수 ADS_SOURCE=serpapi 로 되돌리기만 하면 된다 (코드 변경 없음).
 */
export function createAdsSource(env: Env, fetchImpl?: typeof fetch): AdsSource {
  switch (env.ADS_SOURCE) {
    case 'serpapi':
      return new SerpApiAdsSource({ apiKey: env.SERPAPI_KEY ?? '', fetchImpl });
    case 'crawl':
      return new TransparencyCrawlAdsSource();
    default:
      throw new Error(`알 수 없는 ADS_SOURCE: ${env.ADS_SOURCE}`);
  }
}
