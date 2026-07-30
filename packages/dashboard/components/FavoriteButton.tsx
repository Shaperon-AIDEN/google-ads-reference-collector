'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * 광고 즐겨찾기 토글(♥). 비로그인 시 클릭하면 로그인 페이지로 안내.
 * 카드 안에서는 <Link> 네비게이션을 막아야 하므로 preventDefault/stopPropagation.
 */
export default function FavoriteButton({
  adId,
  initialFav,
  loggedIn,
  compact = false,
}: {
  adId: string;
  initialFav: boolean;
  loggedIn: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [fav, setFav] = useState(initialFav);
  const [busy, setBusy] = useState(false);

  async function onToggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    if (!loggedIn) {
      router.push('/login');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/favorites/${adId}`, { method: fav ? 'DELETE' : 'POST' });
      if (res.ok) setFav(!fav);
      else if (res.status === 401) router.push('/login');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={busy}
      title={loggedIn ? (fav ? '즐겨찾기 해제' : '즐겨찾기') : '로그인 후 즐겨찾기'}
      style={
        compact
          ? {
              position: 'absolute',
              top: 6,
              right: 40, // 삭제(✕) 버튼 왼쪽
              padding: '2px 8px',
              fontSize: 12,
              lineHeight: 1.6,
              background: 'rgba(0,0,0,.65)',
              color: fav ? '#e0245e' : '#fff',
              border: '1px solid rgba(255,255,255,.25)',
              borderRadius: 6,
              cursor: 'pointer',
            }
          : {
              background: 'var(--panel2)',
              border: '1px solid var(--border)',
              color: fav ? '#e0245e' : 'var(--text)',
            }
      }
    >
      {fav ? '♥' : '♡'}{!compact && (fav ? ' 즐겨찾기됨' : ' 즐겨찾기')}
    </button>
  );
}
