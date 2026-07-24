'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** 온보딩 선택 UI 공통 후보 (이름/도메인 검색 결과를 정규화) */
interface Candidate {
  advertiserId: string;
  advertiser: string;
  region?: string;
  adInfo: string; // "광고 600~700" 등 표시용
}

type Mode = 'name' | 'domain';

/**
 * 경쟁사 온보딩: 회사명(기본) 또는 도메인으로 광고주 후보를 찾아 선택·등록.
 * - 이름 검색: Google 투명성 자동완성 (SerpApi 쿼터 미사용)
 * - 도메인 검색: SerpApi 도메인 검색
 * 한 브랜드에 여러 광고주(법인·지사)가 나오므로 사용자가 선택한다.
 */
export default function CompetitorOnboarding() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('name');
  const [query, setQuery] = useState('');
  const [region, setRegion] = useState('KR');
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function search() {
    setLoading(true);
    setError(null);
    setNotice(null);
    setCandidates(null);
    setSelected(new Set());
    try {
      let list: Candidate[] = [];
      if (mode === 'name') {
        const res = await fetch('/api/advertisers/search', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: query.trim() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? '검색 실패');
        list = (data.suggestions ?? []).map((s: { advertiserId: string; advertiser: string; region?: string; adCountLow?: number; adCountHigh?: number }) => ({
          advertiserId: s.advertiserId,
          advertiser: s.advertiser,
          region: s.region,
          adInfo: s.adCountLow != null ? `광고 ${s.adCountLow.toLocaleString()}~${(s.adCountHigh ?? s.adCountLow).toLocaleString()}` : '',
        }));
      } else {
        const res = await fetch('/api/competitors/search', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ domain: query.trim(), region }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? '검색 실패');
        if (data.notice) setNotice(data.notice);
        list = (data.candidates ?? []).map((c: { advertiserId: string; advertiser: string; adCount: number }) => ({
          advertiserId: c.advertiserId,
          advertiser: c.advertiser,
          adInfo: `광고 ${c.adCount}건`,
        }));
      }
      setCandidates(list);
      if (list.length === 0 && !notice) setNotice('해당 조건으로 광고주를 찾지 못했습니다.');
      if (list.length) setSelected(new Set([list[0]!.advertiserId])); // 상위 후보 기본 선택
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
      // 이름 검색은 후보의 region 을, 도메인 검색은 선택한 region 을 사용
      const reg = mode === 'name' ? (advertisers[0]!.region ?? region) : region;
      const res = await fetch('/api/competitors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          domain: mode === 'domain' ? query.trim() : null,
          region: reg,
          advertisers: advertisers.map((a) => ({ advertiserId: a.advertiserId, advertiser: a.advertiser })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '등록 실패');
      setQuery('');
      setCandidates(null);
      setSelected(new Set());
      setNotice(`${data.registered?.length ?? 0}개 광고주를 등록했습니다.`);
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

      <div className="row" style={{ marginBottom: 10 }}>
        <span className="muted">검색 방식:</span>
        <button className={mode === 'name' ? '' : 'secondary'} onClick={() => { setMode('name'); setCandidates(null); }}>
          회사명
        </button>
        <button className={mode === 'domain' ? '' : 'secondary'} onClick={() => { setMode('domain'); setCandidates(null); }}>
          도메인
        </button>
      </div>

      <div className="row">
        <input
          style={{ flex: 1, minWidth: 220 }}
          placeholder={mode === 'name' ? '회사명 (예: 드래프터)' : '도메인 (예: coupang.com)'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && query.trim() && search()}
        />
        {mode === 'domain' && (
          <select value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="KR">한국</option>
            <option value="US">미국</option>
            <option value="JP">일본</option>
          </select>
        )}
        <button onClick={search} disabled={loading || !query.trim()}>
          {loading ? '검색 중…' : '광고주 검색'}
        </button>
      </div>

      {error && <p style={{ color: 'var(--err)' }}>{error}</p>}
      {notice && <p className="muted">{notice}</p>}

      {candidates && candidates.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <p className="muted">광고주 후보입니다. 등록할 광고주를 선택하세요 (복수 선택 가능).</p>
          {candidates.map((c) => (
            <div
              key={c.advertiserId}
              className={`candidate ${selected.has(c.advertiserId) ? 'selected' : ''}`}
              onClick={() => toggle(c.advertiserId)}
              role="button"
            >
              <input type="checkbox" checked={selected.has(c.advertiserId)} readOnly />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>
                  {c.advertiser} {c.region && <span className="muted" style={{ fontWeight: 400 }}>· {c.region}</span>}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {c.advertiserId} {c.adInfo && `· ${c.adInfo}`}
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
