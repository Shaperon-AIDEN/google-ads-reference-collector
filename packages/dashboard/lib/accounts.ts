import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { schema } from '@adref/core';
import { and, eq, gt } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { db } from './db';

/**
 * 회원가입/로그인/세션 — 외부 의존성 없이 Node 내장 crypto(scrypt) + DB 세션으로 구현.
 * 가입은 아래 화이트리스트 도메인 이메일만 허용한다.
 */
export const ALLOWED_SIGNUP_DOMAINS = ['nizcorp.com', 'shaperon.com'];

const SESSION_COOKIE = 'adref_session';
const SESSION_DAYS = 30;

export function isAllowedEmail(email: string): boolean {
  const m = /^[^\s@]+@([^\s@]+)$/.exec(email.trim().toLowerCase());
  return !!m && ALLOWED_SIGNUP_DOMAINS.includes(m[1]!);
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/** 로그인 성공 시 세션 발급 + httpOnly 쿠키 설정 */
export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db().insert(schema.userSessions).values({ token, userId, expiresAt });
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (token) await db().delete(schema.userSessions).where(eq(schema.userSessions.token, token));
  cookies().delete(SESSION_COOKIE);
}

export interface SessionUser {
  id: string;
  email: string;
}

/** 현재 로그인 사용자 (없으면 null) — 서버 컴포넌트/라우트 핸들러에서 사용 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const rows = await db()
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.userSessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.userSessions.userId))
    .where(and(eq(schema.userSessions.token, token), gt(schema.userSessions.expiresAt, new Date())))
    .limit(1);
  return rows[0] ?? null;
}
