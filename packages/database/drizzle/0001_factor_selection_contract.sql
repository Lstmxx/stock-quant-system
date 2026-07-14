ALTER TABLE "alpha_factors" ADD COLUMN "researchDirection" text;
--> statement-breakpoint

ALTER TABLE "alpha_factors"
ALTER COLUMN "icValue" TYPE double precision
USING NULLIF(BTRIM("icValue"), '')::double precision;
--> statement-breakpoint
ALTER TABLE "alpha_factors"
ALTER COLUMN "icir" TYPE double precision
USING NULLIF(BTRIM("icir"), '')::double precision;
--> statement-breakpoint
ALTER TABLE "alpha_factors"
ALTER COLUMN "monotonicity" TYPE double precision
USING NULLIF(BTRIM("monotonicity"), '')::double precision;
--> statement-breakpoint
ALTER TABLE "alpha_factors"
ALTER COLUMN "direction" TYPE integer
USING CASE
	WHEN BTRIM(COALESCE("direction", '')) ~ '^-?[0-9]+$'
		THEN BTRIM("direction")::integer
	ELSE NULL
END;
--> statement-breakpoint
ALTER TABLE "alpha_factors"
ALTER COLUMN "generation" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "alpha_factors"
ALTER COLUMN "generation" TYPE integer
USING CASE
	WHEN BTRIM(COALESCE("generation", '')) ~ '^-?[0-9]+$'
		THEN BTRIM("generation")::integer
	ELSE 0
END;
--> statement-breakpoint
ALTER TABLE "alpha_factors"
ALTER COLUMN "generation" SET DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "alpha_factors"
ALTER COLUMN "generation" SET NOT NULL;
--> statement-breakpoint
UPDATE "alpha_factors" SET "isValid" = false WHERE "isValid" IS NULL;
--> statement-breakpoint
ALTER TABLE "alpha_factors" ALTER COLUMN "isValid" SET NOT NULL;
--> statement-breakpoint

CREATE TEMP TABLE "factor_duplicate_map" ON COMMIT DROP AS
WITH ranked AS (
	SELECT
		"id",
		FIRST_VALUE("id") OVER (
			PARTITION BY "userId", "expression"
			ORDER BY "isValid" DESC, ABS(COALESCE("icValue", 0)) DESC,
				"updatedAt" DESC, "id" ASC
		) AS "keepId",
		ROW_NUMBER() OVER (
			PARTITION BY "userId", "expression"
			ORDER BY "isValid" DESC, ABS(COALESCE("icValue", 0)) DESC,
				"updatedAt" DESC, "id" ASC
		) AS "rowNumber"
	FROM "alpha_factors"
)
SELECT "id" AS "oldId", "keepId"
FROM ranked
WHERE "rowNumber" > 1;
--> statement-breakpoint

UPDATE "quant_strategies" AS strategy
SET "factors" = (
	SELECT JSONB_AGG(
		CASE
			WHEN JSONB_TYPEOF(item.value) = 'string' THEN
				TO_JSONB(COALESCE(mapping."keepId"::text, item.value #>> '{}'))
			ELSE item.value
		END
		ORDER BY item.ordinality
	) AS "factors"
	FROM JSONB_ARRAY_ELEMENTS(strategy."factors") WITH ORDINALITY AS item(value, ordinality)
	LEFT JOIN "factor_duplicate_map" AS mapping
		ON mapping."oldId"::text = item.value #>> '{}'
)
WHERE JSONB_TYPEOF(strategy."factors") = 'array'
	AND EXISTS (
		SELECT 1
		FROM JSONB_ARRAY_ELEMENTS_TEXT(strategy."factors") AS factor_id
		JOIN "factor_duplicate_map" AS mapping
			ON mapping."oldId"::text = factor_id
	);
--> statement-breakpoint

DELETE FROM "alpha_factors" AS factor
USING "factor_duplicate_map" AS mapping
WHERE factor."id" = mapping."oldId";
--> statement-breakpoint

CREATE UNIQUE INDEX "alpha_factors_user_expression_unique"
ON "alpha_factors" USING btree ("userId", "expression");
--> statement-breakpoint
CREATE INDEX "alpha_factors_user_quality_idx"
ON "alpha_factors" USING btree ("userId", "isValid", "icValue");
--> statement-breakpoint

CREATE TABLE "user_selected_factors" (
	"userId" text NOT NULL,
	"factorId" uuid NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_selected_factors_userId_factorId_pk"
		PRIMARY KEY("userId", "factorId")
);
--> statement-breakpoint
ALTER TABLE "user_selected_factors"
ADD CONSTRAINT "user_selected_factors_userId_user_id_fk"
FOREIGN KEY ("userId") REFERENCES "public"."user"("id")
ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user_selected_factors"
ADD CONSTRAINT "user_selected_factors_factorId_alpha_factors_id_fk"
FOREIGN KEY ("factorId") REFERENCES "public"."alpha_factors"("id")
ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

CREATE TABLE "factor_selection_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"taskId" uuid NOT NULL,
	"userId" text NOT NULL,
	"symbol" text NOT NULL,
	"rank" integer NOT NULL,
	"compositeScore" double precision NOT NULL,
	"dataDate" text NOT NULL,
	"factorContributions" jsonb NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "factor_selection_results"
ADD CONSTRAINT "factor_selection_results_taskId_alpha_tasks_id_fk"
FOREIGN KEY ("taskId") REFERENCES "public"."alpha_tasks"("id")
ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "factor_selection_results"
ADD CONSTRAINT "factor_selection_results_userId_user_id_fk"
FOREIGN KEY ("userId") REFERENCES "public"."user"("id")
ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "factor_selection_results_task_symbol_unique"
ON "factor_selection_results" USING btree ("taskId", "symbol");
--> statement-breakpoint
CREATE INDEX "factor_selection_results_user_date_idx"
ON "factor_selection_results" USING btree ("userId", "dataDate");
--> statement-breakpoint
CREATE INDEX "factor_selection_results_task_rank_idx"
ON "factor_selection_results" USING btree ("taskId", "rank");
