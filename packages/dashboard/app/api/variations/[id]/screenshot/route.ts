import { schema } from '@adref/core';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 대안 스크린샷 PNG 스트리밍 — bytea 를 그대로 반환 (원본 픽셀) */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!UUID.test(params.id)) return NextResponse.json({ error: '잘못된 id' }, { status: 400 });

  const v = schema.adVariations;
  const rows = await db().select({ screenshot: v.screenshot }).from(v).where(eq(v.id, params.id)).limit(1);
  const png = rows[0]?.screenshot;
  if (!png) return NextResponse.json({ error: '스크린샷 없음' }, { status: 404 });

  return new Response(new Uint8Array(png), {
    headers: {
      'content-type': 'image/png',
      // 스크린샷은 재캡처 전까지 불변 — 캐시 허용
      'cache-control': 'public, max-age=3600',
    },
  });
}
