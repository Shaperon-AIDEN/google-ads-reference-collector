import { createAdsSource, type AdsSource } from '@adref/core';
import { env } from './env';

/** 서버 전용 광고 소스 어댑터 (SerpApi). 광고주 도메인 탐색에 사용. */
export function adsSource(): AdsSource {
  return createAdsSource(env());
}
