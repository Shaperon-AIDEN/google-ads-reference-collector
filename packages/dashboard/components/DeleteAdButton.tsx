'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * 광고 삭제 버튼. 잘못 수집된 광고(로고·이미지 없음 등)를 목록/상세에서 바로 정리한다.
 * 확인 후 DELETE /api/ads/:id → 성공 시 목록 갱신(router.refresh) 또는 지정 경로로 이동.
 * 카드 안에 쓸 때는 Link 내부 클릭 전파를 막아야 하므로 stopPropagation/preventDefault 처리.
 */
export default function DeleteAdButton({
  adId,
  label = '삭제',
  redirectTo,
  compact = false,
}: {
  adId: string;
  label?: string;
  /** 삭제 후 이동할 경로 (상세 페이지에서 사용). 없으면 현재 목록만 갱신 */
  redirectTo?: string;
  /** 카드 오버레이용 소형 스타일 */
  compact?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onDelete(e: React.MouseEvent) {
    // 카드가 <Link> 로 감싸져 있으므로 네비게이션을 막는다
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    if (!confirm('이 광고를 삭제할까요? (다음 수집 때 신규로 다시 들어올 수 있습니다)')) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/ads/${adId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(`삭제 실패: ${data.error ?? res.status}`);
        return;
      }
      // ⚠️ 여기서 버튼을 숨기는 로컬 상태(gone)를 두면 안 된다 — router.refresh() 후 같은 자리에
      // 온 "다른 광고"에 클라이언트 상태가 남아 삭제 버튼이 사라진 채 유지된다(실측 버그).
      // 삭제된 카드는 서버 갱신으로 목록에서 없어지므로 숨김 상태가 필요 없다.
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    } catch (err) {
      alert(`삭제 실패: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onDelete}
      disabled={busy}
      title="이 광고 삭제"
      style={
        compact
          ? {
              position: 'absolute',
              top: 6,
              right: 6,
              padding: '2px 8px',
              fontSize: 12,
              lineHeight: 1.6,
              background: 'rgba(0,0,0,.65)',
              color: '#fff',
              border: '1px solid rgba(255,255,255,.25)',
              borderRadius: 6,
              cursor: busy ? 'not-allowed' : 'pointer',
            }
          : { background: 'var(--panel2)', border: '1px solid var(--border)', color: 'var(--text)' }
      }
    >
      {busy ? '삭제 중…' : label}
    </button>
  );
}
