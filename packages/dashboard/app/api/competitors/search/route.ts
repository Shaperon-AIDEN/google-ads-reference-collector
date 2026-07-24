import { NextResponse } from 'next/server';
import { adsSource } from '@/lib/adsSource';

/** POST /api/competitors/search — 도메인으로 광고주 후보 탐색 (SerpApi, 서버 전용) */
export async function POST(req: Request) {
  let body: { domain?: string; region?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청' }, { status: 400 });
  }

  const domain = (body.domain ?? '').trim();
  if (!domain) return NextResponse.json({ error: '도메인을 입력하세요' }, { status: 400 });

  try {
    const { candidates, apiCalls } = await adsSource().searchAdvertisersByDomain({
      domain,
      region: body.region,
    });
    return NextResponse.json({ candidates, apiCalls });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // SerpApi "결과 없음" 은 사용자에게 빈 목록으로 안내
    if (/결과|no results|hasn't returned/i.test(message)) {
      return NextResponse.json({ candidates: [], apiCalls: 1, notice: '해당 도메인의 광고를 찾지 못했습니다.' });
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
