/**
 * 파이프라인 전반에서 쓰는 도메인 값 타입. DB 스키마(schema.ts)와 별개로,
 * 어댑터·핸들러 간 계약을 표현한다.
 */

export type AdFormat = 'video' | 'image' | 'text';

/**
 * 수집·표시 스코프에 맞는 format 필터. COLLECT_FORMATS='video'(기본)이면 비디오만,
 * 'all'이면 전부 통과. 수집기·대시보드가 공통으로 사용해 스코프를 한 곳에서 제어한다.
 */
export function isFormatAllowed(format: AdFormat, scope: 'video' | 'all'): boolean {
  return scope === 'all' || format === 'video';
}

/**
 * 이미지 광고 크리에이티브 URL 판별(서버 안전망·URL 기반). 이미지 호스트(simgad/googleusercontent)만
 * 허용하고 HTML 자산(/pagead/·sadbundle·discover_ads)은 제외한다.
 * ⚠️ 로고 제외는 여기서 못 한다 — content.js 유래 광고 이미지는 로고와 **같은 `/simgad/` 경로**라
 * URL 로는 구분 불가하고 **크기로만** 판별된다(확장이 픽셀 측정으로 처리). 여기선 명백한 비이미지만 거른다.
 */
export function isRealCreativeUrl(u: string): boolean {
  // sadbundle(HTML5 번들)은 index.html 등 HTML 자산은 거부하되 **이미지 자산은 허용**
  // (번들 대표 이미지 추출, 실측). encrypted-tbn/t0~3.gstatic = 쇼핑 상품 이미지(쿼리가 식별자).
  if (/\/sadbundle\//.test(u)) return /\/archive\/sadbundle\/.*\.(?:jpe?g|png|webp|gif)$/i.test(u.split('?')[0]!);
  return (
    /\/simgad\/|googleusercontent\.com\/|(?:encrypted-tbn\d*|t\d)\.gstatic\.com\/(?:shopping|images)/.test(u) &&
    !/\/pagead\/|discover_ads/.test(u)
  );
}

/**
 * 상세 수집기 큐 메시지 본문 (목록 → 상세 수집기로 전달).
 * 실측상 format·게재일·게재일수는 목록에만 있으므로, 상세 수집기가 완전한 upsert 를
 * 할 수 있도록 목록 스냅샷을 함께 전달한다.
 */
export interface NewAdQueueMessage {
  competitorId: string;
  advertiserId: string;
  creativeId: string;
  format: AdFormat;
  firstShown?: string; // ISO date
  lastShown?: string; // ISO date
  daysShown?: number;
}

/** 광고 게재 기간 (지역별 다수 가능) */
export interface AdPeriod {
  start: string; // ISO date
  end?: string; // ISO date (미종료 시 없음)
}

/** 온디맨드 수집 요청 큐 메시지 ("지금 수집" → 백그라운드 처리) */
export interface CollectRequestMessage {
  competitorId: string;
  maxTotal?: number;
  /** 이어달리기(continuation) — 목록 순회가 시간예산을 넘기면 진행 지점을 담아 재적재한다.
   *  (Consumption 플랜 함수 타임아웃 대응: 172페이지 순회가 한 실행에 못 끝남, 실측) */
  pageToken?: string;
}
