import { schema } from '@adref/core';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

const { ads } = schema;

/**
 * DELETE /api/ads/:id — 광고 1건 삭제 (ad_metrics 는 FK cascade 로 함께 삭제).
 * 잘못 수집된 광고(로고·이미지 없음 등)를 대시보드에서 바로 정리하기 위한 엔드포인트.
 * 삭제하면 creative_id 가 known 목록에서 빠지므로 다음 수집 시 신규로 재수집된다.
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return NextResponse.json({ error: '잘못된 id' }, { status: 400 });
  }
  const deleted = await db().delete(ads).where(eq(ads.id, params.id)).returning({ id: ads.id });
  if (deleted.length === 0) {
    return NextResponse.json({ error: '광고를 찾을 수 없습니다' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, id: deleted[0]!.id });
}
