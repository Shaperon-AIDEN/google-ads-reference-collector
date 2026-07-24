import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { SerpApiAdsSource } from '../src/adapters/ads-source/serpapi.js';
import { parseYouTubeId } from '../src/domain/parseYouTubeId.js';
import { landingDomain } from '../src/domain/landingDomain.js';

const dir = dirname(fileURLToPath(import.meta.url));
function fixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(dir, 'fixtures', name), 'utf8'));
}
function mockFetch(json: unknown): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } }),
  ) as unknown as typeof fetch;
}

/**
 * 실제 SerpApi 응답(2026-07 실측, Tesla)을 저장한 픽스처로 어댑터 매핑을 검증한다.
 * 실 API 스키마가 바뀌면 이 테스트가 먼저 깨져 어댑터 수정을 유도한다.
 */
describe('SerpApiAdsSource — 실측 픽스처 계약', () => {
  it('serpapi-list.json 매핑', async () => {
    const src = new SerpApiAdsSource({ apiKey: 'k', fetchImpl: mockFetch(fixture('serpapi-list.json')) });
    const { items } = await src.listAds({ advertiserId: 'AR17828074650563772417' });

    expect(items.length).toBeGreaterThan(0);
    for (const it of items) {
      expect(it.creativeId).toMatch(/^CR\d+/);
      expect(['video', 'image', 'text']).toContain(it.format);
      // 게재일은 ISO YYYY-MM-DD 로 정규화되어야 한다 (Unix 정수 아님)
      if (it.firstShown) expect(it.firstShown).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('serpapi-detail.json 매핑 + 파생값', async () => {
    const src = new SerpApiAdsSource({ apiKey: 'k', fetchImpl: mockFetch(fixture('serpapi-detail.json')) });
    const { detail } = await src.getAdDetail({
      advertiserId: 'AR17828074650563772417',
      creativeId: 'CR18431297936794058753',
    });

    expect(detail.videoUrl).toContain('youtube.com/embed/');
    expect(parseYouTubeId(detail.videoUrl)).toBe('TOnJMLfOZCs');
    expect(landingDomain(detail.landingUrl)).toBe('tesla.com');
    expect(detail.raw).toBeTruthy(); // 원본 보존
  });
});
