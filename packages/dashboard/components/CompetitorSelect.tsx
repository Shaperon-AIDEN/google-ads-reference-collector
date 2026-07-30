'use client';

import { useRouter } from 'next/navigation';

/**
 * 경쟁사 필터 드롭다운. 선택 시 다른 필터(정렬·형식·기간 등)를 보존한 채 URL 만 갱신한다.
 * (경쟁사가 늘어나면 칩 나열이 길어져 드롭다운으로 전환 — 2026-07-30)
 */
export default function CompetitorSelect({
  competitors,
  value,
  baseParams,
}: {
  competitors: Array<{ id: string; label: string; adCount: number }>;
  value: string;
  /** competitor 를 제외한 현재 필터 파라미터 (선택 시 보존) */
  baseParams: Record<string, string>;
}) {
  const router = useRouter();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const p = new URLSearchParams(baseParams);
    if (e.target.value) p.set('competitor', e.target.value);
    const q = p.toString();
    router.push(q ? `/?${q}` : '/');
  }

  return (
    <select
      value={value}
      onChange={onChange}
      style={{
        background: 'var(--panel2, #222)',
        color: 'var(--text)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '4px 10px',
        fontSize: 13,
        cursor: 'pointer',
      }}
    >
      <option value="">전체 ({competitors.reduce((n, c) => n + c.adCount, 0)})</option>
      {competitors.map((c) => (
        <option key={c.id} value={c.id}>
          {c.label} ({c.adCount}){c.adCount === 0 ? ' — 미수집' : ''}
        </option>
      ))}
    </select>
  );
}
