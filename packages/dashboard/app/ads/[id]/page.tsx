import Link from 'next/link';
import { notFound } from 'next/navigation';
import DeleteAdButton from '@/components/DeleteAdButton';
import { getAd, getAdVariations, type AdVariationView } from '@/lib/queries';

export const dynamic = 'force-dynamic';

function fmt(n: number | null): string {
  return n == null ? '—' : n.toLocaleString();
}
function fmtShort(v: number): string {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (v >= 1_000) return (v / 1_000).toFixed(1) + 'K';
  return String(Math.round(v));
}

/** 일별 증가량 꺾은선 그래프 (SVG, 서버 렌더) */
function DailyGrowthChart({
  points,
  color = 'var(--accent)',
  label = '일별 증가량',
}: {
  points: Array<{ date: string; delta: number }>;
  color?: string;
  label?: string;
}) {
  const W = 680;
  const H = 240;
  const padL = 52;
  const padR = 16;
  const padT = 16;
  const padB = 44;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const maxDelta = Math.max(1, ...points.map((p) => p.delta));
  const x = (i: number) => (points.length <= 1 ? padL + innerW / 2 : padL + (i / (points.length - 1)) * innerW);
  const y = (v: number) => padT + innerH - (v / maxDelta) * innerH;
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.delta).toFixed(1)}`).join(' ');

  // Y축 눈금 3단계
  const ticks = [0, 0.5, 1].map((f) => Math.round(maxDelta * f));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label={label}>
      {/* Y축 눈금·격자 */}
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} y1={y(t)} x2={W - padR} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
          <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">
            {fmtShort(t)}
          </text>
        </g>
      ))}
      {/* 증가량 라인 */}
      <path d={line} fill="none" stroke={color} strokeWidth="2" />
      {/* 점 + 값 라벨 + 날짜 */}
      {points.map((p, i) => (
        <g key={p.date}>
          <circle cx={x(i)} cy={y(p.delta)} r="3.5" fill={color} />
          <text x={x(i)} y={y(p.delta) - 8} textAnchor="middle" fontSize="11" fill="var(--text)">
            ▲{fmtShort(p.delta)}
          </text>
          <text x={x(i)} y={H - padB + 18} textAnchor="middle" fontSize="10" fill="var(--muted)">
            {p.date.slice(5)}
          </text>
        </g>
      ))}
    </svg>
  );
}

/**
 * 검색형 텍스트 광고 렌더 — 투명성 센터가 검색 광고를 보여주는 모습 그대로
 * (도메인 헤더 + 파란 헤드라인 + 회색 설명). 이미지 자산이 없는 텍스트 광고용.
 */
function SearchAdCard({
  url,
  headline,
  description,
  width = 420,
}: {
  url: string | null;
  headline: string | null;
  description: string | null;
  width?: number;
}) {
  const domain = url ? url.replace(/^https?:\/\//, '').replace(/\/$/, '') + '/' : null;
  return (
    <div style={{ width, maxWidth: '100%', background: '#fff', borderRadius: 12, border: '1px solid var(--border)', padding: '18px 20px' }}>
      {domain && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span
            aria-hidden
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: '#e8f0fe',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 15,
            }}
          >
            🌐
          </span>
          <span style={{ color: '#202124', fontSize: 14 }}>{domain}</span>
        </div>
      )}
      {headline && (
        <div style={{ color: '#1a4fd6', fontSize: 22, fontWeight: 500, lineHeight: 1.35, marginBottom: 10 }}>{headline}</div>
      )}
      {description && <div style={{ color: '#4d5156', fontSize: 15, lineHeight: 1.5 }}>{description}</div>}
    </div>
  );
}

/** 대안 1건 렌더 — 실제 광고 단위 크기의 흰 카드로 조합 (대안마다 사이즈·문구가 다르다) */
function VariationCard({ v, format }: { v: AdVariationView; format: string }) {
  const w = v.width && v.width > 0 ? Math.min(v.width, 480) : 300;
  const label = `대안 ${v.idx + 1}${v.width && v.height ? ` · ${v.width}×${v.height}` : ''}`;
  // 검색형 텍스트 대안: 이미지 자산이 없으므로 검색 광고 스타일로 렌더
  if (format === 'text' && !v.imageUrl && (v.headline || v.description)) {
    return (
      <div style={{ flexShrink: 0 }}>
        <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>{label}</div>
        <SearchAdCard url={v.landingUrl} headline={v.headline} description={v.description} width={Math.max(w, 380)} />
      </div>
    );
  }
  return (
    <div style={{ flexShrink: 0 }}>
      <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>{label}</div>
      <div
        style={{
          width: w,
          background: '#fff',
          color: '#202124',
          borderRadius: 10,
          overflow: 'hidden',
          border: '1px solid var(--border)',
        }}
      >
        {v.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={v.imageUrl} alt="" style={{ display: 'block', width: '100%' }} />
        )}
        {(v.headline || v.description || v.ctaText) && (
          <div style={{ padding: '14px 14px 10px' }}>
            {v.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={v.logoUrl} alt="" style={{ display: 'block', maxHeight: 24, maxWidth: 120, marginBottom: 10 }} />
            )}
            {v.headline && <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.3, marginBottom: 8 }}>{v.headline}</div>}
            {v.description && <div style={{ fontSize: 13, lineHeight: 1.45, color: '#5f6368' }}>{v.description}</div>}
            {v.ctaText && (
              <div style={{ borderTop: '1px solid #e8eaed', marginTop: 12, paddingTop: 8, textAlign: 'right', fontWeight: 600, fontSize: 13 }}>
                {v.ctaText} <span aria-hidden>›</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default async function AdDetailPage({ params }: { params: { id: string } }) {
  const ad = await getAd(params.id);
  if (!ad) notFound();
  const variations = await getAdVariations(params.id);
  // 검색형 텍스트 광고(이미지 자산 없음)는 검색 광고 스타일로 렌더
  const searchStyle = !ad.youtubeVideoId && !ad.imageUrl && ad.format === 'text' && !!(ad.headline || ad.description);

  // 일별 증가량 = 해당 스냅샷 조회수 − 직전 스냅샷 조회수 (음수 방지)
  const deltas: Array<{ date: string; delta: number }> = [];
  for (let i = 1; i < ad.metrics.length; i++) {
    const prev = ad.metrics[i - 1]!.views ?? 0;
    const cur = ad.metrics[i]!.views ?? 0;
    deltas.push({ date: ad.metrics[i]!.date, delta: Math.max(0, cur - prev) });
  }

  // 좋아요: 총 좋아요(최신 스냅샷) + 일별 증가량 (조회수와 동일 원리)
  const latestLikes = [...ad.metrics].reverse().find((m) => m.likes != null)?.likes ?? null;
  const likeDeltas: Array<{ date: string; delta: number }> = [];
  for (let i = 1; i < ad.metrics.length; i++) {
    const prev = ad.metrics[i - 1]!.likes ?? 0;
    const cur = ad.metrics[i]!.likes ?? 0;
    likeDeltas.push({ date: ad.metrics[i]!.date, delta: Math.max(0, cur - prev) });
  }

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <p style={{ margin: 0 }}><Link href="/">← 레퍼런스 목록</Link></p>
        {/* 잘못 수집된 광고 정리 — 삭제 후 목록으로 이동 */}
        <DeleteAdButton adId={ad.id} label="이 광고 삭제" redirectTo="/" />
      </div>
      <h1>{ad.competitorName} <span className={`badge ${ad.format}`}>{ad.format}</span></h1>

      {/* 광고 미리보기 — 배너/영상은 패널 폭 그대로 크게 표시(원래 크기 유지),
          문구·CTA·로고는 그 아래 원본 광고 구성으로 렌더링. */}
      <div className="panel">
        {ad.youtubeVideoId ? (
          // 비디오(YouTube): 임베드 재생
          <div style={{ position: 'relative', paddingTop: '56.25%' }}>
            <iframe
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, borderRadius: 8 }}
              src={`https://www.youtube.com/embed/${ad.youtubeVideoId}`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : ad.imageUrl ? (
          // 이미지 광고: 크리에이티브 이미지 표시
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ad.imageUrl} alt={ad.headline ?? ad.creativeId} style={{ maxWidth: '100%', borderRadius: 8 }} />
        ) : searchStyle ? (
          // 검색형 텍스트 광고 — 투명성 센터의 검색 광고 렌더링 재현 (도메인 + 파란 헤드라인 + 설명)
          <SearchAdCard url={ad.landingUrl ?? (ad.landingDomain ? `https://${ad.landingDomain}` : null)} headline={ad.headline} description={ad.description} width={480} />
        ) : null}

        {/* 배너 아래 텍스트 영역 — 원본 광고와 동일한 구성 (검색형은 위 카드가 전부 표현) */}
        {!searchStyle && (ad.headline || ad.description || ad.ctaText) && (
          <div style={{ maxWidth: 720, marginTop: 18 }}>
            {ad.logoUrl ? (
              // 브랜드 로고 — 원본 광고처럼 헤드라인 위에 표시
              // eslint-disable-next-line @next/next/no-img-element
              <img src={ad.logoUrl} alt="브랜드 로고" style={{ display: 'block', maxHeight: 36, maxWidth: 200, marginBottom: 12 }} />
            ) : (
              <div className="muted" style={{ fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>
                {ad.landingDomain ?? ad.competitorName}
              </div>
            )}
            {ad.headline && (
              <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.25, marginBottom: 10 }}>{ad.headline}</div>
            )}
            {ad.description && (
              <div className="muted" style={{ fontSize: 15, lineHeight: 1.5 }}>{ad.description}</div>
            )}
            {ad.ctaText && (
              <div style={{ borderTop: '1px solid var(--border)', marginTop: 16, paddingTop: 12, fontWeight: 600 }}>
                {ad.ctaText} <span aria-hidden>›</span>
              </div>
            )}
          </div>
        )}

        {/* 영상·이미지·문구가 모두 없으면 원본 링크로 안내 */}
        {!ad.youtubeVideoId && !ad.imageUrl && !ad.headline && !ad.description && (
          <div>
            <p className="muted">
              {ad.format === 'video'
                ? 'YouTube 외 영상은 원본 링크로 확인합니다 (스트림 URL 은 만료될 수 있음).'
                : '이 광고의 미리보기는 투명성 센터 원본에서 확인합니다.'}
            </p>
            <div className="row">
              <a
                href={`https://adstransparency.google.com/advertiser/${ad.advertiserId}/creative/${ad.creativeId}`}
                target="_blank"
                rel="noreferrer"
              >
                <button>투명성 센터에서 보기 ↗</button>
              </a>
            </div>
          </div>
        )}
      </div>

      {/* 대안 — 한 광고의 variation 들 (대안마다 사이즈·문구·CTA 가 다르다). 가로 스크롤. */}
      {variations.length > 0 && (
        <>
          <h2>대안 ({variations.length})</h2>
          <div style={{ display: 'flex', gap: 16, overflowX: 'auto', paddingBottom: 8, alignItems: 'flex-start' }}>
            {variations.map((v) => (
              <VariationCard key={v.id} v={v} format={ad.format} />
            ))}
          </div>
        </>
      )}

      <div className="panel">
        <table>
          <tbody>
            <tr><th>게재 기간</th><td>{ad.firstShown ?? '—'} ~ {ad.lastShown ?? '—'} ({ad.daysShown ?? '—'}일)</td></tr>
            {ad.format === 'video' && <tr><th>총 조회수</th><td>{fmt(ad.latestViews)}</td></tr>}
            {ad.format === 'video' && <tr><th>총 좋아요</th><td>{fmt(latestLikes)}</td></tr>}
            {ad.headline && <tr><th>헤드라인</th><td>{ad.headline}</td></tr>}
            {ad.description && <tr><th>설명</th><td>{ad.description}</td></tr>}
            {ad.ctaText && <tr><th>CTA</th><td>{ad.ctaText}</td></tr>}
            <tr><th>랜딩 URL</th><td>{ad.landingUrl ? <a href={ad.landingUrl} target="_blank" rel="noreferrer">{ad.landingUrl}</a> : '—'}</td></tr>
            <tr><th>랜딩 도메인</th><td>{ad.landingDomain ?? '—'}</td></tr>
            <tr><th>크리에이티브 ID</th><td style={{ fontFamily: 'monospace', fontSize: 12 }}>{ad.creativeId}</td></tr>
            <tr>
              <th>투명성 센터</th>
              <td>
                <a
                  href={`https://adstransparency.google.com/advertiser/${ad.advertiserId}/creative/${ad.creativeId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  원본 광고 보기 ↗
                </a>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {ad.format === 'video' && (
        <>
          <h2>일별 조회수 증가량</h2>
          {deltas.length === 0 ? (
            <p className="muted">
              {ad.metrics.length === 0
                ? '아직 조회수 스냅샷이 없습니다. (YouTube 영상 광고만 조회수가 수집됩니다)'
                : '일별 증가량은 조회수 스냅샷이 2개 이상 쌓이면 표시됩니다. (매일 자동 수집으로 누적)'}
            </p>
          ) : (
            <div className="panel">
              <DailyGrowthChart points={deltas} label="일별 조회수 증가량" />
            </div>
          )}

          <h2>일별 좋아요 증가량</h2>
          {likeDeltas.length === 0 || likeDeltas.every((p) => p.delta === 0) ? (
            <p className="muted">
              {ad.metrics.length < 2
                ? '일별 좋아요 증가량은 스냅샷이 2개 이상 쌓이면 표시됩니다. (매일 자동 수집으로 누적)'
                : '집계 기간 동안 좋아요 증가가 없습니다. (좋아요 비공개 영상은 표시되지 않을 수 있음)'}
            </p>
          ) : (
            <div className="panel">
              <DailyGrowthChart points={likeDeltas} color="#e0245e" label="일별 좋아요 증가량" />
            </div>
          )}
        </>
      )}

      {ad.format !== 'video' && (
        <p className="muted" style={{ fontSize: 13 }}>
          텍스트·이미지 광고는 조회수·좋아요 지표를 제공하지 않습니다 (투명성 센터·YouTube 모두 상업 광고의 조회/클릭 수를 공개하지 않음).
        </p>
      )}
    </>
  );
}
