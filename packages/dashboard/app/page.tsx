import Link from 'next/link';
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
  const t = thumbUrl(ad.youtubeVideoId);
  return (
    <Link href={`/ads/${ad.id}`} className="card">
      <div style={{ position: 'relative' }}>
        {t ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="thumb" src={t} alt={ad.creativeId} />
        ) : (
          <div className="thumb" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span className="muted">{ad.format}</span>
          </div>
        )}
        {rank != null && (
          <span style={{ position: 'absolute', top: 6, left: 6, background: 'rgba(0,0,0,.7)', color: '#fff', borderRadius: 6, padding: '1px 8px', fontWeight: 700 }}>
            #{rank}
          </span>
        )}
      </div>
      <div className="body">
        {rank != null && <div className="title">{ad.competitorName}</div>}
        <div className="meta">
          <span className={`badge ${ad.format}`}>{ad.format}</span>
          <span>👁 {fmtViews(ad.latestViews)}</span>
          {growth != null && growth > 0 && <span style={{ color: 'var(--ok)' }}>▲ {fmtViews(growth)}</span>}
          {ad.daysShown != null && <span>📅 {ad.daysShown}일</span>}
        </div>
      </div>
    </Link>
  );
}

export default async function ReferenceListPage({
  searchParams,
}: {
  searchParams: { sort?: string; competitor?: string; format?: string; minViews?: string; best?: string };
}) {
  const sort = (searchParams.sort as AdSort) ?? 'newest';
  const minViews = Number(searchParams.minViews) || 0;
  const best = (['day', 'week', 'month'].includes(searchParams.best ?? '') ? searchParams.best : undefined) as
    | BestPeriod
    | undefined;

  const competitors = await listCompetitors();

  const qs = (patch: Record<string, string>) => {
    const base: Record<string, string> = { sort };
    if (searchParams.competitor) base.competitor = searchParams.competitor;
    if (searchParams.format) base.format = searchParams.format;
    if (minViews) base.minViews = String(minViews);
    if (best) base.best = best;
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

      {best ? (
        <BestView period={best} minViews={minViews} />
      ) : (
        <GroupedView
          sort={sort}
          competitor={searchParams.competitor}
          format={searchParams.format}
          minViews={minViews}
          competitors={competitors}
          qs={qs}
        />
      )}
    </>
  );
}

/** 베스트 모드 — 기간 내 조회수 증가량 순위 (평면) */
async function BestView({ period, minViews }: { period: BestPeriod; minViews: number }) {
  const ads = await bestAds(period, minViews);
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
  competitors,
  qs,
}: {
  sort: AdSort;
  competitor?: string;
  format?: string;
  minViews: number;
  competitors: Array<{ id: string; name: string; adCount: number }>;
  qs: (patch: Record<string, string>) => string;
}) {
  const ads = await listAds({
    sort,
    competitorId: competitor || undefined,
    format: (format as 'video' | 'image' | 'text') || undefined,
    minViews,
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
        {(['newest', 'views', 'duration'] as AdSort[]).map((s) => (
          <Link key={s} href={qs({ sort: s })}>
            <span className={`badge ${sort === s ? 'ok' : ''}`}>
              {s === 'newest' ? '최신순' : s === 'views' ? '조회수순' : '게재기간순'}
            </span>
          </Link>
        ))}
        <span className="muted" style={{ marginLeft: 16 }}>경쟁사:</span>
        <Link href={qs({ competitor: '' })}>
          <span className={`badge ${!competitor ? 'ok' : ''}`}>전체</span>
        </Link>
        {competitors
          .filter((c) => c.adCount > 0)
          .map((c) => (
            <Link key={c.id} href={qs({ competitor: c.id })}>
              <span className={`badge ${competitor === c.id ? 'ok' : ''}`}>{c.name} ({c.adCount})</span>
            </Link>
          ))}
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
    </>
  );
}
