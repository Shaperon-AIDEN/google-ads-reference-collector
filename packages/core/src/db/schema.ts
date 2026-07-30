import {
  bigint,
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * DB 스키마 — 개발 계획서 v1.0 5장 그대로. 로컬 PostgreSQL 16 과 Azure PostgreSQL
 * Flexible Server 양쪽에 동일 마이그레이션으로 적용된다.
 * gen_random_uuid() 는 pgcrypto 확장에 의존 (0000_init.sql 에서 활성화).
 */

// 5.1 competitors — 경쟁사
export const competitors = pgTable('competitors', {
  id: uuid('id').primaryKey().defaultRandom().notNull(),
  name: text('name').notNull(),
  advertiserId: text('advertiser_id').notNull().unique(),
  domain: text('domain'),
  region: text('region').notNull().default('KR'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// 5.2 ads — 수집 광고 (크리에이티브)
export const ads = pgTable('ads', {
  id: uuid('id').primaryKey().defaultRandom().notNull(),
  competitorId: uuid('competitor_id')
    .notNull()
    .references(() => competitors.id, { onDelete: 'cascade' }),
  creativeId: text('creative_id').notNull().unique(),
  format: text('format', { enum: ['video', 'image', 'text'] }).notNull(),
  platforms: text('platforms').array().notNull().default([]),
  firstShown: date('first_shown'),
  lastShown: date('last_shown'),
  daysShown: integer('days_shown'),
  videoUrl: text('video_url'),
  youtubeVideoId: text('youtube_video_id'),
  // 영상 게시일 (YouTube snippet.publishedAt) — 최신순 정렬 기준. 비-YouTube·미조회 시 null.
  publishedAt: timestamp('published_at', { withTimezone: true }),
  // 광고 구성요소 — 투명성 센터의 완성 광고를 대시보드에서 재현하기 위해 저장한다.
  // (배너 이미지 + headline + description + CTA 를 조합하면 원본과 거의 동일하게 보인다)
  imageUrl: text('image_url'),
  headline: text('headline'),
  description: text('description'),
  ctaText: text('cta_text'),
  // 브랜드 로고 — content.js 의 `logo` 필드. http URL 또는 base64 데이터 URI(~10KB)로 온다.
  logoUrl: text('logo_url'),
  thumbnailPath: text('thumbnail_path'),
  landingUrl: text('landing_url'),
  landingDomain: text('landing_domain'),
  regions: jsonb('regions'),
  raw: jsonb('raw'),
  collectedAt: timestamp('collected_at', { withTimezone: true }).notNull().defaultNow(),
});

// 5.2b ad_variations — 광고 "대안" (투명성 센터 상세의 variation 카드)
// 한 광고에 여러 대안이 있고 대안마다 사이즈·문구·CTA 가 다르다. 전부 보존한다.
export const adVariations = pgTable(
  'ad_variations',
  {
    id: uuid('id').primaryKey().defaultRandom().notNull(),
    adId: uuid('ad_id')
      .notNull()
      .references(() => ads.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(), // variation 순서 (0부터)
    width: integer('width'), // 광고 단위 크기 (previewMetadata 실측)
    height: integer('height'),
    headline: text('headline'),
    description: text('description'),
    ctaText: text('cta_text'),
    logoUrl: text('logo_url'),
    imageUrl: text('image_url'),
    landingUrl: text('landing_url'),
    collectedAt: timestamp('collected_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    adIdxUnique: unique('ad_variations_ad_idx_uq').on(t.adId, t.idx),
  }),
);

// 5.3 ad_metrics — 일별 지표 스냅샷
export const adMetrics = pgTable(
  'ad_metrics',
  {
    id: uuid('id').primaryKey().defaultRandom().notNull(),
    adId: uuid('ad_id')
      .notNull()
      .references(() => ads.id, { onDelete: 'cascade' }),
    snapshotDate: date('snapshot_date').notNull(),
    ytViewCount: bigint('yt_view_count', { mode: 'bigint' }),
    ytLikeCount: integer('yt_like_count'),
    timesShownMin: bigint('times_shown_min', { mode: 'bigint' }),
    timesShownMax: bigint('times_shown_max', { mode: 'bigint' }),
  },
  (t) => ({
    adDayUnique: unique('ad_metrics_ad_day_uq').on(t.adId, t.snapshotDate),
  }),
);

// 6.1 users — 대시보드 회원 (이메일 도메인 화이트리스트 가입: nizcorp.com·shaperon.com)
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom().notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(), // scrypt `salt:hash` (Node 내장 crypto)
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// 6.2 user_sessions — httpOnly 쿠키 세션 (토큰 = 랜덤 64hex)
export const userSessions = pgTable('user_sessions', {
  token: text('token').primaryKey().notNull(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// 6.3 ad_favorites — 사용자별 광고 즐겨찾기
export const adFavorites = pgTable(
  'ad_favorites',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    adId: uuid('ad_id')
      .notNull()
      .references(() => ads.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.adId] }),
  }),
);

// 5.4 collection_runs — 수집 실행 이력
export const collectionRuns = pgTable('collection_runs', {
  id: uuid('id').primaryKey().defaultRandom().notNull(),
  kind: text('kind', { enum: ['list', 'detail', 'view_count'] }).notNull(),
  status: text('status', { enum: ['success', 'partial', 'failed'] }).notNull(),
  newAdsCount: integer('new_ads_count').notNull().default(0),
  apiCallCount: integer('api_call_count').notNull().default(0),
  errorMessage: text('error_message'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});

export type Competitor = typeof competitors.$inferSelect;
export type NewCompetitor = typeof competitors.$inferInsert;
export type Ad = typeof ads.$inferSelect;
export type NewAd = typeof ads.$inferInsert;
export type AdVariation = typeof adVariations.$inferSelect;
export type NewAdVariation = typeof adVariations.$inferInsert;
export type AdMetric = typeof adMetrics.$inferSelect;
export type NewAdMetric = typeof adMetrics.$inferInsert;
export type CollectionRun = typeof collectionRuns.$inferSelect;
export type NewCollectionRun = typeof collectionRuns.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserSession = typeof userSessions.$inferSelect;
export type AdFavorite = typeof adFavorites.$inferSelect;
