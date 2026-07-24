import { NextResponse } from 'next/server';
import { env } from '@/lib/env';

/**
 * POST /api/competitors/:id/collect — 온디맨드 수집 트리거.
 * 서버 측에서 Functions HTTP 엔드포인트로 프록시 (CORS 회피, URL 은 서버에만).
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const base = env().FUNCTIONS_BASE_URL.replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/collectForCompetitor`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ competitorId: params.id }),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Functions 호스트가 꺼져 있으면 안내
    return NextResponse.json(
      { error: `수집기 호출 실패 (Functions 호스트가 실행 중인지 확인): ${message}` },
      { status: 502 },
    );
  }
}
