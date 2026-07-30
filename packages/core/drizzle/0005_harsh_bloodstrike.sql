CREATE TABLE IF NOT EXISTS "ad_variations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ad_id" uuid NOT NULL,
	"idx" integer NOT NULL,
	"width" integer,
	"height" integer,
	"headline" text,
	"description" text,
	"cta_text" text,
	"logo_url" text,
	"image_url" text,
	"landing_url" text,
	"screenshot" "bytea",
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_variations_ad_idx_uq" UNIQUE("ad_id","idx")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ad_variations" ADD CONSTRAINT "ad_variations_ad_id_ads_id_fk" FOREIGN KEY ("ad_id") REFERENCES "public"."ads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
