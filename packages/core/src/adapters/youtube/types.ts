export interface VideoStats {
  videoId: string;
  viewCount?: bigint;
  likeCount?: number;
  publishedAt?: string; // 영상 게시일 (ISO 8601, snippet.publishedAt)
}

/**
 * YouTube Data API v3 어댑터. 조회수·좋아요를 일별 스냅샷으로 수집한다.
 * getVideoStats 는 내부에서 50개 단위로 청크 조회한다(API 최대 batch).
 */
export interface YouTubeClient {
  getVideoStats(ids: string[]): Promise<{ stats: VideoStats[]; apiCalls: number }>;
}
