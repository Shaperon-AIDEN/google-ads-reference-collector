import { CompetitorRepository } from '@adref/core';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

/** PATCH /api/competitors/:id — 활성/비활성 전환 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  let body: { isActive?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청' }, { status: 400 });
  }
  if (typeof body.isActive !== 'boolean') {
    return NextResponse.json({ error: 'isActive(boolean) 필요' }, { status: 400 });
  }
  await new CompetitorRepository(db()).setActive(params.id, body.isActive);
  return NextResponse.json({ ok: true });
}

/** DELETE /api/competitors/:id — 경쟁사 삭제 (연관 광고·지표 cascade) */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  await new CompetitorRepository(db()).remove(params.id);
  return NextResponse.json({ ok: true });
}
