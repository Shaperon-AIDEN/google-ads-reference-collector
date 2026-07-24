import { CompetitorRepository } from '@adref/core';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { listCompetitors } from '@/lib/queries';

/** GET /api/competitors — 전체 경쟁사 목록(수집 광고 수 포함) */
export async function GET() {
  return NextResponse.json({ competitors: await listCompetitors() });
}

/** POST /api/competitors — 선택한 광고주를 경쟁사로 등록 (1건 이상) */
export async function POST(req: Request) {
  let body: {
    domain?: string;
    region?: string;
    advertisers?: Array<{ advertiserId: string; advertiser: string }>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청' }, { status: 400 });
  }

  const advertisers = body.advertisers ?? [];
  if (advertisers.length === 0) {
    return NextResponse.json({ error: '등록할 광고주를 선택하세요' }, { status: 400 });
  }

  const repo = new CompetitorRepository(db());
  const registered = [];
  for (const a of advertisers) {
    if (!a.advertiserId) continue;
    const saved = await repo.upsert({
      name: a.advertiser || a.advertiserId,
      advertiserId: a.advertiserId,
      domain: body.domain ?? null,
      region: body.region ?? 'KR',
      isActive: true,
    });
    registered.push(saved);
  }
  return NextResponse.json({ registered }, { status: 201 });
}
