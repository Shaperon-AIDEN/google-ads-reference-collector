/**
 * 다양한 YouTube URL 형태에서 11자리 video ID 를 추출한다.
 * 지원: watch?v=, youtu.be/, /embed/, /shorts/, /v/, 그리고 ID 원문.
 * 매칭 실패 시 null.
 */
const YT_ID = /^[A-Za-z0-9_-]{11}$/;

export function parseYouTubeId(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = input.trim();

  // 이미 순수 ID 인 경우
  if (YT_ID.test(raw)) return raw;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '');

  // youtu.be/<id>
  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0] ?? '';
    return YT_ID.test(id) ? id : null;
  }

  if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
    // watch?v=<id>
    const v = url.searchParams.get('v');
    if (v && YT_ID.test(v)) return v;

    // /embed/<id>, /shorts/<id>, /v/<id>
    const segments = url.pathname.split('/').filter(Boolean);
    const marker = segments.findIndex((s) => s === 'embed' || s === 'shorts' || s === 'v');
    if (marker >= 0) {
      const id = segments[marker + 1] ?? '';
      return YT_ID.test(id) ? id : null;
    }
  }

  return null;
}
