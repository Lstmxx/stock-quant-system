import { Elysia } from "elysia";

import { strategyModel } from "./model";
import { StrategyService } from "./service";
import { betterAuthPlugin } from "../../plugins/auth";

export const strategyModule = new Elysia({ prefix: "/strategy", name: "strategy" })
	.use(betterAuthPlugin)
	.use(new Elysia().model(strategyModel))
	.post(
		"/recommend",
		async ({ body, user }) => {
			if (!user) throw new Error("Unauthorized");
			return StrategyService.recommendFactors(user.id, body.style);
		},
		{
			auth: true,
			body: "recommendFactorsBody",
		}
	)
	.post(
		"/simulate",
		async ({ body, user }) => {
			if (!user) throw new Error("Unauthorized");
			return StrategyService.simulateFactor(user.id, body.factorId, body.constraints);
		},
		{
			auth: true,
			body: "simulateBody",
		}
	)
	.post(
		"/generate-report",
		async ({ body, user }) => {
			if (!user) throw new Error("Unauthorized");
			return StrategyService.generateReportStructured(user.id, body);
		},
		{
			auth: true,
			body: "generateReportBody",
		}
	);
