ALTER TABLE "quant_strategies" DROP CONSTRAINT "quant_strategies_userId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "watchlists" DROP CONSTRAINT "watchlists_userId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "quant_strategies" ADD CONSTRAINT "quant_strategies_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlists" ADD CONSTRAINT "watchlists_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "watchlists_user_symbol_unique" ON "watchlists" USING btree ("userId","symbol");