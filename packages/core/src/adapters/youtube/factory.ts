import type { Env } from '../../config/env.js';
import { YouTubeDataApiClient } from './youtubeDataApi.js';
import type { YouTubeClient } from './types.js';

export function createYouTubeClient(env: Env, fetchImpl?: typeof fetch): YouTubeClient {
  return new YouTubeDataApiClient({ apiKey: env.YOUTUBE_API_KEY ?? '', fetchImpl });
}
