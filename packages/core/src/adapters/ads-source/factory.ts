import type { Env } from '../../config/env.js';
import { SerpApiAdsSource } from './serpapi.js';
import type { AdsSource } from './types.js';

/**
 * ADS_SOURCE 설정에 따라 데이터 소스 구현을 선택한다.
 * 현재는 serpapi 만 구현. SearchApi 등 추가 시 여기에 분기.
 */
export function createAdsSource(env: Env, fetchImpl?: typeof fetch): AdsSource {
  switch (env.ADS_SOURCE) {
    case 'serpapi':
      return new SerpApiAdsSource({ apiKey: env.SERPAPI_KEY ?? '', fetchImpl });
    default:
      throw new Error(`알 수 없는 ADS_SOURCE: ${env.ADS_SOURCE}`);
  }
}
