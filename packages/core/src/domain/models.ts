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
}
