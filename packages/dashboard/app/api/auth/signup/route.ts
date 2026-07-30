import { schema } from '@adref/core';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { ALLOWED_SIGNUP_DOMAINS, createSession, hashPassword, isAllowedEmail } from '@/lib/accounts';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** 회원가입 — 화이트리스트 도메인(nizcorp.com·shaperon.com) 이메일만 허용 */
export async function POST(req: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청' }, { status: 400 });
  }
  const email = (body.email ?? '').trim().toLowerCase();
  const password = body.password ?? '';

  if (!isAllowedEmail(email)) {
    return NextResponse.json(
      { error: `가입 가능한 이메일 도메인: ${ALLOWED_SIGNUP_DOMAINS.map((d) => '@' + d).join(', ')}` },
      { status: 400 },
    );
  }
  if (password.length < 8) {
    return NextResponse.json({ error: '비밀번호는 8자 이상이어야 합니다' }, { status: 400 });
  }

  const existing = await db().select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (existing.length > 0) {
    return NextResponse.json({ error: '이미 가입된 이메일입니다' }, { status: 409 });
  }

  const rows = await db()
    .insert(schema.users)
    .values({ email, passwordHash: hashPassword(password) })
    .returning({ id: schema.users.id });
  await createSession(rows[0]!.id);
  return NextResponse.json({ ok: true });
}
