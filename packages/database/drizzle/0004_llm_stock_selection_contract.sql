CREATE TABLE "llm_stock_selection_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resultId" uuid NOT NULL,
	"taskId" uuid NOT NULL,
	"userId" text NOT NULL,
	"attemptNo" integer NOT NULL,
	"status" text NOT NULL,
	"llmModelId" uuid,
	"provider" text,
	"modelName" text,
	"modelDisplayName" text,
	"judgment" jsonb,
	"errorCode" text,
	"errorMessage" text,
	"promptTokens" integer DEFAULT 0 NOT NULL,
	"completionTokens" integer DEFAULT 0 NOT NULL,
	"totalTokens" integer DEFAULT 0 NOT NULL,
	"startedAt" timestamp DEFAULT now() NOT NULL,
	"completedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "llm_stock_selection_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"taskId" uuid NOT NULL,
	"userId" text NOT NULL,
	"symbol" text NOT NULL,
	"stockName" text,
	"dataDate" text NOT NULL,
	"universeStatus" text NOT NULL,
	"exclusionStage" text,
	"exclusionCode" text,
	"exclusionMessage" text,
	"excludedAt" timestamp,
	"quantitativeScore" double precision,
	"quantitativeRank" integer,
	"candidateSources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"isLlmCandidate" boolean DEFAULT false NOT NULL,
	"inputSnapshot" jsonb,
	"llmStatus" text DEFAULT 'NOT_REQUESTED' NOT NULL,
	"judgment" jsonb,
	"attemptCount" integer DEFAULT 0 NOT NULL,
	"latestErrorCode" text,
	"latestErrorMessage" text,
	"latestErrorAt" timestamp,
	"selected" boolean DEFAULT false NOT NULL,
	"finalRank" integer,
	"promptTokens" integer DEFAULT 0 NOT NULL,
	"completionTokens" integer DEFAULT 0 NOT NULL,
	"totalTokens" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "llm_stock_selection_attempts" ADD CONSTRAINT "llm_stock_selection_attempts_resultId_llm_stock_selection_results_id_fk" FOREIGN KEY ("resultId") REFERENCES "public"."llm_stock_selection_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_stock_selection_attempts" ADD CONSTRAINT "llm_stock_selection_attempts_taskId_alpha_tasks_id_fk" FOREIGN KEY ("taskId") REFERENCES "public"."alpha_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_stock_selection_attempts" ADD CONSTRAINT "llm_stock_selection_attempts_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_stock_selection_results" ADD CONSTRAINT "llm_stock_selection_results_taskId_alpha_tasks_id_fk" FOREIGN KEY ("taskId") REFERENCES "public"."alpha_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_stock_selection_results" ADD CONSTRAINT "llm_stock_selection_results_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "llm_stock_selection_attempts_result_attempt_unique" ON "llm_stock_selection_attempts" USING btree ("resultId","attemptNo");--> statement-breakpoint
CREATE INDEX "llm_stock_selection_attempts_task_idx" ON "llm_stock_selection_attempts" USING btree ("taskId","startedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "llm_stock_selection_results_task_symbol_unique" ON "llm_stock_selection_results" USING btree ("taskId","symbol");--> statement-breakpoint
CREATE INDEX "llm_stock_selection_results_task_selected_rank_idx" ON "llm_stock_selection_results" USING btree ("taskId","selected","finalRank");--> statement-breakpoint
CREATE INDEX "llm_stock_selection_results_task_status_idx" ON "llm_stock_selection_results" USING btree ("taskId","llmStatus");--> statement-breakpoint
CREATE INDEX "llm_stock_selection_results_user_date_idx" ON "llm_stock_selection_results" USING btree ("userId","dataDate");--> statement-breakpoint
CREATE UNIQUE INDEX "alpha_tasks_active_llm_stock_selection_user_unique" ON "alpha_tasks" USING btree ("userId") WHERE "alpha_tasks"."type" = 'LLM_STOCK_SELECTION' AND "alpha_tasks"."status" IN ('PENDING', 'RUNNING', 'CANCELLING') AND "alpha_tasks"."userId" IS NOT NULL;