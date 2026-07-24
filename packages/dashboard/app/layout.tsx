import type { Metadata } from 'next';
import Link from 'next/link';
import { currentUser } from '@/lib/auth';
import './globals.css';

export const metadata: Metadata = {
  title: '광고 레퍼런스 수집기',
  description: '경쟁사 구글 광고 레퍼런스 수집·조회 대시보드',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const user = currentUser();
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
          <span className="user">{user.name}</span>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
