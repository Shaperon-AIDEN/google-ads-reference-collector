CREATE TABLE IF NOT EXISTS "crawl_pacing" (
	"id" integer PRIMARY KEY NOT NULL,
	"window_count" integer DEFAULT 0 NOT NULL,
	"pause_until" timestamp with time zone
);
