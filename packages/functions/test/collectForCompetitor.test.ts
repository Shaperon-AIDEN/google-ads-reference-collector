import { QuotaGuard, type AdDetail, type AdListItem } from '@adref/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectForCompetitor } from '../src/handlers/collectForCompetitor.js';
import { FakeBlob, FakeQueue, makeDeps } from './fakes.js';

const COMP = { id: 'c1', name: '쿠팡', advertiserId: 'AR1', region: 'KR' };

function listItem(id: string): AdListItem {
  return { creativeId: id, advertiserId: 'AR1', format: 'video', daysShown: 5 };
}

const detail: AdDetail = {
  creativeId: 'X',
  videoUrl: 'https://www.youtube.com/embed/TOnJMLfOZCs',
  landingUrl: 'https://coupang.com',
  raw: {},
};

/** listAds + getAdDetail 를 함께 제공하는 소스 페이크 */
function source(items: AdListItem[]) {
  return {
    name: 'fake',
    async listAds() {
      return { items, apiCalls: 1 };
    },
    async getAdDetail() {
      return { detail, apiCalls: 1 };
    },
    async searchAdvertisersByDomain() {
      return { candidates: [], apiCalls: 1 };
    },
  };
}

/** 상세 인라인 처리에 필요한 repo (findById + existingCreativeIds + upsert + runs) */
function repos(existing: Set<string> = new Set()) {
  const upserts: unknown[] = [];
  const runs: Array<{ status: string; newAdsCount?: number }> = [];
  return {
    upserts,
    finishedRuns: runs,
    competitors: { findById: async () => COMP },
    ads: {
      existingCreativeIds: async (ids: string[]) => new Set(ids.filter((i) => existing.has(i))),
      upsertByCreativeId: async (v: unknown) => {
        upserts.push(v);
        return { id: 'ad' };
      },
    },
    runs: {
      start: async () => ({ id: 'run' }),
      finish: async (_id: string, p: { status: string; newAdsCount?: number }) => {
        runs.push({ status: p.status, newAdsCount: p.newAdsCount });
      },
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('collectForCompetitor', () => {
  it('신규 앞 maxInline 건은 인라인 상세 처리, 나머지는 큐 적재', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.from('J'), { status: 200 })));
    const queue = new FakeQueue();
    const r = repos();
    const items = ['A', 'B', 'C', 'D', 'E'].map(listItem);
    const deps = makeDeps({ ads: source(items) as never, queue, blob: new FakeBlob(), repos: r as never });

    const res = await collectForCompetitor(deps, 'c1', { maxInline: 2 });

    expect(res.status).toBe('success');
    expect(res.newAds).toBe(5);
    expect(res.processedInline).toBe(2); // A, B 인라인
    expect(res.enqueued).toBe(3); // C, D, E 큐
    expect(r.upserts).toHaveLength(2); // 인라인 2건만 즉시 저장
    expect(queue.messages).toHaveLength(3);
  });

  it('기존 광고는 제외하고 신규만 처리', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.from('J'), { status: 200 })));
    const queue = new FakeQueue();
    const r = repos(new Set(['A', 'B'])); // A,B 는 이미 있음
    const items = ['A', 'B', 'C'].map(listItem);
    const deps = makeDeps({ ads: source(items) as never, queue, blob: new FakeBlob(), repos: r as never });

    const res = await collectForCompetitor(deps, 'c1', { maxInline: 8 });
    expect(res.newAds).toBe(1); // C 만
    expect(res.processedInline).toBe(1);
  });

  it('쿼터 소진 시 수집 없이 partial', async () => {
    const quota = new QuotaGuard({ monthlyBudget: 1, throttlePct: 0.8 });
    const r = repos();
    const deps = makeDeps({ ads: source([listItem('A')]) as never, queue: new FakeQueue(), blob: new FakeBlob(), repos: r as never, quota });

    const res = await collectForCompetitor(deps, 'c1');
    expect(res.status).toBe('partial');
    expect(res.throttled).toBe(true);
    expect(res.newAds).toBe(0);
  });


  it('시간예산 초과 시 진행 지점(pageToken)을 이어달리기 메시지로 재적재', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.from('J'), { status: 200 })));
    const queue = new FakeQueue();
    const r = repos();
    // 2페이지 소스 — 1페이지 처리 후 예산(0ms) 초과 → 2페이지는 continuation 으로
    const paged = {
      name: 'fake',
      async listAds(p: { pageToken?: string }) {
        return p.pageToken
          ? { items: [listItem('B')], apiCalls: 0 }
          : { items: [listItem('A')], nextPageToken: 'TOK2', apiCalls: 0 };
      },
      async getAdDetail() {
        return { detail, apiCalls: 0 };
      },
      async searchAdvertisersByDomain() {
        return { candidates: [], apiCalls: 0 };
      },
    };
    const deps = makeDeps({ ads: paged as never, queue, blob: new FakeBlob(), repos: r as never });

    const res = await collectForCompetitor(deps, 'c1', { maxInline: 0, budgetMs: 0 });

    expect(res.continued).toBe(true);
    expect(res.newAds).toBe(1); // 1페이지(A)만 처리
    const cont = queue.messages.find((m) => m.queue === 'collect-requests');
    expect(cont).toBeTruthy();
    expect((cont!.body as { pageToken?: string }).pageToken).toBe('TOK2'); // 진행 지점 보존

    // 이어달리기 실행 — pageToken 부터 재개, 인라인 없이 큐 적재만
    const res2 = await collectForCompetitor(deps, 'c1', {
      pageToken: (cont!.body as { pageToken: string }).pageToken,
      budgetMs: 60_000,
    });
    expect(res2.continued).toBe(false);
    expect(res2.newAds).toBe(1); // 2페이지(B)
    expect(res2.processedInline).toBe(0); // 이어달리기 청크는 인라인 생략
  });
});