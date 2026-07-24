CREATE EXTENSION IF NOT EXISTS "pgcrypto";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ad_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ad_id" uuid NOT NULL,
	"snapshot_date" date NOT NULL,
	"yt_view_count" bigint,
	"yt_like_count" integer,
	"times_shown_min" bigint,
	"times_shown_max" bigint,
	CONSTRAINT "ad_metrics_ad_day_uq" UNIQUE("ad_id","snapshot_date")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competitor_id" uuid NOT NULL,
	"creative_id" text NOT NULL,
	"format" text NOT NULL,
	"platforms" text[] DEFAULT '{}' NOT NULL,
	"first_shown" date,
	"last_shown" date,
	"days_shown" integer,
	"video_url" text,
	"youtube_video_id" text,
	"thumbnail_path" text,
	"landing_url" text,
	"landing_domain" text,
	"regions" jsonb,
	"raw" jsonb,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ads_creative_id_unique" UNIQUE("creative_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "collection_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"new_ads_count" integer DEFAULT 0 NOT NULL,
	"api_call_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "competitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"advertiser_id" text NOT NULL,
	"domain" text,
	"region" text DEFAULT 'KR' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competitors_advertiser_id_unique" UNIQUE("advertiser_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ad_metrics" ADD CONSTRAINT "ad_metrics_ad_id_ads_id_fk" FOREIGN KEY ("ad_id") REFERENCES "public"."ads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ads" ADD CONSTRAINT "ads_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
