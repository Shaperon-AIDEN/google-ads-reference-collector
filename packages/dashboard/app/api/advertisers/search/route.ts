import { NextResponse } from 'next/server';
import { advertiserSearch } from '@/lib/advertiserSearch';

/** POST /api/advertisers/search — 회사명으로 광고주 후보 자동완성 (SerpApi 쿼터 미사용) */
export async function POST(req: Request) {
  let body: { name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청' }, { status: 400 });
  }
  const name = (body.name ?? '').trim();
  if (!name) return NextResponse.json({ error: '회사명을 입력하세요' }, { status: 400 });

  try {
    const suggestions = await advertiserSearch().searchByName(name, { limit: 10 });
    return NextResponse.json({ suggestions });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
