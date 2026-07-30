import { schema } from '@adref/core';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { createSession, verifyPassword } from '@/lib/accounts';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청' }, { status: 400 });
  }
  const email = (body.email ?? '').trim().toLowerCase();
  const password = body.password ?? '';

  const rows = await db()
    .select({ id: schema.users.id, passwordHash: schema.users.passwordHash })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  const user = rows[0];
  // 존재 여부를 구분해 알리지 않는다 (계정 열거 방지)
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json({ error: '이메일 또는 비밀번호가 올바르지 않습니다' }, { status: 401 });
  }

  await createSession(user.id);
  return NextResponse.json({ ok: true });
}
