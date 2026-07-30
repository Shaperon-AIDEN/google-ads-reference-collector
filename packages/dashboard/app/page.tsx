import Link from 'next/link';
import DeleteAdButton from '@/components/DeleteAdButton';
import { bestAds, listAds, listCompetitors, type AdCard, type AdSort, type BestAd, type BestPeriod } from '@/lib/queries';

export const dynamic = 'force-dynamic'; // 항상 최신 DB 반영

function thumbUrl(youtubeVideoId: string | null): string | null {
  return youtubeVideoId ? `https://i.ytimg.com/vi/${youtubeVideoId}/hqdefault.jpg` : null;
}

function fmtViews(v: number | null): string {
  if (v == null) return '—';
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (v >= 1_000) return (v / 1_000).toFixed(1) + 'K';
  return String(v);
}

const VIEW_PRESETS: Array<{ label: string; v: number }> = [
  { label: '전체', v: 0 },
  { label: '1천+', v: 1_000 },
  { label: '1만+', v: 10_000 },
  { label: '10만+', v: 100_000 },
  { label: '100만+', v: 1_000_000 },
];

const BEST_LABEL: Record<BestPeriod, string> = { day: '일간 베스트', week: '주간 베스트', month: '월간 베스트' };

function AdCardView({ ad, rank, growth }: { ad: AdCard; rank?: number; growth?: number | null }) {
  // 썸네일: 비디오=YouTube 썸네일, 이미지=크리에이티브 이미지, 텍스트=문구 미리보기
  const thumb = thumbUrl(ad.youtubeVideoId) ?? ad.imageUrl;
  const isVideo = ad.format === 'video';
  return (
    <Link href={`/ads/${ad.id}`} className="card">
      <div style={{ position: 'relative' }}>
        {thumb ? (
          // loading="lazy": 화면에 보일 때만 로드 → YouTube 썸네일 대량 동시요청 스로틀링(빈 칸) 방지
          // eslint-disable-next-line @next/next/no-img-element
          <img className="thumb" src={thumb} alt={ad.creativeId} loading="lazy" decoding="async" style={{ objectFit: 'cover' }} />
        ) : (
          <div className="thumb" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12, textAlign: 'center' }}>
            {ad.headline ? (
              <span style={{ fontSize: 13, color: 'var(--text)' }}>{ad.headline}</span>
            ) : (
              <span className="muted" style={{ fontSize: 12, whiteSpace: 'pre-line' }}>
                {ad.format === 'image' ? 'HTML·디스커버 광고\n(정적 이미지 없음)' : ad.format === 'text' ? '텍스트 광고' : ad.format}
              </span>
            )}
          </div>
        )}
        {rank != null && (
          <span style={{ position: 'absolute', top: 6, left: 6, background: 'rgba(0,0,0,.7)', color: '#fff', borderRadius: 6, padding: '1px 8px', fontWeight: 700 }}>
            #{rank}
          </span>
        )}
        {/* 잘못 수집된 광고를 목록에서 바로 정리 (카드 클릭 네비게이션은 컴포넌트가 차단) */}
        <DeleteAdButton adId={ad.id} label="✕" compact />
      </div>
      <div className="body">
        {rank != null && <div className="title">{ad.competitorName}</div>}
        <div className="meta">
          <span className={`badge ${ad.format}`}>{ad.format}</span>
          {isVideo ? (
            <>
              <span>👁 {fmtViews(ad.latestViews)}</span>
              {ad.latestLikes != null && <span>👍 {fmtViews(ad.latestLikes)}</span>}
              {growth != null && growth > 0 && <span style={{ color: 'var(--ok)' }}>▲ {fmtViews(growth)}</span>}
            </>
          ) : (
            // 이미지/텍스트 광고: 조회수 없음 → 문구 요약 표시
            ad.headline && <span className="muted" style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ad.headline}</span>
          )}
          {ad.daysShown != null && <span>📅 {ad.daysShown}일</span>}
        </div>
      </div>
    </Link>
  );
}

export default async function ReferenceListPage({
  searchParams,
}: {
  searchParams: {
    sort?: string;
    competitor?: string;
    format?: string;
    minViews?: string;
    best?: string;
    from?: string;
    to?: string;
  };
}) {
  const sort = (searchParams.sort as AdSort) ?? 'newest';
  const minViews = Number(searchParams.minViews) || 0;
  const best = (['day', 'week', 'month'].includes(searchParams.best ?? '') ? searchParams.best : undefined) as
    | BestPeriod
    | undefined;
  // 게재 기간 필터 — YYYY-MM-DD 형식만 허용
  const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const from = isDate(searchParams.from) ? searchParams.from : undefined;
  const to = isDate(searchParams.to) ? searchParams.to : undefined;

  const competitors = await listCompetitors();

  const qs = (patch: Record<string, string>) => {
    const base: Record<string, string> = { sort };
    if (searchParams.competitor) base.competitor = searchParams.competitor;
    if (searchParams.format) base.format = searchParams.format;
    if (minViews) base.minViews = String(minViews);
    if (best) base.best = best;
    if (from) base.from = from;
    if (to) base.to = to;
    const p = new URLSearchParams({ ...base, ...patch });
    // 빈 값 제거
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    return '/?' + p.toString();
  };

  return (
    <>
      <h1>레퍼런스 광고</h1>

      {/* 보기 모드 */}
      <div className="toolbar">
        <span className="muted">보기:</span>
        <Link href={qs({ best: '' })}>
          <span className={`badge ${!best ? 'ok' : ''}`}>일반(경쟁사별)</span>
        </Link>
        {(['day', 'week', 'month'] as BestPeriod[]).map((p) => (
          <Link key={p} href={qs({ best: p })}>
            <span className={`badge ${best === p ? 'ok' : ''}`}>{BEST_LABEL[p]}</span>
          </Link>
        ))}
      </div>

      {/* 조회수 범위 */}
      <div className="toolbar">
        <span className="muted">조회수:</span>
        {VIEW_PRESETS.map((preset) => (
          <Link key={preset.v} href={qs({ minViews: preset.v ? String(preset.v) : '' })}>
            <span className={`badge ${minViews === preset.v ? 'ok' : ''}`}>{preset.label}</span>
          </Link>
        ))}
      </div>

      {/* 게재 기간 — 겹치는 광고 필터. 캘린더 선택 또는 직접 입력(YYYY-MM-DD) */}
      <form method="get" className="toolbar">
        {/* 다른 필터 유지 */}
        <input type="hidden" name="sort" value={sort} />
        {searchParams.competitor && <input type="hidden" name="competitor" value={searchParams.competitor} />}
        {searchParams.format && <input type="hidden" name="format" value={searchParams.format} />}
        {minViews > 0 && <input type="hidden" name="minViews" value={String(minViews)} />}
        {best && <input type="hidden" name="best" value={best} />}
        <span className="muted">게재 기간:</span>
        <input type="date" name="from" defaultValue={from ?? ''} aria-label="시작일" />
        <span className="muted">~</span>
        <input type="date" name="to" defaultValue={to ?? ''} aria-label="종료일" />
        <button type="submit">적용</button>
        {(from || to) && (
          <Link href={qs({ from: '', to: '' })}>
            <span className="badge">초기화</span>
          </Link>
        )}
      </form>

      {best ? (
        <BestView period={best} minViews={minViews} from={from} to={to} />
      ) : (
        <GroupedView
          sort={sort}
          competitor={searchParams.competitor}
          format={searchParams.format}
          minViews={minViews}
          from={from}
          to={to}
          competitors={competitors}
          qs={qs}
        />
      )}
    </>
  );
}

/** 베스트 모드 — 기간 내 조회수 증가량 순위 (평면) */
async function BestView({
  period,
  minViews,
  from,
  to,
}: {
  period: BestPeriod;
  minViews: number;
  from?: string;
  to?: string;
}) {
  const ads = await bestAds(period, minViews, from, to);
  return (
    <>
      <h2>
        {BEST_LABEL[period]} <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>조회수 증가량 순 ({ads.length})</span>
      </h2>
      {ads.length === 0 ? (
        <div className="empty">해당 조건의 영상 광고가 없습니다.</div>
      ) : (
        <div className="grid">
          {ads.map((ad: BestAd, i) => (
            <AdCardView key={ad.id} ad={ad} rank={i + 1} growth={ad.growth} />
          ))}
        </div>
      )}
      <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
        ▲ 증가량은 일별 조회수 스냅샷 차이로 계산됩니다. 스냅샷 이력이 쌓일수록 정확한 급상승 순위가 됩니다.
      </p>
    </>
  );
}

/** 일반 모드 — 경쟁사별 섹션 */
async function GroupedView({
  sort,
  competitor,
  format,
  minViews,
  from,
  to,
  competitors,
  qs,
}: {
  sort: AdSort;
  competitor?: string;
  format?: string;
  minViews: number;
  from?: string;
  to?: string;
  competitors: Array<{ id: string; name: string; advertiserId: string; adCount: number }>;
  qs: (patch: Record<string, string>) => string;
}) {
  const ads = await listAds({
    sort,
    competitorId: competitor || undefined,
    format: (format as 'video' | 'image' | 'text') || undefined,
    minViews,
    from,
    to,
  });

  const byCompetitor = new Map<string, { name: string; ads: AdCard[] }>();
  for (const ad of ads) {
    let g = byCompetitor.get(ad.competitorId);
    if (!g) {
      g = { name: ad.competitorName, ads: [] };
      byCompetitor.set(ad.competitorId, g);
    }
    g.ads.push(ad);
  }
  const groups = [...byCompetitor.entries()].map(([id, g]) => ({ id, ...g }));

  return (
    <>
      <div className="toolbar">
        <span className="muted">정렬:</span>
        {(['newest', 'views', 'likes', 'duration'] as AdSort[]).map((s) => (
          <Link key={s} href={qs({ sort: s })}>
            <span className={`badge ${sort === s ? 'ok' : ''}`}>
              {s === 'newest' ? '최신순' : s === 'views' ? '조회수순' : s === 'likes' ? '좋아요순' : '게재기간순'}
            </span>
          </Link>
        ))}
        <span className="muted" style={{ marginLeft: 16 }}>형식:</span>
        <Link href={qs({ format: '' })}>
          <span className={`badge ${!format ? 'ok' : ''}`}>전체</span>
        </Link>
        {(['video', 'image', 'text'] as const).map((f) => (
          <Link key={f} href={qs({ format: f })}>
            <span className={`badge ${format === f ? 'ok' : ''}`}>
              {f === 'video' ? '비디오' : f === 'image' ? '이미지' : '텍스트'}
            </span>
          </Link>
        ))}
        <span className="muted" style={{ marginLeft: 16 }}>경쟁사:</span>
        <Link href={qs({ competitor: '' })}>
          <span className={`badge ${!competitor ? 'ok' : ''}`}>전체</span>
        </Link>
        {(() => {
          // DB 의 경쟁사 목록으로 필터 칩 생성. 같은 이름이 여러 광고주 계정으로 등록된 경우
          // (예: 드래프터 2계정) advertiser_id 뒷자리를 붙여 구분한다.
          const shown = competitors.filter((c) => c.adCount > 0);
          const dupNames = new Set(
            shown.map((c) => c.name).filter((n, i, arr) => arr.indexOf(n) !== i),
          );
          return shown.map((c) => (
            <Link key={c.id} href={qs({ competitor: c.id })}>
              <span className={`badge ${competitor === c.id ? 'ok' : ''}`}>
                {c.name}
                {dupNames.has(c.name) ? ` ·${c.advertiserId.slice(-4)}` : ''} ({c.adCount})
              </span>
            </Link>
          ));
        })()}
      </div>

      {groups.length === 0 ? (
        <div className="empty">
          조건에 맞는 광고가 없습니다. <Link href="/competitors">경쟁사</Link>를 등록하고 "지금 수집"을 실행하세요.
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.id} style={{ marginBottom: 32 }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>{g.name}</span>
              <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>광고 {g.ads.length}</span>
              <Link href={qs({ competitor: g.id })} className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>
                이 경쟁사만 보기 →
              </Link>
            </h2>
            <div className="grid">
              {g.ads.map((ad) => (
                <AdCardView key={ad.id} ad={ad} />
              ))}
            </div>
          </section>
        ))
      )}
      <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
        조회수가 확인되지 않는 영상(비-YouTube·비공개·삭제)은 목록에서 제외됩니다.
      </p>
    </>
  );
}
