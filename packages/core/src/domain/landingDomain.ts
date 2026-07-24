/**
 * 랜딩 URL 에서 등록 도메인 수준의 호스트를 추출한다 (www 제거).
 * 일부 광고는 도메인 수준만 제공되므로, 전체 URL 또는 도메인 문자열 모두 허용한다.
 * 매칭 실패 시 null.
 */
export function landingDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = input.trim();
  if (!raw) return null;

  // 스킴이 없으면 붙여서 URL 파싱을 시도
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const host = new URL(candidate).hostname.replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}
