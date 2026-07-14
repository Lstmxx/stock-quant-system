CREATE TABLE IF NOT EXISTS "data_collection_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text DEFAULT 'GLOBAL' NOT NULL,
	"userId" text,
	"lookbackDays" integer DEFAULT 250 NOT NULL,
	"workerCount" integer DEFAULT 4 NOT NULL,
	"cronExpression" text DEFAULT '0 20 * * mon-fri' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "data_collection_configs" ADD COLUMN IF NOT EXISTS "scope" text DEFAULT 'GLOBAL' NOT NULL;
--> statement-breakpoint
ALTER TABLE "data_collection_configs" ADD COLUMN IF NOT EXISTS "cronExpression" text DEFAULT '0 20 * * mon-fri' NOT NULL;
--> statement-breakpoint
ALTER TABLE "data_collection_configs" ALTER COLUMN "userId" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "data_collection_configs" DROP CONSTRAINT IF EXISTS "data_collection_configs_userId_unique";
--> statement-breakpoint
ALTER TABLE "data_collection_configs"
DROP CONSTRAINT IF EXISTS "data_collection_configs_userId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "data_collection_configs"
ADD CONSTRAINT "data_collection_configs_userId_user_id_fk"
FOREIGN KEY ("userId") REFERENCES "public"."user"("id")
ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
WITH ranked AS (
	SELECT "id", ROW_NUMBER() OVER (ORDER BY "updatedAt" DESC, "id" ASC) AS row_number
	FROM "data_collection_configs"
)
DELETE FROM "data_collection_configs" AS config
USING ranked
WHERE config."id" = ranked."id" AND ranked.row_number > 1;
--> statement-breakpoint
INSERT INTO "data_collection_configs" ("scope", "lookbackDays", "workerCount", "cronExpression")
SELECT 'GLOBAL', 250, 4, '0 20 * * mon-fri'
WHERE NOT EXISTS (SELECT 1 FROM "data_collection_configs");
--> statement-breakpoint
UPDATE "data_collection_configs"
SET
	"scope" = 'GLOBAL',
	"cronExpression" = COALESCE(
		(
			SELECT CASE
				WHEN "value" IN ('0 12 * * 1-5', '0 20 * * 1-5')
					THEN '0 20 * * mon-fri'
				ELSE "value"
			END
			FROM "user_configs"
			WHERE "key" = 'BAOSTOCK_CRON'
			ORDER BY "updatedAt" DESC, "id" ASC
			LIMIT 1
		),
		"cronExpression",
		'0 20 * * mon-fri'
	),
	"updatedAt" = now();
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "data_collection_configs_scope_unique"
ON "data_collection_configs" USING btree ("scope");
--> statement-breakpoint
ALTER TABLE "alpha_tasks" ALTER COLUMN "userId" DROP NOT NULL;
--> statement-breakpoint
WITH ranked AS (
	SELECT
		"id",
		ROW_NUMBER() OVER (ORDER BY "createdAt" DESC, "id" ASC) AS row_number
	FROM "alpha_tasks"
	WHERE "type" = 'DATA_COLLECTION'
		AND "status" IN ('PENDING', 'RUNNING', 'CANCELLING')
)
UPDATE "alpha_tasks" AS task
SET
	"status" = 'CANCELLED',
	"result" = COALESCE(task."result", '{}'::jsonb) || jsonb_build_object(
		'message', '迁移期间取消了重复的活跃数据采集任务'
	),
	"updatedAt" = now()
FROM ranked
WHERE task."id" = ranked."id" AND ranked.row_number > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "alpha_tasks_active_data_collection_unique"
ON "alpha_tasks" USING btree ("type")
WHERE "type" = 'DATA_COLLECTION'
	AND "status" IN ('PENDING', 'RUNNING', 'CANCELLING');
