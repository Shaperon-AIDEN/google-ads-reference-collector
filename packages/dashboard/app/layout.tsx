import type { Metadata } from 'next';
import Link from 'next/link';
import LogoutButton from '@/components/LogoutButton';
import { getSessionUser } from '@/lib/accounts';
import './globals.css';

export const metadata: Metadata = {
  title: '광고 레퍼런스 수집기',
  description: '경쟁사 구글 광고 레퍼런스 수집·조회 대시보드',
};

export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  return (
    <html lang="ko">
      <body>
        <header className="topbar">
          <nav className="nav">
            <span className="brand">📊 광고 레퍼런스</span>
            <Link href="/">레퍼런스</Link>
            <Link href="/competitors">경쟁사 관리</Link>
            <Link href="/runs">수집 현황</Link>
          </nav>
          <span className="user" style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}>
            {user ? (
              <>
                <Link href="/?fav=1" title="내 즐겨찾기만 보기">♥ 즐겨찾기</Link>
                <span>{user.email}</span>
                <LogoutButton />
              </>
            ) : (
              <>
                <Link href="/login">로그인</Link>
                <Link href="/signup">회원가입</Link>
              </>
            )}
          </span>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
