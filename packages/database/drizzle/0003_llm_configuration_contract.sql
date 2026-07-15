CREATE TABLE IF NOT EXISTS "llm_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"provider" text NOT NULL,
	"modelName" text NOT NULL,
	"name" text NOT NULL,
	"baseUrl" text,
	"apiKey" text,
	"isDefault" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "llm_models" DROP CONSTRAINT IF EXISTS "llm_models_userId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "user_configs" DROP CONSTRAINT IF EXISTS "user_configs_userId_user_id_fk";
--> statement-breakpoint
UPDATE "llm_models" SET "isDefault" = false WHERE "isDefault" IS NULL;
--> statement-breakpoint
ALTER TABLE "llm_models" ALTER COLUMN "isDefault" SET DEFAULT false;
--> statement-breakpoint
ALTER TABLE "llm_models" ALTER COLUMN "isDefault" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "llm_models"
ADD CONSTRAINT "llm_models_userId_user_id_fk"
FOREIGN KEY ("userId") REFERENCES "public"."user"("id")
ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user_configs"
ADD CONSTRAINT "user_configs_userId_user_id_fk"
FOREIGN KEY ("userId") REFERENCES "public"."user"("id")
ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
WITH ranked AS (
	SELECT
		"id",
		ROW_NUMBER() OVER (
			PARTITION BY "userId"
			ORDER BY "updatedAt" DESC, "id" ASC
		) AS row_number
	FROM "llm_models"
	WHERE "isDefault" = true
)
UPDATE "llm_models" AS model
SET "isDefault" = false, "updatedAt" = now()
FROM ranked
WHERE model."id" = ranked."id" AND ranked.row_number > 1;
--> statement-breakpoint
WITH ranked AS (
	SELECT
		"id",
		ROW_NUMBER() OVER (
			PARTITION BY "userId", "key"
			ORDER BY "updatedAt" DESC, "id" ASC
		) AS row_number
	FROM "user_configs"
)
DELETE FROM "user_configs" AS config
USING ranked
WHERE config."id" = ranked."id" AND ranked.row_number > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "llm_models_user_default_unique"
ON "llm_models" USING btree ("userId")
WHERE "isDefault" = true;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_models_user_created_idx"
ON "llm_models" USING btree ("userId", "createdAt");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_configs_user_key_unique"
ON "user_configs" USING btree ("userId", "key");
