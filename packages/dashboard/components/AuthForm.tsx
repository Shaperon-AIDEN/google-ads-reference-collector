'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** 로그인/회원가입 공용 폼 — 성공 시 목록으로 이동 */
export default function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `실패 (${res.status})`);
        return;
      }
      router.push('/');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="panel" style={{ maxWidth: 380, margin: '48px auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h1 style={{ margin: 0, fontSize: 20 }}>{mode === 'login' ? '로그인' : '회원가입'}</h1>
      {mode === 'signup' && (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          @nizcorp.com · @shaperon.com 이메일만 가입할 수 있습니다.
        </p>
      )}
      <input
        type="email"
        required
        placeholder="이메일"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
      />
      <input
        type="password"
        required
        minLength={8}
        placeholder="비밀번호 (8자 이상)"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
      />
      {error && <p style={{ color: '#e0245e', margin: 0, fontSize: 13 }}>{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? '처리 중…' : mode === 'login' ? '로그인' : '가입하기'}
      </button>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        {mode === 'login' ? (
          <>계정이 없으신가요? <Link href="/signup">회원가입</Link></>
        ) : (
          <>이미 계정이 있으신가요? <Link href="/login">로그인</Link></>
        )}
      </p>
    </form>
  );
}
