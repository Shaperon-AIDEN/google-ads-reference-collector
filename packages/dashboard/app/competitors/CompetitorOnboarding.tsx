'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Candidate {
  advertiserId: string;
  advertiser: string;
  adCount: number;
  sampleThumbnail?: string;
}

/**
 * 경쟁사 온보딩: 도메인 입력 → SerpApi 광고주 후보 탐색 → 선택(복수) → 등록.
 * 한 도메인에 여러 광고주(본사·지사)가 나오므로 사용자가 선택한다.
 */
export default function CompetitorOnboarding() {
  const router = useRouter();
  const [domain, setDomain] = useState('');
  const [region, setRegion] = useState('KR');
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    setLoading(true);
    setError(null);
    setNotice(null);
    setCandidates(null);
    setSelected(new Set());
    try {
      const res = await fetch('/api/competitors/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain: domain.trim(), region }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '탐색 실패');
      setCandidates(data.candidates);
      if (data.notice) setNotice(data.notice);
      // 광고 수 1위(대개 본사)를 기본 선택
      if (data.candidates?.length) setSelected(new Set([data.candidates[0].advertiserId]));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function register() {
    if (!candidates) return;
    const advertisers = candidates.filter((c) => selected.has(c.advertiserId));
    if (advertisers.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/competitors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain: domain.trim(), region, advertisers }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '등록 실패');
      // 초기화 후 목록 새로고침
      setDomain('');
      setCandidates(null);
      setSelected(new Set());
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>경쟁사 추가</h2>
      <div className="row">
        <input
          style={{ flex: 1, minWidth: 220 }}
          placeholder="경쟁사 도메인 (예: coupang.com)"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && domain.trim() && search()}
        />
        <select value={region} onChange={(e) => setRegion(e.target.value)}>
          <option value="KR">한국</option>
          <option value="US">미국</option>
          <option value="JP">일본</option>
        </select>
        <button onClick={search} disabled={loading || !domain.trim()}>
          {loading ? '탐색 중…' : '광고주 탐색'}
        </button>
      </div>

      {error && <p style={{ color: 'var(--err)' }}>{error}</p>}
      {notice && <p className="muted">{notice}</p>}

      {candidates && candidates.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <p className="muted">이 도메인의 광고주 후보입니다. 등록할 광고주를 선택하세요 (복수 선택 가능).</p>
          {candidates.map((c) => (
            <div
              key={c.advertiserId}
              className={`candidate ${selected.has(c.advertiserId) ? 'selected' : ''}`}
              onClick={() => toggle(c.advertiserId)}
              role="button"
            >
              <input type="checkbox" checked={selected.has(c.advertiserId)} readOnly />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{c.advertiser}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {c.advertiserId} · 광고 {c.adCount}건
                </div>
              </div>
            </div>
          ))}
          <div className="row" style={{ marginTop: 12 }}>
            <button onClick={register} disabled={loading || selected.size === 0}>
              선택한 {selected.size}개 광고주 등록
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
