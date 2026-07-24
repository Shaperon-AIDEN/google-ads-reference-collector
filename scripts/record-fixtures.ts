/**
 * Phase 0 기술 검증 — 실제 SerpApi / YouTube 응답을 픽스처로 저장한다.
 * 저장된 픽스처로 어댑터 매핑을 실측·확정하고 단위 테스트에 재사용한다.
 *
 *   pnpm record-fixtures <advertiserId> [creativeId] [youtubeVideoId]
 *
 * SERPAPI_KEY / YOUTUBE_API_KEY 필요 (.env).
 */
import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdsSource, createYouTubeClient, loadEnv } from '@adref/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '../packages/core/test/fixtures');

async function save(name: string, data: unknown) {
  await mkdir(OUT_DIR, { recursive: true });
  const path = resolve(OUT_DIR, `${name}.json`);
  await writeFile(path, JSON.stringify(data, null, 2), 'utf8');
  console.log(`saved: ${path}`);
}

async function main() {
  const [advertiserId, creativeId, youtubeVideoId] = process.argv.slice(2);
  if (!advertiserId) {
    console.error('usage: pnpm record-fixtures <advertiserId> [creativeId] [youtubeVideoId]');
    process.exit(1);
  }

  const env = loadEnv();
  const ads = createAdsSource(env);

  const list = await ads.listAds({ advertiserId, region: 'KR' });
  await save('serpapi-list', list);
  console.log(`list: ${list.items.length} creatives, apiCalls=${list.apiCalls}`);

  const targetCreative = creativeId ?? list.items[0]?.creativeId;
  if (targetCreative) {
    const detail = await ads.getAdDetail({ advertiserId, creativeId: targetCreative });
    await save('serpapi-detail', detail);
    console.log(`detail: creativeId=${targetCreative}`);
  }

  if (youtubeVideoId) {
    const yt = createYouTubeClient(env);
    const stats = await yt.getVideoStats([youtubeVideoId]);
    await save('youtube-stats', stats);
    console.log(`youtube: ${stats.stats.length} videos, apiCalls=${stats.apiCalls}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
