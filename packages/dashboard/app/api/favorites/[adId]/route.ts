import { schema } from '@adref/core';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/accounts';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 즐겨찾기 추가 (멱등) */
export async function POST(_req: Request, { params }: { params: { adId: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 });
  if (!UUID.test(params.adId)) return NextResponse.json({ error: '잘못된 id' }, { status: 400 });

  await db().insert(schema.adFavorites).values({ userId: user.id, adId: params.adId }).onConflictDoNothing();
  return NextResponse.json({ ok: true, fav: true });
}

/** 즐겨찾기 해제 */
export async function DELETE(_req: Request, { params }: { params: { adId: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 });
  if (!UUID.test(params.adId)) return NextResponse.json({ error: '잘못된 id' }, { status: 400 });

  await db()
    .delete(schema.adFavorites)
    .where(and(eq(schema.adFavorites.userId, user.id), eq(schema.adFavorites.adId, params.adId)));
  return NextResponse.json({ ok: true, fav: false });
}
